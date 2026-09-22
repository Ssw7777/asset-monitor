import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { hasCronAuthorization } from "@/lib/cron-auth";
import { readStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * 轻量状态接口：用来确认「云端定时刷新到底有没有在跑」。
 * 只返回时间与数量，不含任何余额、地址或密钥；
 * 需要登录会话，或通过云端定时任务鉴权。
 */
export async function GET(req: NextRequest) {
  const authorized = (await hasCronAuthorization(req)) || (await isAuthenticated());
  if (!authorized) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const state = await readStore();
  const wallets = state.wallets;
  const now = Date.now();
  const tenMinutes = 10 * 60 * 1000;
  const twentyMinutes = 20 * 60 * 1000;
  const threeHours = 3 * 60 * 60 * 1000;
  const sixHours = 6 * 60 * 60 * 1000;
  const appsFresh = wallets.filter((wallet) => {
    const at = state.protocolCache?.[wallet.address.toLowerCase()]?.appAt;
    const atMs = at ? new Date(at).getTime() : Number.NaN;
    return Number.isFinite(atMs) && atMs <= now + 60_000 && now - atMs <= sixHours;
  }).length;
  const protocolsFresh = wallets.filter((wallet) => {
    const at = state.protocolCache?.[wallet.address.toLowerCase()]?.at;
    const atMs = at ? new Date(at).getTime() : Number.NaN;
    return Number.isFinite(atMs) && atMs <= now + 60_000 && now - atMs <= sixHours;
  }).length;
  const refreshAgeSeconds = state.lastRefresh
    ? Math.max(0, Math.round((Date.now() - new Date(state.lastRefresh).getTime()) / 1000))
    : null;
  return NextResponse.json({
    ok: true,
    now: new Date(now).toISOString(),
    lastRefresh: state.lastRefresh,
    lastWalletObservationAt: state.lastWalletObservationAt ?? null,
    lastFullRefreshAt: state.lastFullRefreshAt ?? null,
    refreshAgeSeconds,
    snapshotCount: state.snapshots.length,
    walletCount: wallets.length,
    walletsLive: wallets.filter((wallet) => {
      const at = wallet.lastSuccess?.at ?? wallet.lastUpdated;
      const atMs = at ? new Date(at).getTime() : Number.NaN;
      return wallet.status === "ok" && Number.isFinite(atMs) && atMs <= now + 60_000 && now - atMs <= tenMinutes;
    }).length,
    walletsOver20min: wallets.filter((wallet) => {
      const at = wallet.lastSuccess?.at;
      const atMs = at ? new Date(at).getTime() : Number.NaN;
      return !Number.isFinite(atMs) || atMs > now + 60_000 || now - atMs > twentyMinutes;
    }).length,
    walletsStale: wallets.filter((wallet) => {
      const at = wallet.lastSuccess?.at;
      const atMs = at ? new Date(at).getTime() : Number.NaN;
      return !Number.isFinite(atMs) || atMs > now + 60_000 || now - atMs > threeHours;
    }).length,
    appsFresh,
    appsStale: wallets.length - appsFresh,
    protocolsFresh,
    protocolsStale: wallets.length - protocolsFresh,
    sourceCounts: {
      direct: wallets.filter((wallet) => wallet.source === "direct").length,
      public: wallets.filter((wallet) => wallet.source === "public").length,
      publicPartial: wallets.filter((wallet) => wallet.source === "public-partial").length,
      other: wallets.filter(
        (wallet) => wallet.source !== "direct" && wallet.source !== "public" && wallet.source !== "public-partial"
      ).length,
    },
    walletsTotalUsd: Math.round(wallets.reduce((sum, wallet) => sum + wallet.balanceUsd, 0) * 100) / 100,
    zerionDefiNetUsd: Math.round(
      Object.values(state.zerionDefi ?? {}).reduce((sum, entry) => sum + entry.netUsd, 0) * 100
    ) / 100,
    zerionDefiWallets: Object.keys(state.zerionDefi ?? {}).length,
    tokenSource: state.onchainBreakdown?.tokenSource ?? null,
    tokenCount: state.onchainBreakdown?.tokens?.length ?? 0,
    dappCount: state.onchainBreakdown?.dapps?.length ?? 0,
  });
}
