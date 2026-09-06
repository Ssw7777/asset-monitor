import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { computeTotals, readStore } from "@/lib/store";

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;
  const state = readStore();
  const totals = computeTotals(state);
  return NextResponse.json({
    ...state,
    totals,
    serverConnected: true,
  });
}
