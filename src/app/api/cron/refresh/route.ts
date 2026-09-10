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
  const headerOk = !!secret && header === `Bearer ${secret}`;

  if (!headerOk) {
    const denied = await requireAuth();
    if (denied) return denied;
  }

  // 默认 fast：1 分钟级定时器用这个（只读交易所 + 记快照，几百毫秒完成）
  const mode = new URL(req.url).searchParams.get("mode") === "full" ? "full" : "fast";
  const result = await runRefresh({ fast: mode === "fast" });
  return NextResponse.json({
    ok: true,
    mode,
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
