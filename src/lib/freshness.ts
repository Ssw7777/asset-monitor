import type { Wallet } from "./types";

export function walletFreshness(wallets: Wallet[], now = Date.now()) {
  const ages = wallets.map((wallet) => {
    const at = Date.parse(wallet.lastSuccess?.at ?? "");
    return Number.isFinite(at) && at <= now + 60_000 ? Math.max(0, now - at) : Infinity;
  });
  const fresh = wallets.filter((wallet, index) => wallet.status === "ok" && ages[index] <= 600_000).length;
  const oldestAgeMs = ages.length ? Math.max(...ages) : Infinity;
  return { fresh, total: wallets.length, stale: wallets.length - fresh, oldestAgeMs };
}
