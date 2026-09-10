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

  const result = await runRefresh();
  return NextResponse.json({
    ok: true,
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
