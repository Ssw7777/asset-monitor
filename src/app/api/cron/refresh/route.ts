import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireAuth } from "@/lib/auth";
import { hasCronAuthorization } from "@/lib/cron-auth";
import { runRefresh } from "@/lib/refresh-run";
import { acquireRefreshLease, releaseRefreshLease } from "@/lib/store";

export const preferredRegion = ["hkg1"];
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * 云端定时刷新入口：接受 Vercel Cron 的 CRON_SECRET、指定 GitHub Actions
 * 工作流签发的短期 OIDC Token，或已经登录的浏览器会话。
 */
async function handle(req: NextRequest) {
  if (!(await hasCronAuthorization(req))) {
    const denied = await requireAuth();
    if (denied) return denied;
  }

  /**
   * mode=auto（默认）：服务端按 4 分钟容差判断 —— 到期跑全量，否则只读交易所 + 记快照。
   * 定时器只要无脑 5 分钟调一次即可，节奏完全由服务端掌握。
   */
  const mode = new URL(req.url).searchParams.get("mode") || "auto";
  const leaseOwner = req.headers.get("x-idempotency-key") || randomUUID();
  const acquired = await acquireRefreshLease(leaseOwner);
  if (!acquired) {
    return NextResponse.json({ ok: true, mode, ran: "skipped", reason: "refresh_in_progress" }, { status: 202 });
  }

  try {
    const result =
      mode === "fast"
        ? await runRefresh({ fast: true })
        : mode === "full"
          ? await runRefresh({})
          : await runRefresh({ auto: true });
    const refreshStatus = result.payload.refreshStatus;
    return NextResponse.json(
      {
        ok: refreshStatus !== "failed",
        mode,
        ran: result.payload.refreshMode,
        refreshStatus,
        refreshedAt: new Date().toISOString(),
        walletOk: result.walletOk,
        walletTotal: result.walletTotal,
      },
      { status: refreshStatus === "failed" ? 503 : 200 }
    );
  } finally {
    await releaseRefreshLease(leaseOwner);
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
