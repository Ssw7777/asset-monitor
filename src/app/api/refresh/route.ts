import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { runRefresh } from "@/lib/refresh-run";

/** Prefer Hong Kong for Binance (US regions are geo-blocked). */
export const preferredRegion = ["hkg1"];
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const mode = new URL(req.url).searchParams.get("mode") === "fast" ? "fast" : "full";
  // 手动刷新同样走轮换（每轮 8 个地址）：一次性请求 20+ 地址会把这个 IP 的额度打光，
  // 结果反而是所有地址都失败、数据更旧。
  const result = await runRefresh({ fast: mode === "fast", walletBudget: 8 });
  return NextResponse.json(result.payload);
}
