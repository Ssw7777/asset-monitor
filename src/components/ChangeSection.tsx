"use client";

import type { ChangeRangeKey, ChangeSummary } from "@/lib/changes";
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

/** 资产变动：按 1 小时 / 12 小时 / 24 小时 / 7 天归因到具体钱包、交易所、DApp 与手动资产。 */
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

      {!summary?.enoughData && (
        <div className="notice warn" style={{ marginBottom: 10 }}>
          {summary?.reason || "历史数据不足"}
          {summary?.partial ? " · 部分数据使用上次成功记录" : ""}
        </div>
      )}

      {summary?.rows.length ? (
        <div className="table">
          <div className="thead grid-change">
            <div>来源</div>
            <div className="right hide-md">前值</div>
            <div className="right hide-md">现值</div>
            <div className="right">变化</div>
            <div className="right hide-md">更新时间 / 状态</div>
          </div>
          {summary.rows.map((row) => (
            <div className="trow grid-change" key={row.key}>
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
          <div className="table-foot">
            <span>
              {summary.upCount} 个上涨 · {summary.downCount} 个下降 · 共 {summary.rows.length} 条变化
              {summary.dustCount > 0 ? `（${summary.dustCount} 条低于 ${summary.minUsd} USDT 的小额变动已折叠）` : ""}
            </span>
            <span>
              波动包含链上 + 三家交易所 + 手动资产
              {summary.partial ? " · 部分数据使用上次成功记录" : ""}
            </span>
          </div>
        </div>
      ) : (
        <div className="empty">
          {loading
            ? "计算中…"
            : total
              ? "该区间内没有可归因的变化"
              : summary?.reason || "数据不足以计算该区间的变化"}
        </div>
      )}
    </section>
  );
}
