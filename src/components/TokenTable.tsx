"use client";

import { useMemo, useState } from "react";
import type { TokenHolding } from "@/lib/types";
import { amountNum, priceUsd, shortAddr, usd } from "./format";
import { TokenIcon } from "./TokenIcon";

function percent(value: number, total: number) {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(100, (value / total) * 100));
}

/**
 * DeBank 的 Wallet 版式：代币 / 价格 / 数量 / USD 价值，价值带占比条。
 * 多钱包综合体多一列“钱包数”，点开可以看到这个币分别来自哪些钱包。
 */
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
  const [openId, setOpenId] = useState<string | null>(null);
  const [dustOpen, setDustOpen] = useState(false);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return tokens.filter(
      (token) =>
        (chainFilter === "all" || token.chain === chainFilter) &&
        (!keyword || token.symbol.toLowerCase().includes(keyword))
    );
  }, [tokens, chainFilter, query]);

  const shownTotal = useMemo(
    () => filtered.reduce((sum, token) => sum + token.valueUsd, 0),
    [filtered]
  );
  /** 小于 10 USDT 的一律折叠成一行，避免一堆小额代币把主列表冲散。 */
  const mainTokens = useMemo(
    () => filtered.filter((token) => token.valueUsd >= 10),
    [filtered]
  );
  const dustTokens = useMemo(
    () => filtered.filter((token) => token.valueUsd < 10),
    [filtered]
  );
  const dustTotal = useMemo(
    () => dustTokens.reduce((sum, token) => sum + token.valueUsd, 0),
    [dustTokens]
  );
  const coverage = onchainUsd > 0 ? (shownTotal / onchainUsd) * 100 : 0;

  return (
    <section className="section" id="tokens">
      <div className="section-head">
        <div className="section-title">
          <h2>代币</h2>
          <span className="hint">
            {filtered.length} / {tokens.length} 个
            {chainFilter !== "all" ? "（已按链筛选）" : ""}
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

      {filtered.length ? (
        <div className="table">
          <div className="thead grid-token">
            <div>代币</div>
            <div className="right hide-md">价格</div>
            <div className="right hide-md">数量</div>
            <div className="right">价值 (U)</div>
            <div className="right hide-lg">链</div>
            <div className="right hide-lg">钱包</div>
          </div>
          {(dustOpen ? filtered : mainTokens).map((token) => {
            const open = openId === token.id;
            const share = percent(token.valueUsd, shownTotal);
            return (
              <div
                key={token.id}
                className={`trow grid-token clickable${open ? " open" : ""}`}
                onClick={() => setOpenId(open ? null : token.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setOpenId(open ? null : token.id);
                  }
                }}
              >
                <div className="cell-token">
                  <TokenIcon symbol={token.symbol} logoUrl={token.logoUrl} />
                  <span className="cell-token-text">
                    <b>{token.symbol}</b>
                    <span>
                      {token.kind === "stable" ? "稳定币" : token.kind === "native" ? "主链币" : "现货"}
                      {token.walletCount > 1 ? ` · ${token.walletCount} 个钱包` : ""}
                    </span>
                  </span>
                </div>
                <div className="right cell-main num hide-md">{priceUsd(token.price)}</div>
                <div className="right num hide-md">
                  <div className="cell-main">{amountNum(token.amount)}</div>
                  <div className="cell-sub">{token.symbol}</div>
                </div>
                <div className="value-cell num">
                  <div className="cell-main">{usd(token.valueUsd)}</div>
                  <div className="value-bar" aria-hidden="true">
                    <i style={{ width: `${share}%` }} />
                  </div>
                  <div className="cell-sub">{share.toFixed(2)}%</div>
                </div>
                <div className="right hide-lg">
                  <span className="chain-chip" style={{ justifyContent: "flex-end" }}>
                    <TokenIcon
                      symbol={token.chainName}
                      localSrc={`/icons/chains/${token.chain}.png`}
                      size={16}
                      shape="square"
                    />
                    {token.chainName}
                  </span>
                </div>
                <div className="right cell-main num hide-lg">{token.walletCount}</div>

                {open && (
                  <div className="row-detail">
                    <div className="small" style={{ marginBottom: 8 }}>
                      该代币在各钱包的持仓（{token.wallets.length}）
                    </div>
                    <div className="detail-grid">
                      {token.wallets.map((wallet) => (
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
          })}
          {dustTokens.length > 0 && (
            <div
              className="trow grid-token clickable"
              onClick={() => setDustOpen((value) => !value)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setDustOpen((value) => !value);
                }
              }}
            >
              <div className="cell-token">
                <span className="token-icon fallback" style={{ width: 28, height: 28 }}>
                  ⋯
                </span>
                <span className="cell-token-text">
                  <b>小额资产 {dustTokens.length} 项</b>
                  <span>每项低于 10 USDT · {dustOpen ? "点击收起" : "点击展开"}</span>
                </span>
              </div>
              <div className="right cell-main num hide-md">—</div>
              <div className="right cell-main num hide-md">—</div>
              <div className="value-cell num">
                <div className="cell-main">{usd(dustTotal)}</div>
                <div className="value-bar" aria-hidden="true">
                  <i style={{ width: `${percent(dustTotal, shownTotal)}%` }} />
                </div>
                <div className="cell-sub">{percent(dustTotal, shownTotal).toFixed(2)}%</div>
              </div>
              <div className="right chain-chip hide-lg">
                <i />
                多链
              </div>
              <div className="right cell-main num hide-lg">
                {dustTokens.length}
              </div>
            </div>
          )}
          <div className="table-foot">
            <span>代币明细合计 {usd(shownTotal)} · 占链上总额 {coverage.toFixed(1)}%</span>
            <span>
              {tokenSource === "debank"
                ? "数据源：DeBank Pro"
                : tokenSource === "zerion"
                  ? "数据源：Zerion（免费）"
                  : "数据源：公共接口（限流时会缺）"}
              {coverage < 95 ? " · 差额为未取到明细或未计价资产，不计入总额" : partial ? " · 本轮有地址使用上次成功数据" : ""}
            </span>
          </div>
        </div>
      ) : (
        <div className="empty">
          {tokens.length ? (
            "没有匹配当前筛选条件的代币"
          ) : (
            <>
              还没有代币明细。
              {tokenSource === "zerion" || tokenSource === "debank"
                ? "点击右上角刷新即可获取。"
                : "公共接口对脚本请求限流很严，建议配置免费的 ZERION_API_KEY（Zerion 免费版一个请求即可拿到全链代币），或等待公共接口放行后自动补齐。"}
            </>
          )}
        </div>
      )}
    </section>
  );
}
