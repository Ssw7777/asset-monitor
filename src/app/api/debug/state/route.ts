import { NextRequest, NextResponse } from "next/server";
import { hasCronAuthorization } from "@/lib/cron-auth";
import { readStore } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * 临时对账接口（只接受云端定时任务鉴权）：
 * 对每个钱包用 Rabby 官方接口（独立于 Alchemy/Zerion 直连层）读一次总额，
 * 与看板存储值对比，标记偏差超过 30% 的地址。对账完成后删除。
 */
export async function GET(req: NextRequest) {
  if (!(await hasCronAuthorization(req))) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }
  const state = await readStore();
  const rows: Array<Record<string, unknown>> = [];
  for (const wallet of state.wallets) {
    const address = wallet.address;
    let rabbyTotal: number | null = null;
    let rabbyStatus: number | null = null;
    try {
      const response = await fetch(`https://api.rabby.io/v1/user/total_balance?id=${address}`, {
        headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" },
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      rabbyStatus = response.status;
      if (response.ok) {
        const body = (await response.json()) as { data?: { total_usd_value?: unknown } };
        const value = Number(body.data?.total_usd_value);
        if (Number.isFinite(value) && value >= 0) rabbyTotal = value;
      }
    } catch {
      rabbyStatus = 0;
    }
    const ours = wallet.balanceUsd;
    const ratio = rabbyTotal != null && rabbyTotal > 0 ? ours / rabbyTotal : null;
    let flag = "ok";
    if (rabbyTotal == null) flag = "source-fail";
    else if (ratio != null && Math.abs(ratio - 1) > 0.3) flag = "DIVERGENT";
    rows.push({
      name: wallet.name,
      address,
      ours: Math.round(ours * 100) / 100,
      rabby: rabbyTotal == null ? null : Math.round(rabbyTotal * 100) / 100,
      rabbyStatus,
      ratio: ratio == null ? null : Math.round(ratio * 100) / 100,
      flag,
      chains: state.chainCache?.[address.toLowerCase()]?.chains.length ?? 0,
      defiNet: state.zerionDefi?.[address.toLowerCase()]?.netUsd ?? 0,
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  const divergent = rows.filter((row) => row.flag === "DIVERGENT");
  return NextResponse.json({
    walletCount: rows.length,
    divergentCount: divergent.length,
    rows,
  });
}
