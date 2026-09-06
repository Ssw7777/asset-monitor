import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { fetchBinanceBalance, fetchGateBalance, fetchOkxBalance } from "@/lib/cex/balances";
import { refreshWallets } from "@/lib/onchain/debank";
import { BASELINE } from "@/lib/seed";
import { computeTotals, pushSnapshot, readStore, updateExchanges, updateWallets } from "@/lib/store";
import type { ExchangeBalance } from "@/lib/types";

export async function POST() {
  const denied = await requireAuth();
  if (denied) return denied;

  const state = readStore();
  const now = new Date().toISOString();

  const [okx, binance, gate] = await Promise.all([
    fetchOkxBalance(),
    fetchBinanceBalance(),
    fetchGateBalance(),
  ]);

  const prevMap = Object.fromEntries(state.exchanges.map((e) => [e.exchange, e]));
  const exchanges: ExchangeBalance[] = [
    {
      exchange: "okx",
      balanceUsd: okx.status === "ok" ? okx.balanceUsd : (prevMap.okx?.balanceUsd ?? BASELINE.okx),
      lastUpdated: okx.status === "ok" ? now : prevMap.okx?.lastUpdated ?? now,
      status: okx.status === "ok" ? "ok" : okx.status === "missing_keys" ? (prevMap.okx ? "baseline" : "missing_keys") : "error",
      error: okx.error,
    },
    {
      exchange: "binance",
      balanceUsd: binance.status === "ok" ? binance.balanceUsd : (prevMap.binance?.balanceUsd ?? BASELINE.binance),
      lastUpdated: binance.status === "ok" ? now : prevMap.binance?.lastUpdated ?? now,
      status: binance.status === "ok" ? "ok" : binance.status === "missing_keys" ? (prevMap.binance ? "baseline" : "missing_keys") : "error",
      error: binance.error,
    },
    {
      exchange: "gate",
      balanceUsd: gate.status === "ok" ? gate.balanceUsd : (prevMap.gate?.balanceUsd ?? BASELINE.gate),
      lastUpdated: gate.status === "ok" ? now : prevMap.gate?.lastUpdated ?? now,
      status: gate.status === "ok" ? "ok" : gate.status === "missing_keys" ? (prevMap.gate ? "baseline" : "missing_keys") : "error",
      error: gate.error,
    },
  ];
  updateExchanges(exchanges);

  const wallets = await refreshWallets(state.wallets);
  updateWallets(wallets);

  const latest = readStore();
  const totals = computeTotals(latest);
  pushSnapshot(totals.totalUsd);
  const finalState = readStore();

  return NextResponse.json({
    ...finalState,
    totals: computeTotals(finalState),
    refreshed: true,
  });
}
