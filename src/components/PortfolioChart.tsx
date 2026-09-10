"use client";

import { useMemo, useState } from "react";
import { Area, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ChangeRangeKey, ChangeSummary } from "@/lib/changes";
import { CHANGE_RANGES } from "@/lib/changes";
import type { SnapshotPoint } from "@/lib/types";
import { cny, deltaClass, signedPct, signedUsd, usd } from "./format";

function formatPointTime(iso: string) {
  return new Date(iso).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface ChartPoint {
  ts: string;
  t: string;
  v: number;
  onchain: number;
  cex: number;
  manual: number;
}

function ChartTooltip({
  active,
  payload,
  rate,
}: {
  active?: boolean;
  payload?: Array<{ payload?: ChartPoint }>;
  rate: number;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;
  return (
    <div className="chart-tooltip">
      <div className="time">{formatPointTime(point.ts)}</div>
      <div className="value num">{usd(point.v)}</div>
      <div className="time num">{cny(point.v * rate)}</div>
      <div className="grid">
        <span>链上</span>
        <b>{usd(point.onchain)}</b>
        <span>交易所</span>
        <b>{usd(point.cex)}</b>
        <span>手动</span>
        <b>{usd(point.manual)}</b>
      </div>
    </div>
  );
}

/** 资产趋势：DeBank 那种细面积图，右侧是 1 小时 / 12 小时 / 24 小时 / 7 天切换。 */
export function PortfolioChart({
  snapshots,
  usdCnyRate = 6.66,
  range,
  summary,
  onRangeChange,
}: {
  snapshots: SnapshotPoint[];
  usdCnyRate?: number;
  range: ChangeRangeKey;
  summary?: ChangeSummary | null;
  onRangeChange: (range: ChangeRangeKey) => void;
}) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const rate = usdCnyRate || 6.66;
  const activeRange = CHANGE_RANGES.find((item) => item.key === range) ?? CHANGE_RANGES[2];

  const data = useMemo<ChartPoint[]>(() => {
    const cutoff = Date.now() - activeRange.ms;
    const inWindow = snapshots.filter((point) => new Date(point.ts).getTime() >= cutoff - 60_000);
    const source = inWindow.length >= 2 ? inWindow : snapshots.slice(-2);
    return source.map((point) => ({
      ts: point.ts,
      t: formatPointTime(point.ts),
      v: point.totalUsd,
      onchain: point.onchain ?? 0,
      cex: point.cex ?? 0,
      manual: point.manual ?? 0,
    }));
  }, [snapshots, activeRange.ms]);

  const yDomain = useMemo((): [number, number] => {
    if (!data.length) return [0, 1];
    const values = data.map((point) => point.v);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const pad = Math.max((max - min) * 0.15, Math.abs(max) * 0.005, 1);
    return [Math.floor(min - pad), Math.ceil(max + pad)];
  }, [data]);

  const total = summary?.total ?? null;
  const lastPoint = data.length ? data[data.length - 1] : null;
  void activeIdx;

  return (
    <section className="section" id="trend">
      <div className="section-head">
        <div className="section-title">
          <h2>资产趋势</h2>
          <span className="hint">
            全部来源合计（链上 + 交易所 + 手动）· 快照 {summary?.snapshotCount ?? snapshots.length} 条
          </span>
        </div>
        <span className="seg">
          {CHANGE_RANGES.map((item) => (
            <button
              key={item.key}
              type="button"
              className={range === item.key ? "active" : ""}
              onClick={() => {
                onRangeChange(item.key);
                setActiveIdx(null);
              }}
            >
              {item.label}
            </button>
          ))}
        </span>
      </div>

      <div className="chart-head">
        {total ? (
          <div className="chart-delta num">
            <strong className={deltaClass(total.change)}>{signedUsd(total.change)}</strong>
            <span className={deltaClass(total.change)}>{signedPct(total.pct)}</span>
            <span className="muted">
              过去 {activeRange.label}
              {summary && summary.upCount + summary.downCount > 0
                ? ` · ${summary.upCount} 个上涨 · ${summary.downCount} 个下降`
                : ""}
            </span>
          </div>
        ) : (
          <div className="muted">{summary?.reason || `数据不足以计算${activeRange.label}变化`}</div>
        )}
        {lastPoint && (
          <div className="muted num">
            最新快照 {formatPointTime(lastPoint.ts)} · {usd(lastPoint.v)}
          </div>
        )}
      </div>

      {summary && !summary.enoughData && (
        <div className="notice" style={{ marginBottom: 10 }}>
          {summary.reason}
          {summary.partial ? " · 部分数据使用上次成功记录" : ""}
        </div>
      )}

      <div className="chart-canvas">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
            onMouseMove={(state) => {
              if (state && state.activeTooltipIndex != null) {
                setActiveIdx(Number(state.activeTooltipIndex));
              }
            }}
            onMouseLeave={() => setActiveIdx(null)}
          >
            <defs>
              <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#5089ff" stopOpacity={0.18} />
                <stop offset="100%" stopColor="#5089ff" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="t"
              tick={{ fontSize: 12, fill: "#8b93a7" }}
              axisLine={false}
              tickLine={false}
              minTickGap={48}
            />
            <YAxis
              domain={yDomain}
              tick={{ fontSize: 12, fill: "#8b93a7" }}
              axisLine={false}
              tickLine={false}
              width={64}
              tickFormatter={(value) =>
                Math.abs(Number(value)) >= 10_000
                  ? `${Math.round(Number(value) / 1000)}K`
                  : Math.round(Number(value)).toLocaleString("en-US")
              }
            />
            <Tooltip
              content={<ChartTooltip rate={rate} />}
              cursor={{ stroke: "#e1e5f2", strokeWidth: 1 }}
              isAnimationActive={false}
              allowEscapeViewBox={{ x: false, y: true }}
            />
            <Area
              type="monotone"
              dataKey="v"
              stroke="none"
              fill="url(#trendFill)"
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="v"
              stroke="#5089ff"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, stroke: "#fff", strokeWidth: 2, fill: "#5089ff" }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
