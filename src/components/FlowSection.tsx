"use client";

import type { FlowEvent, FlowRangeKey, FlowSummary } from "@/lib/flows";
import { FLOW_RANGES } from "@/lib/flows";
import { shortAddr, timeAgo, usd } from "./format";

const DIRECTION: Record<FlowEvent["direction"], { label: string; cls: string }> = {
  in: { label: "增加", cls: "pos" },
  out: { label: "减少", cls: "neg" },
  transfer: { label: "疑似转账", cls: "" },
};

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
 * 并给出金额、方向、来源、去路、涉及钱包与前后余额。
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

  return (
    <section className="section" id="flows">
      <div className="section-head">
        <div className="section-title">
          <h2>资金变动流水</h2>
          <span className="hint">
            超过 {minUsd} U 的变动自动记录 · 已扫描 {summary?.intervals ?? 0} 轮
            {summary?.scannedFrom ? ` · 最早 ${timeAgo(summary.scannedFrom)}` : ""}
          </span>
        </div>
        <div className="inline">
          <span className="section-total num">
            <span className="pos">+{usd(summary?.totalIn ?? 0)}</span>
            {" / "}
            <span className="neg">-{usd(summary?.totalOut ?? 0)}</span>
          </span>
          <span className="seg">
            {FLOW_RANGES.map((item) => (
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

      {events.length ? (
        <div className="table">
          <div className="thead grid-flow">
            <div>时间</div>
            <div className="right">变动</div>
            <div className="hide-md">来源</div>
            <div className="hide-md">去路</div>
            <div className="hide-md">对象</div>
            <div className="right hide-lg">余额变化</div>
          </div>
          {events.map((event) => {
            const direction = DIRECTION[event.direction];
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
                  <div className="cell-sub">
                    {direction.label}
                    {event.changePct == null
                      ? ""
                      : ` · ${event.changePct > 0 ? "+" : ""}${event.changePct.toFixed(2)}%`}
                  </div>
                </div>
                <div className="cell-main hide-md">{event.from}</div>
                <div className="cell-main hide-md">{event.to}</div>
                <div className="cell-token-text hide-md">
                  <b>{event.entityLabel}</b>
                  <span>
                    {event.entityType === "wallet" ? "钱包" : event.entityType === "exchange" ? "交易所" : "手动"}
                    {event.entityAddress ? ` · ${shortAddr(event.entityAddress)}` : ""}
                  </span>
                </div>
                <div className="right cell-sub num hide-lg">
                  {usd(event.before)} → {usd(event.after)}
                </div>
                <div className="flow-meta cell-sub">
                  {event.from} → {event.to} · {event.entityLabel}
                  {event.entityAddress ? ` ${shortAddr(event.entityAddress)}` : ""} · {usd(event.before)} →{" "}
                  {usd(event.after)}
                </div>
              </div>
            );
          })}
          <div className="table-foot">
            <span>
              净流入 {usd(summary?.netUsd ?? 0)} · 共 {events.length} 条记录（只显示最新 {events.length} 条）
            </span>
            <span>{summary?.note}</span>
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
