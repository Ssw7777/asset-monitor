"use client";

import { useMemo, useState } from "react";
import {
  Area,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ReferenceDot,
} from "recharts";
import type { SnapshotPoint } from "@/lib/types";
import { cny, usd } from "./format";

const RANGES = [
  { key: "1h", label: "1小时", short: "1h", ms: 60 * 60 * 1000 },
  { key: "12h", label: "12小时", short: "12h", ms: 12 * 60 * 60 * 1000 },
  { key: "24h", label: "24小时", short: "24h", ms: 24 * 60 * 60 * 1000 },
  { key: "7d", label: "7天", short: "7d", ms: 7 * 24 * 60 * 60 * 1000 },
] as const;

function nearestSnapshot(snapshots: SnapshotPoint[], targetMs: number): SnapshotPoint | null {
  if (!snapshots.length) return null;
  let best = snapshots[0];
  let bestDist = Math.abs(new Date(best.ts).getTime() - targetMs);
  for (const p of snapshots) {
    const d = Math.abs(new Date(p.ts).getTime() - targetMs);
    if (d < bestDist) {
      best = p;
      bestDist = d;
    }
  }
  return best;
}

function formatPointTime(ts: string) {
  return new Date(ts).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ChartTooltip({
  active,
  payload,
  rate,
}: {
  active?: boolean;
  payload?: Array<{ payload?: { ts?: string; v?: number; t?: string } }>;
  rate: number;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p || p.v == null) return null;
  return (
    <div className="chart-tooltip">
      <div className="text-[11px] text-gray-400 mb-1">{p.ts ? formatPointTime(p.ts) : p.t}</div>
      <div className="text-sm font-semibold tabular-nums text-gray-900">{usd(p.v)}</div>
      <div className="text-xs text-gray-500 tabular-nums mt-0.5">{cny(p.v * rate)}</div>
    </div>
  );
}

export function PortfolioChart({
  snapshots,
  usdCnyRate = 6.66,
}: {
  snapshots: SnapshotPoint[];
  usdCnyRate?: number;
}) {
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("12h");
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const rate = usdCnyRate || 6.66;

  const rangeMs = RANGES.find((r) => r.key === range)!.ms;

  const chartData = useMemo(() => {
    const cutoff = Date.now() - rangeMs;
    const filtered = snapshots
      .filter((p) => new Date(p.ts).getTime() >= cutoff - 60_000)
      .map((p) => ({
        ts: p.ts,
        t: formatPointTime(p.ts),
        v: p.totalUsd,
        onchain: p.onchain,
        cex: p.cex,
        manual: p.manual,
        exchanges: p.exchanges,
      }));
    if (filtered.length) return filtered;
    return snapshots.slice(-2).map((p) => ({
      ts: p.ts,
      t: formatPointTime(p.ts),
      v: p.totalUsd,
      onchain: p.onchain,
      cex: p.cex,
      manual: p.manual,
      exchanges: p.exchanges,
    }));
  }, [snapshots, rangeMs]);

  const selectedIdx =
    activeIdx != null && activeIdx >= 0 && activeIdx < chartData.length
      ? activeIdx
      : chartData.length
        ? chartData.length - 1
        : 0;

  // Split series: solid left of selected (incl.), dashed right of selected
  const splitData = useMemo(() => {
    return chartData.map((d, i) => ({
      ...d,
      solid: i <= selectedIdx ? d.v : null,
      dashed: i >= selectedIdx ? d.v : null,
      fill: d.v,
    }));
  }, [chartData, selectedIdx]);

  const delta = useMemo(() => {
    const latest = snapshots.length ? snapshots[snapshots.length - 1] : null;
    if (!latest) return null;
    const target = Date.now() - rangeMs;
    const past = nearestSnapshot(snapshots, target);
    if (!past) return null;
    const abs = latest.totalUsd - past.totalUsd;
    const pct = past.totalUsd ? (abs / past.totalUsd) * 100 : 0;
    return {
      abs,
      pct,
      past,
      latest,
      breakdown: {
        onchain: (latest.onchain ?? 0) - (past.onchain ?? 0),
        cex: (latest.cex ?? 0) - (past.cex ?? 0),
        manual: (latest.manual ?? 0) - (past.manual ?? 0),
        exchanges: {
          okx: (latest.exchanges?.okx ?? 0) - (past.exchanges?.okx ?? 0),
          binance: (latest.exchanges?.binance ?? 0) - (past.exchanges?.binance ?? 0),
          gate: (latest.exchanges?.gate ?? 0) - (past.exchanges?.gate ?? 0),
        },
      },
    };
  }, [snapshots, rangeMs]);

  const positive = (delta?.abs ?? 0) >= 0;
  const selected = chartData[selectedIdx];
  const rangeLabel = RANGES.find((r) => r.key === range)?.label;

  const yDomain = useMemo((): [number, number] | [string, string] => {
    if (!chartData.length) return ["auto", "auto"];
    const vals = chartData.map((d) => d.v);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const pad = Math.max((max - min) * 0.12, Math.abs(max) * 0.01, 1);
    return [Math.floor(min - pad), Math.ceil(max + pad)];
  }, [chartData]);

  return (
    <section className="card p-4 sm:p-5 md:p-6">
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-start justify-between gap-3 mb-3 sm:mb-4">
        <div className="min-w-0">
          <div className="section-kicker">Portfolio</div>
          <h2 className="text-base sm:text-lg font-semibold mt-0.5">资产趋势</h2>
          {delta && (
            <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className={`text-lg sm:text-xl font-semibold tabular-nums ${positive ? "text-emerald-500" : "text-red-500"}`}>
                {positive ? "+" : ""}
                {usd(delta.abs)}
              </span>
              <span className={`text-sm tabular-nums ${positive ? "text-emerald-600" : "text-red-500"}`}>
                {positive ? "+" : ""}
                {delta.pct.toFixed(2)}%
              </span>
              <span className="text-xs text-gray-400">较 {rangeLabel}</span>
            </div>
          )}
        </div>
        <div className="seg self-start">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => {
                setRange(r.key);
                setActiveIdx(null);
              }}
              className={range === r.key ? "seg-item-active" : "seg-item"}
            >
              <span className="sm:hidden">{r.short}</span>
              <span className="hidden sm:inline">{r.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_220px] gap-4 items-stretch">
        <div className="h-52 sm:h-64 md:h-72 w-full min-w-0 -mx-1 sm:mx-0">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={splitData}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              onMouseMove={(state) => {
                if (state && state.activeTooltipIndex != null) {
                  setActiveIdx(Number(state.activeTooltipIndex));
                }
              }}
              onMouseLeave={() => setActiveIdx(null)}
            >
              <defs>
                <linearGradient id="portfolioFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.28} />
                  <stop offset="55%" stopColor="#10b981" stopOpacity={0.08} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="t"
                tick={{ fontSize: 11, fill: "#9ca3af" }}
                axisLine={false}
                tickLine={false}
                minTickGap={36}
              />
              <YAxis
                domain={yDomain}
                tick={{ fontSize: 11, fill: "#9ca3af" }}
                axisLine={false}
                tickLine={false}
                width={62}
                tickFormatter={(v) => `$${Math.round(v)}`}
              />
              <Tooltip
                content={<ChartTooltip rate={rate} />}
                cursor={{ stroke: "#d1d5db", strokeDasharray: "4 4" }}
                isAnimationActive={false}
                allowEscapeViewBox={{ x: false, y: true }}
              />
              <Area
                type="monotone"
                dataKey="fill"
                stroke="none"
                fill="url(#portfolioFill)"
                isAnimationActive={false}
                connectNulls
              />
              <Line
                type="monotone"
                dataKey="solid"
                stroke="#10b981"
                strokeWidth={2.75}
                dot={false}
                activeDot={{ r: 5, stroke: "#fff", strokeWidth: 2, fill: "#10b981" }}
                connectNulls={false}
                isAnimationActive={false}
                name="总额"
              />
              <Line
                type="monotone"
                dataKey="dashed"
                stroke="#10b981"
                strokeWidth={2}
                strokeDasharray="6 4"
                strokeOpacity={0.5}
                dot={false}
                activeDot={false}
                connectNulls={false}
                isAnimationActive={false}
                name="预览"
              />
              {selected && (
                <ReferenceDot
                  x={selected.t}
                  y={selected.v}
                  r={5}
                  fill="#10b981"
                  stroke="#fff"
                  strokeWidth={2}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-xl border border-gray-100 bg-gray-50/80 p-3.5 sm:p-4 flex flex-col justify-center">
          <div className="text-xs text-gray-400 mb-1">区间变动 · {rangeLabel}</div>
          {delta ? (
            <>
              <div className={`text-xl font-semibold tabular-nums ${positive ? "text-emerald-500" : "text-red-500"}`}>
                {positive ? "+" : ""}
                {usd(delta.abs)}
              </div>
              <div className={`text-sm tabular-nums ${positive ? "text-emerald-600" : "text-red-500"}`}>
                {positive ? "+" : ""}
                {delta.pct.toFixed(2)}%
              </div>
              <div className="text-[11px] text-gray-400 mt-2 leading-relaxed">
                对比 {formatPointTime(delta.past.ts)} → {formatPointTime(delta.latest.ts)}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-gray-600">
                <span className="text-gray-400">链上</span>
                <span className="text-right tabular-nums">{usd(delta.breakdown.onchain)}</span>
                <span className="text-gray-400">交易所</span>
                <span className="text-right tabular-nums">{usd(delta.breakdown.cex)}</span>
                <span className="text-gray-400">手动</span>
                <span className="text-right tabular-nums">{usd(delta.breakdown.manual)}</span>
              </div>
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="mt-3 text-xs text-blue-500 hover:underline text-left min-h-[32px]"
              >
                {expanded ? "收起交易所明细" : "展开交易所明细"}
              </button>
              {expanded && (
                <div className="mt-1 space-y-1 text-xs text-gray-500">
                  <div className="flex justify-between">
                    <span>OKX</span>
                    <span className="tabular-nums">{usd(delta.breakdown.exchanges.okx)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Binance</span>
                    <span className="tabular-nums">{usd(delta.breakdown.exchanges.binance)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Gate</span>
                    <span className="tabular-nums">{usd(delta.breakdown.exchanges.gate)}</span>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-sm text-gray-400">暂无对比数据</div>
          )}
          {selected && (
            <div className="mt-3 pt-3 border-t border-gray-200 text-xs text-gray-500 space-y-0.5">
              <div>选中点 · {selected.ts ? formatPointTime(selected.ts) : selected.t}</div>
              <div className="font-medium text-gray-700 tabular-nums">{usd(selected.v)}</div>
              <div className="tabular-nums text-gray-400">{cny(selected.v * rate)}</div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
