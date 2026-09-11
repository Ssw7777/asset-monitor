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
  // 手动刷新 = 刷全部地址（余额每个地址只要 1 个请求，错峰 900ms 一般 25 秒内完成）
  const result = await runRefresh({ fast: mode === "fast" });
  return NextResponse.json(result.payload);
}
