import type { Wallet } from "../types";

const cache = new Map<string, { usd: number; at: number }>();
const TTL = 5 * 60 * 1000;
const CONCURRENCY = 3;
const MAX_RETRIES = 2;

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function fetchDebankOpenApi(address: string): Promise<number | null> {
  const key = process.env.DEBANK_ACCESS_KEY;
  if (!key) return null;
  try {
    const res = await fetch(
      `https://pro-openapi.debank.com/v1/user/total_balance?id=${address}`,
      { headers: { AccessKey: key }, cache: "no-store" }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const total = Number(data.total_usd_value ?? data.total_usd ?? NaN);
    return Number.isFinite(total) ? total : null;
  } catch {
    return null;
  }
}

async function fetchDebankPublic(address: string): Promise<number | null> {
  try {
    const res = await fetch(`https://api.debank.com/user/total_balance?addr=${address}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "asset-monitor/0.1",
      },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json();
    const total = Number(data?.data?.total_usd_value ?? data?.total_usd_value ?? NaN);
    return Number.isFinite(total) ? total : null;
  } catch {
    return null;
  }
}

async function fetchOnce(addr: string): Promise<number | null> {
  let usd = await fetchDebankOpenApi(addr);
  if (usd == null) usd = await fetchDebankPublic(addr);
  return usd;
}

export async function fetchWalletUsd(
  address: string
): Promise<{ usd: number; status: "ok" | "stale" | "error" }> {
  const addr = address.toLowerCase();
  const hit = cache.get(addr);
  if (hit && Date.now() - hit.at < TTL) {
    return { usd: hit.usd, status: "ok" };
  }

  let usd: number | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    usd = await fetchOnce(addr);
    if (usd != null) break;
    if (attempt < MAX_RETRIES) await sleep(200 * (attempt + 1));
  }

  if (usd != null) {
    cache.set(addr, { usd, at: Date.now() });
    return { usd, status: "ok" };
  }
  if (hit) return { usd: hit.usd, status: "stale" };
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

/** Refresh wallets with limited concurrency; never zero-out on error — keep last good balance */
export async function refreshWallets(wallets: Wallet[]): Promise<Wallet[]> {
  if (!wallets.length) return [];
  return mapPool(wallets, CONCURRENCY, async (w) => {
    const prev = w.balanceUsd;
    const { usd, status } = await fetchWalletUsd(w.address);
    if (status === "ok") {
      return {
        ...w,
        balanceUsd: Math.round(usd * 100) / 100,
        lastUpdated: new Date().toISOString(),
        status: "ok" as const,
      };
    }
    if (status === "stale") {
      return {
        ...w,
        balanceUsd: usd > 0 ? usd : prev,
        lastUpdated: w.lastUpdated,
        status: "stale" as const,
      };
    }
    // error: keep previous / baseline — never zero-out
    return {
      ...w,
      balanceUsd: prev,
      status: prev > 0 ? (w.status === "ok" ? "stale" : w.status === "baseline" ? "baseline" : "stale") : "error",
    };
  });
}
