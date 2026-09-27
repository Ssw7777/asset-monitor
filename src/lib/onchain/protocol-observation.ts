import type { WalletProtocolCacheEntry } from '../types';

export function applyProtocolObservation(previous:WalletProtocolCacheEntry|undefined, raw:unknown, observedAt:string, now=Date.now()):WalletProtocolCacheEntry {
  const at=Date.parse(observedAt);
  if(!Number.isFinite(at)||at>now+60_000||now-at>10*60_000)throw new Error('invalid_observation_time');
  let list:unknown=raw;
  if(raw && typeof raw==='object' && !Array.isArray(raw)){
    const value=raw as Record<string,unknown>;
    list=value.list??value.data;
    if(list && typeof list==='object' && !Array.isArray(list))list=(list as Record<string,unknown>).list;
  }
  if(!Array.isArray(list)||list.some(p=>!p||typeof p!=='object'||Array.isArray(p)||typeof p.id!=='string'||!Array.isArray(p.portfolio_item_list)))throw new Error('invalid_protocol_observation');
  if(previous && at<=(Date.parse(previous.at)||0))return previous;
  // A complete successful list REPLACES the previous one, including an empty
  // list after withdrawal. Never merge vanished positions back into this list.
  return {...previous,at:observedAt,lastAttemptAt:observedAt,lastError:undefined,protocols:list};
}
