import { mutateLiveStore as mutateStore } from './store';
import { readRpcChain, RPC_NETWORKS, type RpcTarget, type RpcChainResult } from './onchain/rpc-balances';
import { tokenUuid } from './onchain/rabby-token-observation';
import { applyRpcQuantities } from './onchain/rpc-cache';
import { refreshOnchainBreakdown } from './onchain/debank';
import type { PortfolioState } from './types';
import {refreshMarketPrices} from './market-refresh';
import {readKonaPositions,applyKonaObservation,type KonaObservation} from './onchain/kona-rpc';

const MONTHLY_CU_CAP=9_000_000;
export function rpcPlan(state: PortfolioState) {
  const groups=new Map<string,RpcTarget[]>();
  for(const wallet of state.wallets){
    const address=wallet.address.toLowerCase(),cache=state.tokenCache?.[address];
    const ids=new Set([...(cache?.tokens??[]).map(tokenUuid).filter((s):s is string=>!!s),...Object.keys(cache?.inventory??{})]);
    for(const uuid of ids){
      const chain=uuid.split(':')[0];
      const group=groups.get(chain)??[];
      group.push({address,uuid,decimals:cache?.inventory?.[uuid]?.decimals});groups.set(chain,group);
    }
  }
  return groups;
}

export async function refreshRpcQuantities() {
  const start=Date.now(),month=new Date(start).toISOString().slice(0,7),at=new Date(start).toISOString();
  // Reserve the chain queue and quota before network calls; another scheduler
  // sees the reservation and cannot spend the same slot twice.
  const reserved=await mutateStore(async state=>{
    const audit=state.rpcAudit??{usage:{month,reservedCu:0},chains:{},quantities:{}};
    if(audit.usage.month!==month)audit.usage={month,reservedCu:0};
    if(Date.parse(audit.cooldownUntil??'')>start)return {targets:[] as Array<[string,RpcTarget[]]>,konaWallets:[] as string[]};
    const plan=[...rpcPlan(state)].filter(([chain])=>start-(Date.parse(audit.chains[chain]?.lastAttemptAt??'')||0)>=4*60_000)
      .sort(([a],[b])=>(Date.parse(audit.chains[a]?.lastAttemptAt??'')||0)-(Date.parse(audit.chains[b]?.lastAttemptAt??'')||0)).slice(0,6);
    const targets:Array<[string,RpcTarget[]]>=[];
    for(const [chain,rows] of plan){
      const cost=RPC_NETWORKS[chain]?.net?Math.ceil(rows.length/60)*26+(chain==='abs'?(Math.ceil(state.wallets.length*8/50)+2)*26:0):0;
      if(audit.usage.reservedCu+cost>MONTHLY_CU_CAP)continue;
      audit.usage.reservedCu+=cost;
      audit.chains[chain]={...audit.chains[chain],lastAttemptAt:at};targets.push([chain,rows]);
    }
    state.rpcAudit=audit;
    return {targets,konaWallets:targets.some(([chain])=>chain==='abs')?state.wallets.map(w=>w.address.toLowerCase()):[]};
  });
  const queue=[...reserved.result.targets],results:RpcChainResult[]=[];
  let kona:KonaObservation|undefined,konaError:string|undefined;
  let rateLimited=false;
  async function worker(){
    while(queue.length && !rateLimited && Date.now()-start<40_000){
      const [chain,rows]=queue.shift()!;
      const result=await readRpcChain(chain,rows,{apiKey:process.env.ALCHEMY_API_KEY,timeoutMs:Math.min(10_000,45_000-(Date.now()-start))});
      results.push(result);
      if(result.error==='http_429')rateLimited=true;
    }
  }
  const [market]=await Promise.all([
    refreshMarketPrices().catch(()=>({ran:'failed'})), worker(), worker(),
    ...(reserved.result.konaWallets.length?[readKonaPositions(reserved.result.konaWallets,{apiKey:process.env.ALCHEMY_API_KEY}).then(value=>{kona=value;}).catch(error=>{konaError=error instanceof Error&&/^[a-z0-9_]+$/.test(error.message)?error.message:'kona_read_failed';if(konaError==='http_429')rateLimited=true;})]:[]),
  ]);
  const mutation=await mutateStore(async state=>{
    const audit=state.rpcAudit!;
    if(rateLimited)audit.cooldownUntil=new Date(Date.now()+10*60_000).toISOString();
    const cache={...state.tokenCache};
    for(const result of results){
      const grouped=new Map<string,typeof result.quantities>();
      for(const row of result.quantities){
        const key=`${row.address}:${row.uuid}`,existing=audit.quantities[key];
        if(Date.parse(existing?.at??'')>=Date.parse(row.observedAt))continue;
        audit.quantities[key]={at:row.observedAt,error:row.error,amountExact:row.amountExact,decimals:row.decimals,block:row.blockNumber};
        const items=grouped.get(row.address)??[];items.push(row);grouped.set(row.address,items);
      }
      for(const [address,rows] of grouped)if(cache[address])cache[address]=applyRpcQuantities(cache[address],rows);
      const successful=result.quantities.filter(r=>!r.error).length;
      audit.chains[result.chain]={...audit.chains[result.chain],successful,failed:result.quantities.length-successful,error:result.error,
        ...(successful===result.quantities.length?{lastSuccessAt:result.observedAt}:{})};
    }
    state.tokenCache=cache;state.rpcAudit=audit;
    if(kona){
      const protocols={...state.protocolCache};
      for(const [address,protocol] of Object.entries(kona.wallets))protocols[address]=applyKonaObservation(protocols[address],protocol,kona.at,kona.block);
      state.protocolCache=protocols;
      audit.protocols={...audit.protocols,kona:{at:kona.at,block:kona.block,wallets:Object.keys(kona.wallets).length}};
    }else if(konaError)audit.protocols={...audit.protocols,kona:{...audit.protocols?.kona,error:konaError}};
    if(results.length)state.onchainBreakdown=await refreshOnchainBreakdown(state.wallets,state.chainCache??{},cache,state.protocolCache??{},state.zerionDefi??{});
    return {chains:results.map(r=>({chain:r.chain,successful:r.quantities.filter(q=>!q.error).length,failed:r.quantities.filter(q=>q.error).length,error:r.error})),protocols:audit.protocols??{},reservedCu:audit.usage.reservedCu,monthlyCap:MONTHLY_CU_CAP};
  });
  return {ok:true,ran:'rpc-quantities',market,...mutation.result};
}
