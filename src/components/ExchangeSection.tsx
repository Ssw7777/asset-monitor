"use client";

import type { ExchangeBalance } from "@/lib/types";
import { timeAgo, usd } from "./format";
import { TokenIcon } from "./TokenIcon";

const LABEL: Record<string, string> = { okx: "OKX", binance: "Binance", gate: "Gate" };

function statusText(exchange: ExchangeBalance) {
  switch (exchange.status) {
    case "ok":
      return { text: `实时 · ${timeAgo(exchange.lastUpdated)}`, cls: "pos" };
    case "missing_keys":
      return { text: "未配置 API · 保留上次余额", cls: "" };
    case "missing_passphrase":
      return { text: "缺少 OKX Passphrase · 保留上次余额", cls: "" };
    case "error":
      return { text: `读取失败 · 保留上次余额`, cls: "neg" };
    default:
      return { text: `基线数据 · ${timeAgo(exchange.lastUpdated)}`, cls: "" };
  }
}

/** 交易所板块：只读余额，一家失败不影响其它平台，也不影响链上数据。 */
export function ExchangeSection({
  exchanges,
  totalUsd,
}: {
  exchanges: ExchangeBalance[];
  totalUsd: number;
}) {
  return (
    <section className="section" id="exchanges">
      <div className="section-head">
        <div className="section-title">
          <h2>交易所</h2>
          <span className="hint">OKX / Binance / Gate · 只读 API，密钥仅服务端</span>
        </div>
        <span className="section-total num">{usd(totalUsd)}</span>
      </div>
      <div className="table">
        <div className="thead grid-token">
          <div>平台</div>
          <div className="right">余额</div>
          <div className="right hide-md">状态</div>
        </div>
        {exchanges.map((exchange) => {
          const status = statusText(exchange);
          const label = LABEL[exchange.exchange] || exchange.exchange;
          return (
            <div className="trow grid-token" key={exchange.exchange}>
              <div className="cell-token">
                <TokenIcon
                  symbol={label}
                  localSrc={`/icons/exchanges/${exchange.exchange}.png`}
                  size={28}
                  shape="square"
                />
                <span className="cell-token-text">
                  <b>{label}</b>
                  <span>仅读取余额，无下单 / 提现权限</span>
                </span>
              </div>
              <div className="right cell-main num">{usd(exchange.balanceUsd)}</div>
              <div className={`right cell-sub hide-md ${status.cls}`}>{status.text}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
