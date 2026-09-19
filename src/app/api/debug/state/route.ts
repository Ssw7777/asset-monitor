import { NextRequest, NextResponse } from "next/server";
import { hasCronAuthorization } from "@/lib/cron-auth";
import { readStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * 临时调试接口（对账用）：返回每个钱包的余额构成 —— 代币净值（chainCache）、
 * 协议叠加净值（protocolCache）与最终展示值。只接受云端定时任务鉴权，
 * 不包含任何密钥；对账完成后随修复提交一并删除。
 */
export async function GET(req: NextRequest) {
  if (!(await hasCronAuthorization(req))) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }
  const state = await readStore();
  const wallets = state.wallets.map((wallet) => {
    const addressLower = wallet.address.toLowerCase();
    const protocols = state.protocolCache?.[addressLower]?.protocols ?? [];
    let dappNet = 0;
    const dappNames: string[] = [];
    for (const protocol of protocols) {
      const items = Array.isArray(protocol.portfolio_item_list)
        ? protocol.portfolio_item_list.filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
        : [];
      let protocolNet = 0;
      for (const item of items) {
        const stats = item.stats && typeof item.stats === "object" ? (item.stats as Record<string, unknown>) : {};
        const assetUsd = Number(stats.asset_usd_value) || 0;
        const debtUsd = Math.abs(Number(stats.debt_usd_value) || 0);
        protocolNet += stats.net_usd_value == null ? assetUsd - debtUsd : Number(stats.net_usd_value) || 0;
      }
      if (Math.abs(protocolNet) >= 0.01) {
        dappNet += protocolNet;
        dappNames.push(`${String(protocol.name || protocol.id || "?").slice(0, 24)}=${protocolNet.toFixed(2)}`);
      }
    }
    return {
      name: wallet.name,
      address: wallet.address,
      balanceUsd: wallet.balanceUsd,
      source: wallet.source ?? "public",
      tokenUsd: state.chainCache?.[addressLower]?.totalUsd ?? null,
      dappNet: Math.round(dappNet * 100) / 100,
      dappNames,
      lastSuccess: wallet.lastSuccess?.at ?? null,
    };
  });
  return NextResponse.json({ walletCount: wallets.length, wallets });
}
