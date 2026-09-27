import {NextRequest,NextResponse} from 'next/server';
import {hasCronAuthorization} from '@/lib/cron-auth';
import {mutateStore} from '@/lib/store';
import {applyProtocolObservation} from '@/lib/onchain/protocol-observation';
import {refreshOnchainBreakdown} from '@/lib/onchain/debank';

export const preferredRegion=['hkg1'];
export const dynamic='force-dynamic';
export const maxDuration=30;
export async function POST(req:NextRequest){
  if(!await hasCronAuthorization(req))return NextResponse.json({ok:false},{status:401});
  let body;
  try{body=await req.json();}catch{return NextResponse.json({ok:false,error:'invalid_json'},{status:400});}
  const rows=body?.observations;
  if(!Array.isArray(rows)||!rows.length||rows.length>5)return NextResponse.json({ok:false,error:'invalid_batch'},{status:400});
  try{
    const result=await mutateStore(async state=>{
      const cache={...state.protocolCache};
      for(const row of rows){
        if(typeof row?.address!=='string'||typeof row.observedAt!=='string')throw new Error('invalid_observation');
        const address=row.address.toLowerCase();
        if(!state.wallets.some(w=>w.address.toLowerCase()===address))throw new Error('unknown_wallet');
        cache[address]=applyProtocolObservation(cache[address],row.observation,row.observedAt);
      }
      state.protocolCache=cache;
      state.onchainBreakdown=await refreshOnchainBreakdown(state.wallets,state.chainCache??{},state.tokenCache??{},cache,state.zerionDefi??{});
      return rows.length;
    });
    return NextResponse.json({ok:true,ran:'protocol-observations',accepted:result.result});
  }catch(error){
    const validation=error instanceof Error&&/^(invalid_|unknown_wallet)/.test(error.message);
    return NextResponse.json({ok:false,error:validation?'invalid_protocol_observation':'persistence_failed'},{status:validation?422:503});
  }
}
