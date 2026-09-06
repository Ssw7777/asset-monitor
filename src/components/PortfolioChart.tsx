"use client";

import { useMemo, useState } from "react";
import {
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ReferenceDot,
} from "recharts";
import type { SnapshotPoint } from "@/lib/types";
import { usd } from "./format";

const RANGES = [
  { key: "1h", label: "1小时", ms: 60 * 60 * 1000 },
  { key: "12h", label: "12小时", ms: 12 * 60 * 60 * 1000 },
  { key: "24h", label: "24小时", ms: 24 * 60 * 60 * 1000 },
  { key: "7d", label: "7天", ms: 7 * 24 * 60 * 60 * 1000 },
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

export function PortfolioChart({ snapshots }: { snapshots: SnapshotPoint[] }) {
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("12h");
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);

  const rangeMs = RANGES.find((r) => r.key === range)!.ms;

  const chartData = useMemo(() => {
    const cutoff = Date.now() - rangeMs;
    const filtered = snapshots
      .filter((p) => new Date(p.ts).getTime() >= cutoff - 60_000)
      .map((p) => ({
        ts: p.ts,
        t: new Date(p.ts).toLocaleString("zh-CN", {
          month: "numeric",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }),
        v: p.totalUsd,
        onchain: p.onchain,
        cex: p.cex,
        manual: p.manual,
        exchanges: p.exchanges,
      }));
    return filtered.length ? filtered : snapshots.slice(-2).map((p) => ({
      ts: p.ts,
      t: new Date(p.ts).toLocaleString("zh-CN", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
      v: p.totalUsd,
      onchain: p.onchain,
      cex: p.cex,
      manual: p.manual,
      exchanges: p.exchanges,
    }));
  }, [snapshots, rangeMs]);

  const selectedIdx = activeIdx != null && activeIdx >= 0 && activeIdx < chartData.length
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

  return (
    <section className="card p-5 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <div className="text-xs tracking-wider text-gray-400 font-medium">PORTFOLIO</div>
          <h2 className="text-lg font-semibold">资产趋势</h2>
        </div>
        <div className="flex rounded-lg bg-gray-100 p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => {
                setRange(r.key);
                setActiveIdx(null);
              }}
              className={`px-3 py-1 text-sm rounded-md ${
                range === r.key ? "bg-white shadow-sm text-gray-900" : "text-gray-500"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_200px] gap-4 items-stretch">
        <div className="h-56 w-full min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={splitData}
              onMouseMove={(state) => {
                if (state && state.activeTooltipIndex != null) {
                  setActiveIdx(Number(state.activeTooltipIndex));
                }
              }}
              onMouseLeave={() => setActiveIdx(null)}
            >
              <XAxis
                dataKey="t"
                tick={{ fontSize: 11, fill: "#9ca3af" }}
                axisLine={false}
                tickLine={false}
                minTickGap={40}
              />
              <YAxis
                domain={["auto", "auto"]}
                tick={{ fontSize: 11, fill: "#9ca3af" }}
                axisLine={false}
                tickLine={false}
                width={70}
                tickFormatter={(v) => `$${Math.round(v)}`}
              />
              <Tooltip
                formatter={(v: number) => usd(v)}
                labelFormatter={(_, payload) => {
                  const p = payload?.[0]?.payload;
                  return p?.t || "";
                }}
                contentStyle={{ borderRadius: 12, border: "1px solid #f3f4f6" }}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="solid"
                stroke="#10b981"
                strokeWidth={2.5}
                dot={false}
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
                strokeOpacity={0.55}
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
                name="预览"
              />
              {selected && (
                <ReferenceDot
                  x={selected.t}
                  y={selected.v}
                  r={4}
                  fill="#10b981"
                  stroke="#fff"
                  strokeWidth={2}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-xl border border-gray-100 bg-gray-50/80 p-4 flex flex-col justify-center">
          <div className="text-xs text-gray-400 mb-1">较 {RANGES.find((r) => r.key === range)?.label}</div>
          {delta ? (
            <>
              <div className={`text-xl font-semibold ${positive ? "text-emerald-500" : "text-red-500"}`}>
                {positive ? "+" : ""}
                {usd(delta.abs)}
              </div>
              <div className={`text-sm ${positive ? "text-emerald-600" : "text-red-500"}`}>
                {positive ? "+" : ""}
                {delta.pct.toFixed(2)}%
              </div>
              <div className="text-[11px] text-gray-400 mt-2">
                对比最近点 · {new Date(delta.past.ts).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
              </div>
              <button
                onClick={() => setExpanded((v) => !v)}
                className="mt-3 text-xs text-blue-500 hover:underline text-left"
              >
                {expanded ? "收起明细" : "展开明细"}
              </button>
              {expanded && (
                <div className="mt-2 space-y-1 text-xs text-gray-600">
                  <div className="flex justify-between">
                    <span>链上</span>
                    <span>{usd(delta.breakdown.onchain)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>交易所</span>
                    <span>{usd(delta.breakdown.cex)}</span>
                  </div>
                  <div className="flex justify-between pl-2 text-gray-400">
                    <span>OKX</span>
                    <span>{usd(delta.breakdown.exchanges.okx)}</span>
                  </div>
                  <div className="flex justify-between pl-2 text-gray-400">
                    <span>Binance</span>
                    <span>{usd(delta.breakdown.exchanges.binance)}</span>
                  </div>
                  <div className="flex justify-between pl-2 text-gray-400">
                    <span>Gate</span>
                    <span>{usd(delta.breakdown.exchanges.gate)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>手动</span>
                    <span>{usd(delta.breakdown.manual)}</span>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-sm text-gray-400">暂无对比数据</div>
          )}
          {selected && (
            <div className="mt-3 pt-3 border-t border-gray-200 text-xs text-gray-500">
              选中点 {usd(selected.v)}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
