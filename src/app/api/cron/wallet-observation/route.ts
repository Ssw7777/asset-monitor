import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { hasCronAuthorization } from "@/lib/cron-auth";
import { ingestWalletObservation } from "@/lib/refresh-run";
import { acquireRefreshLease, releaseRefreshLease } from "@/lib/store";

export const preferredRegion = ["hkg1"];
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  if (!(await hasCronAuthorization(req))) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效 JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }
  const record = body as Record<string, unknown>;
  const address = typeof record.address === "string" ? record.address.trim() : "";
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json({ error: "无效地址" }, { status: 400 });
  }

  const leaseOwner = req.headers.get("x-idempotency-key") || randomUUID();
  if (!(await acquireRefreshLease(leaseOwner, 45_000))) {
    return NextResponse.json(
      { ok: true, ran: "skipped", reason: "refresh_in_progress" },
      { status: 202 }
    );
  }

  try {
    const result = await ingestWalletObservation(address, record.observation);
    if (!result) {
      return NextResponse.json({ error: "地址不在配置中" }, { status: 404 });
    }
    return NextResponse.json({
      ok: true,
      ran: "wallet-observation",
      refreshStatus: result.payload.refreshStatus,
      walletOk: result.walletOk,
      walletTotal: result.walletTotal,
    });
  } catch (error) {
    console.error("[cron] wallet observation rejected", error);
    return NextResponse.json({ error: "余额数据无效" }, { status: 422 });
  } finally {
    await releaseRefreshLease(leaseOwner);
  }
}
