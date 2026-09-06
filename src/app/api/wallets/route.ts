import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { computeTotals, readStore } from "@/lib/store";

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;
  const s = readStore();
  return NextResponse.json({
    wallets: s.wallets,
    totals: computeTotals(s),
    limit: 50,
  });
}
