import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { readStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * 轻量状态接口：用来确认「云端定时刷新到底有没有在跑」。
 * 只返回时间与数量，不含任何余额、地址或密钥；
 * 需要登录会话，或带 ?token=$CRON_SECRET。
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const token = new URL(req.url).searchParams.get("token") || "";
  const authorized = (!!secret && token === secret) || (await isAuthenticated());
  if (!authorized) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const state = await readStore();
  const wallets = state.wallets;
  const tenMinutes = 10 * 60 * 1000;
  const threeHours = 3 * 60 * 60 * 1000;
  return NextResponse.json({
    ok: true,
    now: new Date().toISOString(),
    lastRefresh: state.lastRefresh,
    lastFullRefreshAt: state.lastFullRefreshAt ?? null,
    snapshotCount: state.snapshots.length,
    walletCount: wallets.length,
    walletsLive: wallets.filter((wallet) => {
      const at = wallet.lastSuccess?.at ?? wallet.lastUpdated;
      return wallet.status === "ok" && !!at && Date.now() - new Date(at).getTime() <= tenMinutes;
    }).length,
    walletsStale: wallets.filter((wallet) => {
      const at = wallet.lastSuccess?.at;
      return !at || Date.now() - new Date(at).getTime() > threeHours;
    }).length,
    tokenSource: state.onchainBreakdown?.tokenSource ?? null,
    tokenCount: state.onchainBreakdown?.tokens?.length ?? 0,
    dappCount: state.onchainBreakdown?.dapps?.length ?? 0,
  });
}
