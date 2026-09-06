import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { fetchBinanceBalance, fetchGateBalance, fetchOkxBalance, type CexResult } from "@/lib/cex/balances";
import { refreshWallets } from "@/lib/onchain/debank";
import { BASELINE } from "@/lib/seed";
import {
  computeTotals,
  publicState,
  pushSnapshot,
  readStore,
  updateExchanges,
  updateWallets,
} from "@/lib/store";
import type { ExchangeBalance } from "@/lib/types";

/** Prefer Hong Kong for Binance (US regions are geo-blocked). */
export const preferredRegion = ["hkg1"];
export const dynamic = "force-dynamic";

function mapExchange(
  exchange: ExchangeBalance["exchange"],
  result: CexResult,
  prev: ExchangeBalance | undefined,
  baseline: number,
  now: string
): ExchangeBalance {
  const keepBalance =
    result.status === "ok" ? result.balanceUsd : (prev?.balanceUsd ?? baseline);

  if (result.status === "ok") {
    return {
      exchange,
      balanceUsd: result.balanceUsd,
      lastUpdated: now,
      status: "ok",
    };
  }

  // After a refresh attempt: never leave status as baseline.
  // missing_passphrase / missing_keys / error are surfaced clearly; balance kept.
  if (result.status === "missing_passphrase") {
    return {
      exchange,
      balanceUsd: keepBalance,
      lastUpdated: prev?.lastUpdated ?? null,
      status: "missing_passphrase",
      error: result.error,
    };
  }
  if (result.status === "missing_keys") {
    return {
      exchange,
      balanceUsd: keepBalance,
      lastUpdated: prev?.lastUpdated ?? null,
      status: "missing_keys",
      error: result.error,
    };
  }
  // error — keep previous balance, status must be error (not baseline)
  return {
    exchange,
    balanceUsd: keepBalance,
    lastUpdated: prev?.lastUpdated ?? null,
    status: "error",
    error: result.error || "refresh failed",
  };
}

export async function POST() {
  const denied = await requireAuth();
  if (denied) return denied;

  const state = await readStore();
  const now = new Date().toISOString();
  const blob = state.encryptedSecrets;

  const [okx, binance, gate] = await Promise.all([
    fetchOkxBalance(blob),
    fetchBinanceBalance(blob),
    fetchGateBalance(blob),
  ]);

  const prevMap = Object.fromEntries(state.exchanges.map((e) => [e.exchange, e])) as Record<
    string,
    ExchangeBalance | undefined
  >;

  const exchanges: ExchangeBalance[] = [
    mapExchange("okx", okx, prevMap.okx, BASELINE.okx, now),
    mapExchange("binance", binance, prevMap.binance, BASELINE.binance, now),
    mapExchange("gate", gate, prevMap.gate, BASELINE.gate, now),
  ];
  await updateExchanges(exchanges);

  const wallets = await refreshWallets(state.wallets);
  await updateWallets(wallets);

  const latest = await readStore();
  const totals = computeTotals(latest);
  await pushSnapshot({
    totalUsd: totals.totalUsd,
    onchain: totals.onchainUsd,
    cex: totals.cexUsd,
    manual: totals.manualUsd,
    exchanges: Object.fromEntries(latest.exchanges.map((e) => [e.exchange, e.balanceUsd])),
    wallets: Object.fromEntries(latest.wallets.map((w) => [w.address.toLowerCase(), w.balanceUsd])),
  });
  const finalState = await readStore();

  return NextResponse.json({
    ...publicState(finalState),
    totals: computeTotals(finalState),
    refreshed: true,
  });
}
