import { fetchBinanceBalance, fetchGateBalance, fetchOkxBalance, type CexResult } from "@/lib/cex/balances";
import { refreshOnchainBreakdown, refreshWallets } from "@/lib/onchain/debank";
import { BASELINE } from "@/lib/seed";
import {
  computeTotals,
  publicState,
  pushSnapshot,
  readStore,
  updateExchanges,
  updateOnchainBreakdown,
  updateTokenCache,
  updateWallets,
} from "@/lib/store";
import type { ExchangeBalance, PortfolioState } from "@/lib/types";

function mapExchange(
  exchange: ExchangeBalance["exchange"],
  result: CexResult,
  prev: ExchangeBalance | undefined,
  baseline: number,
  now: string
): ExchangeBalance {
  const keepBalance = result.status === "ok" ? result.balanceUsd : (prev?.balanceUsd ?? baseline);

  if (result.status === "ok") {
    return { exchange, balanceUsd: result.balanceUsd, lastUpdated: now, status: "ok" };
  }
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
  return {
    exchange,
    balanceUsd: keepBalance,
    lastUpdated: prev?.lastUpdated ?? null,
    status: "error",
    error: result.error || "refresh failed",
  };
}

export interface RefreshResult {
  state: PortfolioState;
  walletOk: number;
  walletTotal: number;
  totals: ReturnType<typeof computeTotals>;
  payload: Record<string, unknown>;
}

/**
 * 一次完整刷新：三家交易所并发只读、链上钱包按余额优先刷新、DApp / 代币明细随后取，
 * 最后写入一条快照。浏览器按钮与云端定时任务共用同一段逻辑。
 */
export async function runRefresh(): Promise<RefreshResult> {
  const state = await readStore();
  const now = new Date().toISOString();
  const blob = state.encryptedSecrets;

  const [okx, binance, gate] = await Promise.all([
    fetchOkxBalance(blob),
    fetchBinanceBalance(blob),
    fetchGateBalance(blob),
  ]);

  const prevMap = Object.fromEntries(state.exchanges.map((item) => [item.exchange, item])) as Record<
    string,
    ExchangeBalance | undefined
  >;
  const exchanges: ExchangeBalance[] = [
    mapExchange("okx", okx, prevMap.okx, BASELINE.okx, now),
    mapExchange("binance", binance, prevMap.binance, BASELINE.binance, now),
    mapExchange("gate", gate, prevMap.gate, BASELINE.gate, now),
  ];
  await updateExchanges(exchanges);

  const tokenCache = { ...(state.tokenCache || {}) };
  const wallets = await refreshWallets(state.wallets, tokenCache);
  await updateWallets(wallets);
  await updateTokenCache(tokenCache);

  let partial = wallets.some((wallet) => wallet.status !== "ok");
  let breakdown = state.onchainBreakdown ?? null;
  try {
    const onchainBreakdown = await refreshOnchainBreakdown(wallets, tokenCache);
    const previous = state.onchainBreakdown ?? null;
    // 限流时不要用“更少的成功地址”覆盖上一轮完整明细：保留旧明细，只更新限流状态。
    const richer = !previous || onchainBreakdown.successfulWallets >= previous.successfulWallets;
    const effective = richer
      ? onchainBreakdown
      : {
          ...previous,
          partial: true,
          // 保留上一轮更完整的链 / 协议明细，但代币明细只要新拿到就一定要用上
          tokens: onchainBreakdown.tokens.length ? onchainBreakdown.tokens : previous.tokens,
          tokensTotalUsd: onchainBreakdown.tokens.length
            ? onchainBreakdown.tokensTotalUsd
            : previous.tokensTotalUsd,
          tokenSource: onchainBreakdown.tokenSource || previous.tokenSource,
          cachedWallets: onchainBreakdown.cachedWallets,
          rateLimitedUntil: onchainBreakdown.rateLimitedUntil ?? null,
        };
    if (effective.successfulWallets > 0 || !previous) {
      await updateOnchainBreakdown(effective);
      breakdown = effective;
      partial = partial || effective.partial === true;
    }
  } catch (error) {
    // 明细接口失败时保留上一轮结果，绝不把总额清空。
    console.error("[refresh] on-chain breakdown failed", error);
  }

  const latest = await readStore();
  const totals = computeTotals(latest);
  await pushSnapshot({
    totalUsd: totals.totalUsd,
    onchain: totals.onchainUsd,
    cex: totals.cexUsd,
    manual: totals.manualUsd,
    exchanges: Object.fromEntries(latest.exchanges.map((item) => [item.exchange, item.balanceUsd])),
    wallets: Object.fromEntries(latest.wallets.map((wallet) => [wallet.address.toLowerCase(), wallet.balanceUsd])),
    manualItems: Object.fromEntries(latest.manual.map((item) => [item.name, item.amountUsd])),
    dapps: breakdown
      ? Object.fromEntries(breakdown.dapps.map((dapp) => [dapp.name, dapp.netUsd]))
      : undefined,
    partial,
  });
  const finalState = await readStore();
  const walletOk = finalState.wallets.filter((wallet) => wallet.status === "ok").length;
  // “可用”= 本轮拿到实时数据，或沿用了上次成功数据（余额依然有效）。
  // 只有所有地址都没有任何余额、交易所也全失败时，才算整体失败。
  const walletUsable = finalState.wallets.filter(
    (wallet) => wallet.status !== "error" || wallet.balanceUsd > 0
  ).length;
  const exchangeOk = exchanges.some((item) => item.status === "ok");

  return {
    state: finalState,
    walletOk,
    walletTotal: finalState.wallets.length,
    totals: computeTotals(finalState),
    payload: {
      ...publicState(finalState),
      totals: computeTotals(finalState),
      refreshed: true,
      /** 只有“一个地址、一个交易所都没读到”才算整体失败；部分成功仍算成功 */
      refreshStatus: walletUsable > 0 || exchangeOk ? "ok" : "failed",
    },
  };
}
