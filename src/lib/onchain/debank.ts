import type { Wallet } from "../types";

const cache = new Map<string, { usd: number; at: number }>();
const TTL = 5 * 60 * 1000;
const CONCURRENCY = 3;
const MAX_RETRIES = 2;

export type WalletFetchStatus = "ok" | "cached" | "error";

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

function parseTotal(data: unknown): number | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const nested = d.data && typeof d.data === "object" ? (d.data as Record<string, unknown>) : null;
  const raw =
    d.total_usd_value ??
    d.total_usd ??
    nested?.total_usd_value ??
    nested?.total_usd ??
    null;
  const total = Number(raw);
  return Number.isFinite(total) ? total : null;
}

/** Official DeBank Cloud OpenAPI (requires DEBANK_ACCESS_KEY) */
async function fetchDebankOpenApi(address: string): Promise<number | null> {
  const key = process.env.DEBANK_ACCESS_KEY;
  if (!key) return null;
  try {
    const res = await fetch(
      `https://pro-openapi.debank.com/v1/user/total_balance?id=${address}`,
      { headers: { AccessKey: key }, cache: "no-store" }
    );
    if (!res.ok) return null;
    return parseTotal(await res.json());
  } catch {
    return null;
  }
}

/** Rabby-compatible public endpoint (same DeBank data plane; more reliable than api.debank.com) */
async function fetchRabbyPublic(address: string): Promise<number | null> {
  try {
    const res = await fetch(`https://api.rabby.io/v1/user/total_balance?id=${address}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "asset-monitor/0.1",
      },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return parseTotal(await res.json());
  } catch {
    return null;
  }
}

/** Legacy DeBank public (often rate-limited / 429) */
async function fetchDebankPublic(address: string): Promise<number | null> {
  try {
    const res = await fetch(`https://api.debank.com/user/total_balance?addr=${address}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; asset-monitor/0.1)",
        Origin: "https://debank.com",
        Referer: "https://debank.com/",
      },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return parseTotal(await res.json());
  } catch {
    return null;
  }
}

async function fetchOnce(addr: string): Promise<number | null> {
  let usd = await fetchDebankOpenApi(addr);
  if (usd == null) usd = await fetchRabbyPublic(addr);
  if (usd == null) usd = await fetchDebankPublic(addr);
  return usd;
}

export async function fetchWalletUsd(
  address: string,
  opts?: { force?: boolean }
): Promise<{ usd: number; status: WalletFetchStatus }> {
  const addr = address.toLowerCase();
  const hit = cache.get(addr);
  if (!opts?.force && hit && Date.now() - hit.at < TTL) {
    return { usd: hit.usd, status: "cached" };
  }

  let usd: number | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    usd = await fetchOnce(addr);
    if (usd != null) break;
    if (attempt < MAX_RETRIES) await sleep(250 * (attempt + 1));
  }

  if (usd != null) {
    cache.set(addr, { usd, at: Date.now() });
    return { usd, status: "ok" };
  }
  // Failure: keep last known cache value if any
  if (hit) return { usd: hit.usd, status: "cached" };
  return { usd: 0, status: "error" };
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * Refresh wallets with limited concurrency.
 * Never zero-out on error — keep last good balance.
 * After a refresh attempt, status is always ok | cached | error (never left as baseline).
 */
export async function refreshWallets(wallets: Wallet[]): Promise<Wallet[]> {
  if (!wallets.length) return [];
  const now = new Date().toISOString();
  return mapPool(wallets, CONCURRENCY, async (w) => {
    const prev = w.balanceUsd;
    const { usd, status } = await fetchWalletUsd(w.address, { force: true });

    if (status === "ok") {
      return {
        ...w,
        balanceUsd: Math.round(usd * 100) / 100,
        lastUpdated: now,
        status: "ok" as const,
      };
    }

    if (status === "cached") {
      // Live fetch failed but we have a process-cache value — keep it, mark cached
      const keep = usd > 0 ? usd : prev;
      return {
        ...w,
        balanceUsd: Math.round(keep * 100) / 100,
        lastUpdated: w.lastUpdated,
        status: "cached" as const,
      };
    }

    // error: keep previous / baseline amount, but NEVER leave status as baseline after a refresh attempt
    return {
      ...w,
      balanceUsd: prev,
      lastUpdated: w.lastUpdated,
      status: prev > 0 ? ("cached" as const) : ("error" as const),
    };
  });
}
