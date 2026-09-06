import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { computeTotals, deleteManual, readStore, upsertManual } from "@/lib/store";
import type { ManualAsset } from "@/lib/types";

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;
  const s = readStore();
  return NextResponse.json({ manual: s.manual, totals: computeTotals(s) });
}

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const body = await req.json();
  const item: ManualAsset = {
    id: String(body.id || `m_${Date.now()}`),
    name: String(body.name || "未命名").slice(0, 120),
    amountUsd: Math.round((Number(body.amountUsd) || 0) * 100) / 100,
    updatedAt: new Date().toISOString(),
  };
  const s = upsertManual(item);
  return NextResponse.json({ manual: s.manual, totals: computeTotals(s) });
}

export async function PUT(req: NextRequest) {
  return POST(req);
}

export async function DELETE(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "缺少 id" }, { status: 400 });
  const s = deleteManual(id);
  return NextResponse.json({ manual: s.manual, totals: computeTotals(s) });
}
