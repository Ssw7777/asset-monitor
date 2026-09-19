import { NextRequest, NextResponse } from "next/server";
import { hasCronAuthorization } from "@/lib/cron-auth";
import { readStore } from "@/lib/store";
import { fetchZerionTokens } from "@/lib/onchain/token-providers";
import { fetchDirectDetail } from "@/lib/onchain/direct";
import { nextZerionKey } from "@/lib/onchain/zerion-keys";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** 单钱包直连层诊断：返回 fetchDirectDetail 的内部中间量。 */
async function debugOne(address: string, state: Awaited<ReturnType<typeof readStore>>) {
  const addressLower = address.toLowerCase();
  const knownChains = new Set<string>(["eth"]);
  for (const chain of state.chainCache?.[addressLower]?.chains ?? []) knownChains.add(chain.id);
  for (const chain of state.longtailCache?.[addressLower]?.chains ?? []) knownChains.add(chain.id);
  const longtailEntry = state.longtailCache?.[addressLower] ?? null;
  const direct = await fetchDirectDetail(address, {
    knownChains: [...knownChains],
    longtail: longtailEntry,
    allowZerion: true,
  });
  return {
    knownChains: [...knownChains],
    longtailAt: longtailEntry?.at ?? null,
    direct,
    stored: state.wallets.find((w) => w.address.toLowerCase() === addressLower)?.balanceUsd ?? null,
  };
}

/**
 * 临时对账接口（只接受云端定时任务鉴权）：
 * 对每个钱包用 Zerion 全仓位估值（独立定价 + 独立链覆盖）与看板直连层总额对比。
 * ours << zerion（<0.7）说明直连层漏了链或代币 → DIVERGENT。对账完成后删除。
 */
export async function GET(req: NextRequest) {
  if (!(await hasCronAuthorization(req))) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }
  const url = new URL(req.url);
  const state = await readStore();
  const oneAddress = (url.searchParams.get("debugone") || "").trim();
  if (oneAddress) {
    const result = await debugOne(oneAddress, state);
    return NextResponse.json(result);
  }
  const rows: Array<Record<string, unknown>> = [];
  for (const wallet of state.wallets) {
    const address = wallet.address;
    let zerionTotal: number | null = null;
    let zerionChains = 0;
    try {
      const detail = await fetchZerionTokens(address, { deadlineMs: Date.now() + 20_000 });
      if (detail) {
        zerionTotal = Math.round(detail.tokens.reduce((sum, token) => sum + token.valueUsd, 0) * 100) / 100;
        zerionChains = new Set(detail.tokens.map((token) => token.chain)).size;
      }
    } catch {
      /* 保持 null */
    }
    void nextZerionKey;
    const ours = wallet.balanceUsd;
    const defiNet = state.zerionDefi?.[address.toLowerCase()]?.netUsd ?? 0;
    const ratio = zerionTotal != null && zerionTotal > 0 ? ours / zerionTotal : null;
    let flag = "ok";
    if (zerionTotal == null) flag = "source-fail";
    else if (ratio != null && ratio < 0.7) flag = "DIVERGENT-LOW";
    rows.push({
      name: wallet.name,
      address,
      ours: Math.round(ours * 100) / 100,
      zerion: zerionTotal,
      zerionChains,
      ratio: ratio == null ? null : Math.round(ratio * 100) / 100,
      flag,
      chains: state.chainCache?.[address.toLowerCase()]?.chains.length ?? 0,
      defiNet,
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  const divergent = rows.filter((row) => row.flag !== "ok");
  return NextResponse.json({
    walletCount: rows.length,
    divergentCount: divergent.length,
    rows,
  });
}
