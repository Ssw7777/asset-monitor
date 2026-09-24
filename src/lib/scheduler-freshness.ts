/** Query before the ten-minute freshness boundary; never relabel old cache as live. */
export const PROTOCOL_REFRESH_LEAD_MS = 8 * 60 * 1000;

export function needsProtocolRefresh(at: string | undefined, now: number): boolean {
  const observed = at ? Date.parse(at) : Number.NaN;
  return !Number.isFinite(observed) || observed > now + 60_000 || observed < now - PROTOCOL_REFRESH_LEAD_MS;
}
