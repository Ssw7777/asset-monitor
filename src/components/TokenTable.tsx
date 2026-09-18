"use client";

import { useMemo, useState } from "react";
import type { TokenHolding } from "@/lib/types";
import { amountNum, priceUsd, shortAddr, usd } from "./format";
import { localChainIcon, TokenIcon } from "./TokenIcon";

function percent(value: number, total: number) {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(100, (value / total) * 100));
}

interface TokenGroup {
  symbol: string;
  chains: TokenHolding[];
  amount: number;
  valueUsd: number;
  price: number;
  logoUrl?: string;
  kind: TokenHolding["kind"];
  wallets: Array<{ walletId: string; walletName: string; address: string; amount: number; valueUsd: number }>;
}

/** 同名代币跨链合并成一个组（图1：ETH 在不同链上只占一行，点开才看各链明细）。 */
function groupTokens(tokens: TokenHolding[]): TokenGroup[] {
  const map = new Map<string, TokenGroup>();
  for (const token of tokens) {
    const key = token.symbol.toUpperCase();
    const group =
      map.get(key) ||
      ({
        symbol: token.symbol,
        chains: [],
        amount: 0,
        valueUsd: 0,
        price: 0,
        logoUrl: token.logoUrl,
        kind: token.kind,
        wallets: [],
      } satisfies TokenGroup);
    group.chains.push(token);
    group.amount += token.amount;
    group.valueUsd += token.valueUsd;
    if (!group.logoUrl && token.logoUrl) group.logoUrl = token.logoUrl;
    for (const wallet of token.wallets) {
      const existing = group.wallets.find((item) => item.walletId === wallet.walletId);
      if (existing) {
        existing.amount += wallet.amount;
        existing.valueUsd += wallet.valueUsd;
      } else {
        group.wallets.push({ ...wallet });
      }
    }
    map.set(key, group);
  }
  const list = [...map.values()];
  for (const group of list) {
    group.chains.sort((left, right) => right.valueUsd - left.valueUsd);
    group.wallets.sort((left, right) => right.valueUsd - left.valueUsd);
    group.price = group.amount > 0 ? group.valueUsd / group.amount : 0;
  }
  return list.sort((left, right) => right.valueUsd - left.valueUsd);
}

/** DeBank 的 Wallet 版式 + 多钱包/多链合并：同名代币一行，点开看链与钱包明细。 */
export function TokenTable({
  tokens,
  onchainUsd,
  chainFilter,
  partial,
  tokenSource,
}: {
  tokens: TokenHolding[];
  onchainUsd: number;
  chainFilter: string;
  partial?: boolean;
  tokenSource?: string;
}) {
  const [query, setQuery] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [dustOpen, setDustOpen] = useState(false);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return tokens.filter(
      (token) =>
        (chainFilter === "all" || token.chain === chainFilter) &&
        (!keyword || token.symbol.toLowerCase().includes(keyword))
    );
  }, [tokens, chainFilter, query]);

  const groups = useMemo(() => groupTokens(filtered), [filtered]);
  const shownTotal = useMemo(
    () => groups.reduce((sum, group) => sum + group.valueUsd, 0),
    [groups]
  );
  /** 小于 50 USDT 的一律折叠成一行，避免一堆小额代币把主列表冲散。 */
  const mainGroups = useMemo(() => groups.filter((group) => group.valueUsd >= 50), [groups]);
  const dustGroups = useMemo(() => groups.filter((group) => group.valueUsd < 50), [groups]);
  const dustTotal = useMemo(
    () => dustGroups.reduce((sum, group) => sum + group.valueUsd, 0),
    [dustGroups]
  );
  const dustWallets = useMemo(() => {
    const set = new Set<string>();
    for (const group of dustGroups) for (const wallet of group.wallets) set.add(wallet.walletId);
    return set.size;
  }, [dustGroups]);
  const coverage = onchainUsd > 0 ? (shownTotal / onchainUsd) * 100 : 0;

  const renderCard = (group: TokenGroup) => {
    const key = group.symbol.toUpperCase();
    const open = openKey === key;
    const share = percent(group.valueUsd, shownTotal);
    const topChain = group.chains[0];
    return (
      <div
        key={key}
        className={`token-card clickable${open ? " open" : ""}`}
        onClick={() => setOpenKey(open ? null : key)}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpenKey(open ? null : key);
          }
        }}
      >
        <div className="token-card-head">
          <div className="cell-token">
            <TokenIcon symbol={group.symbol} logoUrl={group.logoUrl} />
            <span className="cell-token-text">
              <b>{group.symbol}</b>
              <span>
                {group.kind === "stable" ? "稳定币" : group.kind === "native" ? "主链币" : "现货"}
              </span>
            </span>
          </div>
          <div className="token-card-metrics">
            <div>
              <span>价格</span>
              <b className="num">{priceUsd(group.price)}</b>
            </div>
            <div>
              <span>数量</span>
              <b className="num">
                {amountNum(group.amount)} {group.symbol}
              </b>
            </div>
            <div>
              <span>分布</span>
              <b className="token-card-location">
                {group.chains.length === 1 && topChain ? (
                  <TokenIcon
                    symbol={topChain.chainName}
                    localSrc={localChainIcon(topChain.chain)}
                    size={15}
                    shape="square"
                  />
                ) : null}
                {group.chains.length === 1 ? topChain?.chainName : `${group.chains.length} 条链`}
                {` · ${group.wallets.length} 个钱包`}
              </b>
            </div>
          </div>
          <div className="token-card-value value-cell num">
            <div className="cell-main">{usd(group.valueUsd)}</div>
            <div className="value-bar" aria-hidden="true">
              <i style={{ width: `${share}%` }} />
            </div>
            <div className="cell-sub">{share.toFixed(2)}%</div>
          </div>
        </div>

        {open && (
          <div className="row-detail">
            <div className="small" style={{ marginBottom: 8 }}>
              各链明细（{group.chains.length} 条链 · {group.wallets.length} 个钱包）
            </div>
            <div className="detail-grid">
              {group.chains.map((chain) => (
                <div className="detail-item" key={chain.id} style={{ alignItems: "flex-start" }}>
                  <span className="name" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <TokenIcon
                      symbol={chain.chainName}
                      localSrc={localChainIcon(chain.chain)}
                      size={16}
                      shape="square"
                    />
                    {chain.chainName}
                  </span>
                  <span className="amount">
                    {amountNum(chain.amount)} · {usd(chain.valueUsd)}
                  </span>
                </div>
              ))}
            </div>
            <div className="small" style={{ margin: "10px 0 8px" }}>
              各钱包持仓
            </div>
            <div className="detail-grid">
              {group.wallets.map((wallet) => (
                <div className="detail-item" key={wallet.walletId}>
                  <span className="name">
                    {wallet.walletName}
                    <span className="small" style={{ marginLeft: 6 }}>
                      {shortAddr(wallet.address)}
                    </span>
                  </span>
                  <span className="amount">
                    {amountNum(wallet.amount)} · {usd(wallet.valueUsd)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <section className="section section-surface section-tokens" id="tokens">
      <div className="section-head">
        <div className="section-title">
          <h2>代币</h2>
          <span className="hint">
            {groups.length} 个币种
            {chainFilter !== "all" ? "（已按链筛选）" : " · 同名代币已跨链合并"}
          </span>
        </div>
        <div className="inline">
          <span className="search" style={{ height: 36, minWidth: 190 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.2-3.2" />
            </svg>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索代币"
              aria-label="搜索代币"
            />
          </span>
          <span className="section-total num">{usd(shownTotal)}</span>
        </div>
      </div>

      {groups.length ? (
        <div className="token-table-shell">
          <div className="token-card-grid">
            {mainGroups.map(renderCard)}
            {dustGroups.length > 0 && (
              <button
                type="button"
                className="token-dust-card"
                onClick={() => setDustOpen((value) => !value)}
                aria-expanded={dustOpen}
              >
                <div className="cell-token">
                  <span className="token-icon fallback" style={{ width: 28, height: 28 }}>
                    ⋯
                  </span>
                  <span className="cell-token-text">
                    <b>小额资产 {dustGroups.length} 项</b>
                    <span>每项低于 50 USDT · {dustOpen ? "点击收起" : "点击展开"}</span>
                  </span>
                </div>
                <div className="token-dust-value value-cell num">
                  <div className="cell-main">{usd(dustTotal)}</div>
                  <div className="value-bar" aria-hidden="true">
                    <i style={{ width: `${percent(dustTotal, shownTotal)}%` }} />
                  </div>
                  <div className="cell-sub">{percent(dustTotal, shownTotal).toFixed(2)}%</div>
                </div>
                <span className="token-dust-meta">多链 · {dustWallets} 个钱包</span>
              </button>
            )}
            {dustOpen && dustGroups.map(renderCard)}
          </div>
          <div className="table-foot">
            <span>代币明细合计 {usd(shownTotal)} · 占链上总额 {coverage.toFixed(1)}%</span>
            <span>
              {tokenSource === "debank"
                ? "数据源：DeBank Pro"
                : tokenSource === "zerion"
                  ? "数据源：Zerion"
                  : "数据源：公共接口（限流时会缺）"}
              {coverage < 95 ? " · 差额为未取到明细或未计价资产，不计入总额" : partial ? " · 本轮有地址使用上次成功数据" : ""}
            </span>
          </div>
        </div>
      ) : (
        <div className="empty">
          {tokens.length
            ? "没有匹配当前筛选条件的代币"
            : "还没有代币明细，点击右上角刷新即可获取"}
        </div>
      )}
    </section>
  );
}
