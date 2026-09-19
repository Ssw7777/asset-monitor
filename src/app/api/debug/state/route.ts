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
  const url = new URL(req.url);
  const checkAddress = (url.searchParams.get("check") || "").trim();

  // 服务端直查第三方数据源（Vercel hkg1 出口 IP），用于对账一个地址。
  if (checkAddress) {
    const out: Record<string, unknown> = {};
    const hd: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0",
      Origin: "https://debank.com",
      Referer: "https://debank.com/",
    };
    for (const [label, u] of [
      ["debank_total", `https://api.debank.com/user/total_balance?addr=${checkAddress}`],
      ["debank_protocols", `https://api.debank.com/user/complex_protocol_list?addr=${checkAddress}`],
      ["rabby_total", `https://api.rabby.io/v1/user/total_balance?id=${checkAddress}`],
      ["rabby_protocols", `https://api.rabby.io/v1/user/complex_protocol_list?id=${checkAddress}`],
    ] as const) {
      try {
        const response = await fetch(u, { headers: hd, cache: "no-store", signal: AbortSignal.timeout(20_000) });
        const text = await response.text();
        let parsed: unknown = text;
        try {
          parsed = JSON.parse(text);
        } catch {
          /* keep raw */
        }
        out[label] = { status: response.status, body: parsed };
      } catch (error) {
        out[label] = { error: String(error) };
      }
    }
    return NextResponse.json({ check: checkAddress, results: out });
  }

  const state = await readStore();
  const protoAddr = (url.searchParams.get("protocols") || "").trim().toLowerCase();
  if (protoAddr) {
    const entry = state.protocolCache?.[protoAddr] ?? null;
    const simplified = entry
      ? {
          at: entry.at,
          lastAttemptAt: entry.lastAttemptAt ?? null,
          protocols: entry.protocols.map((protocol) => {
            let net = 0;
            const items = Array.isArray(protocol.portfolio_item_list) ? protocol.portfolio_item_list : [];
            for (const item of items) {
              const stats = (item as Record<string, unknown>).stats as Record<string, unknown> | undefined;
              if (!stats) continue;
              const asset = Number(stats.asset_usd_value) || 0;
              const debt = Math.abs(Number(stats.debt_usd_value) || 0);
              net += stats.net_usd_value == null ? asset - debt : Number(stats.net_usd_value) || 0;
            }
            return { id: protocol.id, name: protocol.name, chain: protocol.chain, items: items.length, net: Math.round(net * 100) / 100 };
          }),
        }
      : null;
    return NextResponse.json({ address: protoAddr, protocolCache: simplified });
  }
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
