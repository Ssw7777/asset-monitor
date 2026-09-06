import type { Wallet } from "../types";

const cache = new Map<string, { usd: number; at: number }>();
const TTL = 5 * 60 * 1000;

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

/** Best-effort public profile scrape for total USD; may fail often — callers keep cache/baseline */
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

export async function fetchWalletUsd(address: string): Promise<{ usd: number; status: "ok" | "stale" | "error" }> {
  const addr = address.toLowerCase();
  const hit = cache.get(addr);
  if (hit && Date.now() - hit.at < TTL) {
    return { usd: hit.usd, status: "ok" };
  }
  let usd = await fetchDebankOpenApi(addr);
  if (usd == null) usd = await fetchDebankPublic(addr);
  if (usd != null) {
    cache.set(addr, { usd, at: Date.now() });
    return { usd, status: "ok" };
  }
  if (hit) return { usd: hit.usd, status: "stale" };
  return { usd: 0, status: "error" };
}

export async function refreshWallets(wallets: Wallet[]): Promise<Wallet[]> {
  const out: Wallet[] = [];
  // sequential with small delay to avoid rate limits
  for (const w of wallets) {
    const prev = w.balanceUsd;
    const { usd, status } = await fetchWalletUsd(w.address);
    if (status === "ok") {
      out.push({ ...w, balanceUsd: Math.round(usd * 100) / 100, lastUpdated: new Date().toISOString(), status: "ok" });
    } else if (status === "stale") {
      out.push({ ...w, balanceUsd: usd || prev, lastUpdated: w.lastUpdated, status: "stale" });
    } else {
      // keep previous / baseline
      out.push({ ...w, status: prev > 0 ? "baseline" : "error" });
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  return out;
}
