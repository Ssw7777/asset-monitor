"use client";

import { useMemo, useState } from "react";
import type { DappAllocation, DappWalletShare } from "@/lib/types";
import type { ProtocolPerformanceSummary } from "@/lib/protocols";
import type { ChangeRangeKey } from "@/lib/changes";
import { CHANGE_RANGES } from "@/lib/changes";
import { deltaClass, shortAddr, signedPct, signedUsd, usd } from "./format";
import { localChainIcon, TokenIcon } from "./TokenIcon";

function safeSiteUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch {
    return "";
  }
}

function hostOf(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** 链图标：本地已下载的图标优先，其次远端，最后字母标。 */
function ChainIcon({ id, name, size = 16 }: { id: string; name: string; size?: number }) {
  return (
    <TokenIcon
      symbol={name || id}
      localSrc={localChainIcon(id)}
      size={size}
      shape="square"
    />
  );
}

/** 资产 / 负债用代币符号表达：`USDT + USDC.e`，不堆美元金额。 */
function symbolsOf(wallet: DappWalletShare, role: "asset" | "debt") {
  const list = wallet.tokens.filter((token) =>
    role === "asset" ? token.role !== "debt" : token.role === "debt"
  );
  if (!list.length) return "—";
  const names = [...new Set(list.map((token) => token.symbol))];
  return names.slice(0, 4).join(" + ") + (names.length > 4 ? ` +${names.length - 4}` : "");
}

/** DeBank 的协议区块：协议头 + 各钱包份额表；小于 1 USDT 的协议默认折叠成一行。 */
export function ProtocolSections({
  dapps,
  perf,
  range,
  onRangeChange,
}: {
  dapps: DappAllocation[];
  perf?: ProtocolPerformanceSummary | null;
  range: ChangeRangeKey;
  onRangeChange: (range: ChangeRangeKey) => void;
}) {
  const [showDust, setShowDust] = useState(false);
  const perfByName = useMemo(() => {
    const map = new Map<string, ProtocolPerformanceSummary["items"][number]>();
    for (const item of perf?.items ?? []) map.set(item.name, item);
    return map;
  }, [perf]);

  const { major, dust, dustTotal } = useMemo(() => {
    const majorList = dapps.filter((dapp) => Math.abs(dapp.netUsd) >= 1);
    const dustList = dapps.filter((dapp) => Math.abs(dapp.netUsd) < 1);
    return {
      major: majorList,
      dust: dustList,
      dustTotal: dustList.reduce((sum, dapp) => sum + dapp.netUsd, 0),
    };
  }, [dapps]);

  if (!dapps.length) {
    return (
      <section className="section" id="defi">
        <div className="section-head">
          <div className="section-title">
            <h2>DeFi 仓位</h2>
          </div>
        </div>
        <div className="empty">没有读到协议仓位：点击右上角刷新</div>
      </section>
    );
  }

  const renderDapp = (dapp: DappAllocation) => {
    const site = safeSiteUrl(dapp.siteUrl);
    const host = hostOf(dapp.siteUrl);
    const debt = dapp.debtUsd > 0.01;
    const stat = perfByName.get(dapp.name);
    return (
      <div className="protocol" key={`${dapp.id}-${dapp.name}`}>
        <div className="protocol-head">
          <div className="protocol-id">
            <TokenIcon
              symbol={dapp.name}
              logoUrl={dapp.logoUrl}
              extraSources={
                host
                  ? [
                      `https://icons.duckduckgo.com/ip3/${host}.ico`,
                      `https://${host}/favicon.ico`,
                    ]
                  : []
              }
              size={24}
            />
            <h3>{dapp.name}</h3>
            {site && (
              <a href={site} target="_blank" rel="noopener noreferrer">
                官网 ↗
              </a>
            )}
            <span className="small">
              {dapp.chains.length} 条链 · {dapp.wallets.length} 个钱包
              {debt ? ` · 负债 ${usd(dapp.debtUsd)}` : ""}
            </span>
          </div>
          <span className="inline" style={{ justifyContent: "flex-end" }}>
            {stat && stat.changeUsd !== 0 && (
              <span className={`small num ${deltaClass(stat.changeUsd)}`}>
                {signedUsd(stat.changeUsd)}（{signedPct(stat.changePct)}）
                {stat.apy != null ? ` · 年化 ${stat.apy.toFixed(1)}%` : ""}
              </span>
            )}
            <span className="section-total num">{usd(dapp.netUsd)}</span>
          </span>
        </div>

        <div className="table">
          <div className="thead grid-protocol">
            <div>钱包</div>
            <div className="hide-md">链</div>
            <div className="hide-md">资产</div>
            <div className="hide-md">负债</div>
            <div className="right">净值</div>
          </div>
          {dapp.wallets.map((wallet) => {
            const chain =
              dapp.chains.find((item) =>
                item.wallets.some((share) => share.walletId === wallet.walletId)
              ) || dapp.chains[0];
            const chainId = chain?.id || "unknown";
            const chainName = chain?.name || "—";
            return (
              <div className="trow grid-protocol" key={wallet.walletId}>
                <div className="cell-token-text">
                  <b>{wallet.walletName}</b>
                  <span>{shortAddr(wallet.address)}</span>
                </div>
                <div className="cell-token hide-md">
                  <ChainIcon id={chainId} name={chainName} />
                  <span className="cell-main">{chainName}</span>
                </div>
                <div className="cell-main hide-md">
                  <span className="cell-token" style={{ gap: 6 }}>
                    <ChainIcon id={chainId} name={chainName} size={14} />
                    {symbolsOf(wallet, "asset")}
                  </span>
                </div>
                <div
                  className="cell-main hide-md"
                  style={{ color: wallet.debtUsd > 0.01 ? "var(--neg)" : "var(--ink-3)" }}
                >
                  {symbolsOf(wallet, "debt")}
                </div>
                <div className="right cell-main num">{usd(wallet.netUsd)}</div>

                <div className="flow-meta cell-sub">
                  {chainName} · 资产：{symbolsOf(wallet, "asset")} · 净值 {usd(wallet.netUsd)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <section className="section" id="defi">
      <div className="section-head">
        <div className="section-title">
          <h2>DeFi 仓位</h2>
          <span className="hint">{dapps.length} 个协议 · 只解释组成，不重复计入总额</span>
        </div>
        <span className="inline">
          {perf?.available ? (
            <span className="small">较 {perf.rangeLabel} · 年化为该区间线性推算</span>
          ) : (
            <span className="small">{perf?.reason ?? ""}</span>
          )}
          <span className="seg">
            {CHANGE_RANGES.map((item) => (
              <button
                key={item.key}
                type="button"
                className={range === item.key ? "active" : ""}
                onClick={() => onRangeChange(item.key)}
              >
                {item.label}
              </button>
            ))}
          </span>
          <span className="section-total num">
            {usd(dapps.reduce((sum, dapp) => sum + dapp.netUsd, 0))}
          </span>
        </span>
      </div>

      {major.map(renderDapp)}

      {dust.length > 0 && (
        <div className="dust-block">
          <button
            type="button"
            className="dust-row"
            onClick={() => setShowDust((value) => !value)}
            aria-expanded={showDust}
          >
            <span className="cell-token">
              <span className="token-icon fallback" style={{ width: 24, height: 24 }}>
                ⋯
              </span>
              <span className="cell-token-text">
                <b>小额协议 {dust.length} 个</b>
                <span>每个低于 1 USDT · {showDust ? "点击收起" : "点击展开"}</span>
              </span>
            </span>
            <span className="section-total num">{usd(dustTotal)}</span>
          </button>
          {showDust && <div className="dust-body">{dust.map(renderDapp)}</div>}
        </div>
      )}
    </section>
  );
}
