"use client";

import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SnapshotPoint } from "@/lib/types";
import { usd } from "./format";

const RANGES = [
  { key: "1h", label: "1小时", ms: 60 * 60 * 1000 },
  { key: "12h", label: "12小时", ms: 12 * 60 * 60 * 1000 },
  { key: "24h", label: "24小时", ms: 24 * 60 * 60 * 1000 },
  { key: "7d", label: "7天", ms: 7 * 24 * 60 * 60 * 1000 },
] as const;

export function PortfolioChart({ snapshots }: { snapshots: SnapshotPoint[] }) {
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("12h");

  const data = useMemo(() => {
    const ms = RANGES.find((r) => r.key === range)!.ms;
    const cutoff = Date.now() - ms;
    return snapshots
      .filter((p) => new Date(p.ts).getTime() >= cutoff)
      .map((p) => ({
        t: new Date(p.ts).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }),
        v: p.totalUsd,
      }));
  }, [snapshots, range]);

  const change = useMemo(() => {
    if (data.length < 2) return { abs: 0, pct: 0 };
    const first = data[0].v;
    const last = data[data.length - 1].v;
    const abs = last - first;
    const pct = first ? (abs / first) * 100 : 0;
    return { abs, pct };
  }, [data]);

  const positive = change.abs >= 0;

  return (
    <section className="card p-5 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <div className="text-xs tracking-wider text-gray-400 font-medium">PORTFOLIO</div>
          <h2 className="text-lg font-semibold">资产趋势</h2>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex rounded-lg bg-gray-100 p-0.5">
            {RANGES.map((r) => (
              <button
                key={r.key}
                onClick={() => setRange(r.key)}
                className={`px-3 py-1 text-sm rounded-md ${range === r.key ? "bg-white shadow-sm text-gray-900" : "text-gray-500"}`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <div className={`text-right font-semibold ${positive ? "text-emerald-500" : "text-red-500"}`}>
            {positive ? "+" : ""}{usd(change.abs)} ({positive ? "+" : ""}{change.pct.toFixed(2)}%)
          </div>
        </div>
      </div>
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <linearGradient id="pv" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="t" tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} minTickGap={40} />
            <YAxis domain={["auto", "auto"]} tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} width={70} tickFormatter={(v) => `$${Math.round(v)}`} />
            <Tooltip formatter={(v: number) => usd(v)} contentStyle={{ borderRadius: 12, border: "1px solid #f3f4f6" }} />
            <Area type="monotone" dataKey="v" stroke="#10b981" strokeWidth={2} fill="url(#pv)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
