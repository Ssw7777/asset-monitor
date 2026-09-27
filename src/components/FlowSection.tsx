"use client";

import type { FlowEvent, FlowRangeKey, FlowSummary } from "@/lib/flows";
import { FLOW_RANGES } from "@/lib/flows";
import { useEffect, useState } from "react";
import Link from "next/link";
import { amountNum, shortAddr, timeAgo, usd } from "./format";

const DIRECTION: Record<FlowEvent["direction"], { cls: string }> = {
  in: { cls: "pos" },
  out: { cls: "neg" },
  transfer: { cls: "" },
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
  const [page, setPage] = useState(0);
  const pageSize = 8;
  const pages = Math.max(1, Math.ceil(events.length / pageSize));
  const currentPage = Math.min(page, pages - 1);
  const visibleEvents = events.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  useEffect(() => setPage(0), [range, minUsd]);

  return (
    <section className="section section-surface section-flows" id="flows">
      <div className="section-head">
        <div className="section-title">
          <h2 title="余额估值变化，不等于转账。没有交易哈希时不推断资金去向。">资金变动流水</h2>
          <strong className={`flow-net num ${net >= 0 ? "pos" : "neg"}`}>
            {net > 0 ? "+" : net < 0 ? "-" : ""}
            {usd(Math.abs(net))}
          </strong>
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
      <div className="flow-explanation">余额估值变动 · 非转账记录 · <Link prefetch={false} href="/transactions" target="_blank">核验链上交易 ↗</Link></div>

      {events.length ? (
        <div className="table">
          <div className="flow-scroll">
            <div className="thead grid-flow">
              <div>时间</div>
              <div className="right">变动</div>
              <div className="hide-md">变动钱包/交易所</div>
              <div className="right flow-balance">余额变化</div>
            </div>
            {visibleEvents.map((event) => {
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
                  </div>
                  <div className="cell-token-text flow-entity hide-md">
                    <b>{event.entityLabel}</b>
                    <span>
                      {event.entityAddress ? shortAddr(event.entityAddress) : event.entityLabel}
                    </span>
                  </div>
                  <div className="right cell-sub num flow-balance">
                    {amountNum(event.before)} → {usd(event.after)}
                  </div>
                  <div className="flow-meta cell-sub">
                    {event.entityLabel}
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
      <div className="flow-pagination">
        <span className="small">{currentPage + 1} / {pages} 页 · 已载入 {events.length} 条</span>
        <div className="inline">
          <button className="btn btn-outline" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页</button>
          <button className="btn btn-outline" disabled={currentPage === pages - 1} onClick={() => setPage(currentPage + 1)}>下一页</button>
        </div>
      </div>
    </section>
  );
}
