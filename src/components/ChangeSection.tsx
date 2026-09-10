"use client";

import { useMemo, useState } from "react";
import type { ChangeRangeKey, ChangeRow, ChangeSummary } from "@/lib/changes";
import { CHANGE_RANGES } from "@/lib/changes";
import { deltaClass, signedPct, signedUsd, timeAgo, usd } from "./format";

const TYPE_LABEL: Record<string, string> = {
  onchain: "链上",
  exchange: "交易所",
  dapp: "DApp",
  wallet: "钱包",
  manual: "手动",
};

const STATUS_LABEL: Record<string, string> = {
  live: "实时",
  cached: "上次成功数据",
  error: "读取失败",
  baseline: "基线数据",
  manual: "手动记录",
};

const PAGE_SIZE = 15;

/** 一个可翻页的变动表（钱包 / 交易所各一张，长期快照最多 7 天）。 */
function ChangeTable({
  title,
  hint,
  rows,
  emptyText,
}: {
  title: string;
  hint: string;
  rows: ChangeRow[];
  emptyText: string;
}) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const slice = useMemo(
    () => rows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE),
    [rows, safePage]
  );
  const total = rows.reduce((sum, row) => sum + row.change, 0);

  return (
    <div style={{ marginTop: 18 }}>
      <div className="section-head" style={{ paddingBottom: 8 }}>
        <div className="section-title">
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{title}</h3>
          <span className="hint">
            {hint} · 共 {rows.length} 条
          </span>
        </div>
        <span className={`section-total num ${deltaClass(total)}`}>{signedUsd(total)}</span>
      </div>

      {rows.length ? (
        <div className="table">
          <div className="thead grid-change">
            <div>来源</div>
            <div className="right hide-md">前值</div>
            <div className="right hide-md">现值</div>
            <div className="right">变化</div>
            <div className="right hide-md">更新时间 / 状态</div>
          </div>
          {slice.map((row) => (
            <div className="trow grid-change" key={`${title}-${row.key}`}>
              <div className="cell-token-text">
                <b>
                  <span className="tag line" style={{ marginRight: 6 }}>
                    {TYPE_LABEL[row.type] || row.type}
                  </span>
                  {row.label}
                </b>
                <span>{row.detail}</span>
              </div>
              <div className="right cell-main num hide-md">{usd(row.before)}</div>
              <div className="right cell-main num hide-md">{usd(row.after)}</div>
              <div className={`right num ${deltaClass(row.change)}`}>
                <div className="cell-main">{signedUsd(row.change)}</div>
                <div className="cell-sub">{signedPct(row.pct)}</div>
              </div>
              <div className="right hide-md">
                <div className="cell-sub">{timeAgo(row.updatedAt)}</div>
                <div className={`cell-sub ${row.dataStatus === "live" ? "pos" : ""}`}>
                  {STATUS_LABEL[row.dataStatus] || row.dataStatus}
                </div>
              </div>
            </div>
          ))}
          {pageCount > 1 && (
            <div className="pager">
              <button
                type="button"
                className="btn btn-outline !min-h-[32px]"
                disabled={safePage === 0}
                onClick={() => setPage(Math.max(0, safePage - 1))}
              >
                上一页
              </button>
              <span className="small num">
                第 {safePage + 1} / {pageCount} 页
              </span>
              <button
                type="button"
                className="btn btn-outline !min-h-[32px]"
                disabled={safePage >= pageCount - 1}
                onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))}
              >
                下一页
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="empty">{emptyText}</div>
      )}
    </div>
  );
}

/** 资产变动：钱包与交易所分成两个独立窗口，各自可翻页查看 7 天内的长期快照。 */
export function ChangeSection({
  range,
  summary,
  loading,
  onRangeChange,
}: {
  range: ChangeRangeKey;
  summary: ChangeSummary | null;
  loading: boolean;
  onRangeChange: (range: ChangeRangeKey) => void;
}) {
  const total = summary?.total ?? null;
  const rows = summary?.rows ?? [];
  const walletRows = rows.filter((row) => row.type !== "exchange");
  const exchangeRows = rows.filter((row) => row.type === "exchange");

  return (
    <section className="section" id="changes">
      <div className="section-head">
        <div className="section-title">
          <h2>资产变动</h2>
          <span className="hint">
            {loading
              ? "计算中…"
              : total
                ? `对比 ${summary!.from ? new Date(summary!.from.ts).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"} → ${summary!.to ? new Date(summary!.to.ts).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}`
                : summary?.reason || "暂无对比数据"}
          </span>
        </div>
        <div className="inline">
          {total && (
            <span className={`section-total num ${deltaClass(total.change)}`}>
              {signedUsd(total.change)} · {signedPct(total.pct)}
            </span>
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
        </div>
      </div>

      {summary && !summary.enoughData && (
        <div className="notice warn" style={{ marginBottom: 10 }}>
          {summary.reason}
          {summary.partial ? " · 部分数据使用上次成功记录" : ""}
        </div>
      )}

      <ChangeTable
        title="钱包变动"
        hint="链上地址 + 手动资产"
        rows={walletRows}
        emptyText={loading ? "计算中…" : "该区间内钱包没有可归因的变化"}
      />
      <ChangeTable
        title="交易所变动"
        hint="OKX / Binance / Gate"
        rows={exchangeRows}
        emptyText={loading ? "计算中…" : "该区间内交易所没有可归因的变化"}
      />

      <div className="table-foot" style={{ paddingLeft: 0, paddingRight: 0 }}>
        <span>
          {summary?.upCount ?? 0} 个上涨 · {summary?.downCount ?? 0} 个下降
          {summary?.dustCount ? `（${summary.dustCount} 条低于 ${summary.minUsd} USDT 已折叠）` : ""}
        </span>
        <span>波动包含链上 + 三家交易所 + 手动资产 · 快照保留 7 天</span>
      </div>
    </section>
  );
}
