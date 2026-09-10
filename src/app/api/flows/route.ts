import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { FLOW_RANGES, buildFlowSummary, type FlowRangeKey } from "@/lib/flows";
import { readStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const params = new URL(req.url).searchParams;
  const requestedRange = params.get("range") || "24h";
  const range = (FLOW_RANGES.some((item) => item.key === requestedRange)
    ? requestedRange
    : "24h") as FlowRangeKey;
  const minParam = Number(params.get("min"));
  const minUsd = Number.isFinite(minParam) && minParam >= 0 ? minParam : 100;

  const state = await readStore();
  return NextResponse.json(buildFlowSummary(state, { range, minUsd }));
}
