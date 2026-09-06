"use client";

import { useMemo, useState } from "react";
import type { Wallet } from "@/lib/types";
import { shortAddr, usd } from "./format";

type Filter = "all" | "EVM" | "ABSTRACT";

export function WalletsTable({ wallets }: { wallets: Wallet[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [sortDesc, setSortDesc] = useState(true);

  const filtered = useMemo(() => {
    let list = wallets;
    if (filter !== "all") list = list.filter((w) => w.chain === filter);
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      list = list.filter((w) => w.name.toLowerCase().includes(s) || w.address.toLowerCase().includes(s));
    }
    list = [...list].sort((a, b) => (sortDesc ? b.balanceUsd - a.balanceUsd : a.balanceUsd - b.balanceUsd));
    return list;
  }, [wallets, filter, q, sortDesc]);

  const evmCount = wallets.filter((w) => w.chain === "EVM").length;
  const absCount = wallets.filter((w) => w.chain === "ABSTRACT").length;

  function exportCsv() {
    const rows = [["name", "address", "chain", "balanceUsd"], ...filtered.map((w) => [w.name, w.address, w.chain, String(w.balanceUsd)])];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "wallets.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="card p-5 md:p-6">
      <div className="mb-4">
        <div className="text-xs tracking-wider text-gray-400 font-medium">ONCHAIN</div>
        <h2 className="text-lg font-semibold">链上钱包</h2>
        <p className="text-sm text-gray-400 mt-1">最多 50 个地址；当前 {wallets.length} 个已配置，余额由服务端同步（失败时保留上次/基线）。</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex rounded-lg bg-gray-100 p-0.5">
          {(
            [
              ["all", `全部 ${wallets.length}`],
              ["EVM", `EVM ${evmCount}`],
              ["ABSTRACT", `Abstract ${absCount}`],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`px-3 py-1.5 text-sm rounded-md ${filter === k ? "bg-white shadow-sm" : "text-gray-500"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索钱包名称/地址"
            className="rounded-xl border border-gray-200 px-3 py-1.5 text-sm w-52"
          />
          <button onClick={exportCsv} className="rounded-xl bg-blue-500 text-white px-3 py-1.5 text-sm">导出表格</button>
          <button onClick={() => setSortDesc((v) => !v)} className="rounded-xl border border-gray-200 px-3 py-1.5 text-sm">
            金额 {sortDesc ? "↓" : "↑"}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-gray-100 divide-y divide-gray-50">
        <div className="grid grid-cols-[1.4fr_100px_1fr_80px] gap-2 px-4 py-2 text-xs text-gray-400 bg-gray-50">
          <div>钱包</div>
          <div>类型</div>
          <div className="text-right">总资产折算</div>
          <div className="text-right">DeBank</div>
        </div>
        {filtered.map((w) => (
          <div key={w.id} className="grid grid-cols-[1.4fr_100px_1fr_80px] gap-2 px-4 py-3 items-center">
            <div>
              <div className="font-medium text-sm">{w.name}</div>
              <div className="text-xs text-gray-400 font-mono">{shortAddr(w.address)}</div>
            </div>
            <div>
              <span
                className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold text-white ${
                  w.chain === "EVM" ? "bg-sky-400" : "bg-violet-400"
                }`}
              >
                {w.chain}
              </span>
            </div>
            <div className="text-right">
              <div className="font-semibold">{usd(w.balanceUsd)}</div>
              <div className="text-[11px] text-gray-400">
                {w.status === "ok" ? "最新数据" : w.status === "stale" ? "缓存/旧数据" : w.status === "baseline" ? "基线展示" : "同步失败"}
              </div>
            </div>
            <div className="text-right">
              <a
                href={`https://debank.com/profile/${w.address}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-blue-500 hover:underline"
              >
                打开
              </a>
            </div>
          </div>
        ))}
      </div>
      <div className="text-xs text-gray-400 mt-3">{filtered.length} / 50 已显示 · 链上数据来自 DeBank（服务端）</div>
    </section>
  );
}
