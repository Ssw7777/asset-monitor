import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { runRefresh } from "@/lib/refresh-run";

export const preferredRegion = ["hkg1"];
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 云端定时刷新入口：Vercel Cron（或任意外部定时器）用
 * `Authorization: Bearer $CRON_SECRET` 调用即可；已登录的浏览器会话同样可用。
 * 没有配置 CRON_SECRET 时，只有已登录会话能触发，避免被外部随意调用。
 */
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization") || "";
  // 支持两种带法：Header（Vercel Cron / cron-job.org）或 ?token=（GitHub Actions 之类不方便设头的场景）
  const queryToken = new URL(req.url).searchParams.get("token") || "";
  const headerOk = !!secret && (header === `Bearer ${secret}` || queryToken === secret);

  if (!headerOk) {
    const denied = await requireAuth();
    if (denied) return denied;
  }

  /**
   * mode=auto（默认）：服务端按 4 分钟容差判断 —— 到期跑全量，否则只读交易所 + 记快照。
   * 定时器只要无脑 5 分钟调一次即可，节奏完全由服务端掌握。
   */
  const mode = new URL(req.url).searchParams.get("mode") || "auto";
  const result =
    mode === "fast"
      ? await runRefresh({ fast: true })
      : mode === "full"
        ? await runRefresh({})
        : await runRefresh({ auto: true });
  return NextResponse.json({
    ok: true,
    mode,
    ran: result.payload.refreshMode,
    refreshedAt: new Date().toISOString(),
    walletOk: result.walletOk,
    walletTotal: result.walletTotal,
    totals: result.totals,
  });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
