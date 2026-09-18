import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireAuth } from "@/lib/auth";
import { runRefresh, runWalletBatch } from "@/lib/refresh-run";
import { acquireRefreshLease, releaseRefreshLease } from "@/lib/store";

/** Prefer Hong Kong for Binance (US regions are geo-blocked). */
export const preferredRegion = ["hkg1"];
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const searchParams = new URL(req.url).searchParams;
  const mode = searchParams.get("mode") || "full";
  const leaseOwner = req.headers.get("x-idempotency-key") || randomUUID();
  const acquired = await acquireRefreshLease(leaseOwner);
  if (!acquired) {
    return NextResponse.json({ refreshed: false, refreshMode: "skipped", refreshStatus: "partial" }, { status: 202 });
  }
  try {
    // 单地址手动检查：地址管理页的「检查」按钮，立即单独刷新这一个地址。
    // 读取失败也返回 200 + checkedWallet（余额保留上次成功值），由前端如实提示，
    // 不当成接口错误。
    if (mode === "wallet") {
      const walletId = (searchParams.get("walletId") || "").trim();
      if (!walletId) {
        return NextResponse.json({ error: "缺少 walletId" }, { status: 400 });
      }
      const result = await runWalletBatch({ walletIds: [walletId] });
      const checked = result.state.wallets.find((wallet) => wallet.id === walletId) ?? null;
      return NextResponse.json({ ...result.payload, checkedWallet: checked });
    }
    // 手动刷新 = 刷全部地址（余额每个地址只要 1 个请求，错峰 900ms 一般 25 秒内完成）
    const result = await runRefresh({ fast: mode === "fast" });
    return NextResponse.json(result.payload);
  } finally {
    await releaseRefreshLease(leaseOwner);
  }
}
