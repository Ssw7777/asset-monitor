"use client";

import type { FlowEvent, FlowRangeKey, FlowSummary } from "@/lib/flows";
import { FLOW_RANGES } from "@/lib/flows";
import { amountNum, shortAddr, timeAgo, usd } from "./format";

const DIRECTION: Record<FlowEvent["direction"], { cls: string }> = {
  in: { cls: "pos" },
  out: { cls: "neg" },
  transfer: { cls: "" },
};

/** 兼容历史记录：只收起“外部”的解释性括号，不改钱包或协议名称里的括号。 */
function compactExternalLabel(value: string) {
  return /^外部[（(]/.test(value) ? "外部" : value;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * 资金变动流水：每轮刷新都会把“超过阈值的余额变化”记一条，
 * 并给出金额、方向、变动钱包 / 交易所与前后余额。
 */
export function FlowSection({
  summary,
  loading,
  range,
  minUsd,
  onRangeChange,
  onMinChange,
}: {
  summary: FlowSummary | null;
  loading: boolean;
  range: FlowRangeKey;
  minUsd: number;
  onRangeChange: (range: FlowRangeKey) => void;
  onMinChange: (min: number) => void;
}) {
  const events = summary?.events ?? [];
  const net = summary?.netUsd ?? 0;

  return (
    <section className="section section-surface section-flows" id="flows">
      <div className="section-head">
        <div className="section-title">
          <h2>资金变动流水</h2>
        </div>
        <div className="inline">
          <span className="seg">
            {FLOW_RANGES.map((item) => (
              <button
                key={item.key}
                type="button"
                className={range === item.key ? "active" : ""}
                onClick={() => onRangeChange(item.key)}
              >
                {item.key === "all" ? "全部" : item.key}
              </button>
            ))}
          </span>
          <span className="seg">
            {[50, 100, 500].map((value) => (
              <button
                key={value}
                type="button"
                className={minUsd === value ? "active" : ""}
                onClick={() => onMinChange(value)}
              >
                ≥{value}U
              </button>
            ))}
          </span>
        </div>
      </div>

      <div className="flow-summary">
        <strong className={`num ${net >= 0 ? "pos" : "neg"}`}>
          {net > 0 ? "+" : net < 0 ? "-" : ""}
          {usd(Math.abs(net))}
        </strong>
      </div>

      {events.length ? (
        <div className="table">
          <div className="flow-scroll">
            <div className="thead grid-flow">
              <div>时间</div>
              <div className="right">变动</div>
              <div className="hide-md">变动钱包/交易所</div>
              <div className="right hide-md">余额变化</div>
            </div>
            {events.map((event) => {
              const direction = DIRECTION[event.direction];
              const from = compactExternalLabel(event.from);
              const to = compactExternalLabel(event.to);
              return (
                <div className="trow grid-flow" key={event.id}>
                  <div className="cell-token-text">
                    <b>{formatTime(event.ts)}</b>
                    <span>{timeAgo(event.ts)}</span>
                  </div>
                  <div className={`right num ${direction.cls}`}>
                    <div className="cell-main">
                      {event.direction === "out" ? "-" : event.direction === "in" ? "+" : "±"}
                      {usd(event.amountUsd)}
                    </div>
                  </div>
                  <div className="cell-token-text flow-entity hide-md">
                    <b>{from} → {to}</b>
                    <span>
                      {event.entityAddress ? shortAddr(event.entityAddress) : event.entityLabel}
                    </span>
                  </div>
                  <div className="right cell-sub num flow-balance hide-md">
                    {amountNum(event.before)} → {usd(event.after)}
                  </div>
                  <div className="flow-meta cell-sub">
                    {from} → {to}
                    {event.entityAddress ? ` · ${shortAddr(event.entityAddress)}` : ""} · {amountNum(event.before)} →{" "}
                    {usd(event.after)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="empty">
          {loading
            ? "读取中…"
            : `还没有超过 ${minUsd} U 的变动记录：每轮刷新会自动比对并记录，时间越久记录越完整`}
        </div>
      )}
    </section>
  );
}
