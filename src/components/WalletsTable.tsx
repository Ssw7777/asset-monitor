"use client";

import { useMemo, useState } from "react";
import type { ChainType, Wallet } from "@/lib/types";
import { shortAddr, timeAgo, usd } from "./format";

type Filter = "all" | "EVM" | "ABSTRACT";

export function WalletsTable({
  wallets,
  onChange,
}: {
  wallets: Wallet[];
  onChange?: (wallets: Wallet[]) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [sortDesc, setSortDesc] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showBatch, setShowBatch] = useState(false);
  const [form, setForm] = useState({ name: "", address: "", chain: "EVM" as ChainType });
  const [batchText, setBatchText] = useState("");
  const [batchChain, setBatchChain] = useState<ChainType>("EVM");
  const [msg, setMsg] = useState("");
  const [editId, setEditId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let list = wallets;
    if (filter !== "all") list = list.filter((w) => w.chain === filter);
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      list = list.filter(
        (w) => w.name.toLowerCase().includes(s) || w.address.toLowerCase().includes(s)
      );
    }
    list = [...list].sort((a, b) =>
      sortDesc ? b.balanceUsd - a.balanceUsd : a.balanceUsd - b.balanceUsd
    );
    return list;
  }, [wallets, filter, q, sortDesc]);

  const evmCount = wallets.filter((w) => w.chain === "EVM").length;
  const absCount = wallets.filter((w) => w.chain === "ABSTRACT").length;
  const okCount = wallets.filter((w) => w.status === "ok" || w.status === "cached" || w.status === "stale" || w.status === "baseline").length;

  async function api(body: Record<string, unknown>) {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/wallets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg(data.error || "操作失败");
        return null;
      }
      if (onChange && data.wallets) onChange(data.wallets);
      return data;
    } finally {
      setBusy(false);
    }
  }

  async function saveWallet() {
    const payload: Record<string, unknown> = {
      action: "upsert",
      name: form.name,
      address: form.address,
      chain: form.chain,
    };
    if (editId) payload.id = editId;
    const data = await api(payload);
    if (data) {
      setShowAdd(false);
      setEditId(null);
      setForm({ name: "", address: "", chain: "EVM" });
      setMsg(editId ? "已更新" : "已添加");
    }
  }

  async function removeWallet(id: string) {
    if (!confirm("确认删除该钱包？")) return;
    await api({ action: "delete", id });
  }

  async function batchImport() {
    const data = await api({
      action: "batch",
      text: batchText,
      chain: batchChain,
      namePrefix: "Import",
    });
    if (data) {
      setShowBatch(false);
      setBatchText("");
      setMsg(`导入完成：新增 ${data.added || 0}，跳过重复 ${data.skipped || 0}`);
    }
  }

  function exportCsv() {
    const header = ["name", "address", "balance"];
    const rows = filtered.map((w) => [w.name, w.address, String(w.balanceUsd)]);
    const csv = [header, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\r\n");
    // BOM for Excel
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "wallets.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function startEdit(w: Wallet) {
    setEditId(w.id);
    setForm({ name: w.name, address: w.address, chain: w.chain });
    setShowAdd(true);
    setShowBatch(false);
  }

  return (
    <section className="card p-5 md:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs tracking-wider text-gray-400 font-medium">ONCHAIN</div>
          <h2 className="text-lg font-semibold">链上钱包</h2>
          <p className="text-sm text-gray-400 mt-1">
            最多 50 个地址；当前 {wallets.length} 个 · 同步成功/可用 {okCount}/{wallets.length} · 失败保留上次余额
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => {
              setShowAdd((v) => !v);
              setShowBatch(false);
              setEditId(null);
              setForm({ name: "", address: "", chain: "EVM" });
            }}
            className="rounded-xl border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50"
            disabled={busy || wallets.length >= 50}
          >
            + 添加
          </button>
          <button
            onClick={() => {
              setShowBatch((v) => !v);
              setShowAdd(false);
            }}
            className="rounded-xl border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50"
            disabled={busy}
          >
            批量导入
          </button>
          <button onClick={exportCsv} className="rounded-xl bg-blue-500 text-white px-3 py-1.5 text-sm">
            导出 CSV
          </button>
        </div>
      </div>

      {msg && <div className="text-sm text-gray-500 mb-3">{msg}</div>}

      {showAdd && (
        <div className="mb-4 rounded-xl border border-gray-100 p-4 space-y-3 bg-gray-50/50">
          <div className="text-sm font-medium">{editId ? "编辑钱包" : "添加钱包"}</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <input
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
              placeholder="名称"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
            <input
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono"
              placeholder="0x…"
              value={form.address}
              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
            />
            <select
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
              value={form.chain}
              onChange={(e) => setForm((f) => ({ ...f, chain: e.target.value as ChainType }))}
            >
              <option value="EVM">EVM</option>
              <option value="ABSTRACT">ABSTRACT（自动加后缀）</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button
              onClick={saveWallet}
              disabled={busy || !form.address}
              className="rounded-xl bg-gray-900 text-white px-4 py-1.5 text-sm disabled:opacity-50"
            >
              {busy ? "保存中…" : "保存"}
            </button>
            <button
              onClick={() => {
                setShowAdd(false);
                setEditId(null);
              }}
              className="rounded-xl border border-gray-200 px-4 py-1.5 text-sm"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {showBatch && (
        <div className="mb-4 rounded-xl border border-gray-100 p-4 space-y-3 bg-gray-50/50">
          <div className="text-sm font-medium">批量导入地址</div>
          <p className="text-xs text-gray-400">每行一个 0x 地址，或逗号/空格分隔；自动去重，跳过已存在。</p>
          <textarea
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono h-28"
            placeholder={"0xabc...\n0xdef..."}
            value={batchText}
            onChange={(e) => setBatchText(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm"
              value={batchChain}
              onChange={(e) => setBatchChain(e.target.value as ChainType)}
            >
              <option value="EVM">EVM</option>
              <option value="ABSTRACT">ABSTRACT</option>
            </select>
            <button
              onClick={batchImport}
              disabled={busy || !batchText.trim()}
              className="rounded-xl bg-gray-900 text-white px-4 py-1.5 text-sm disabled:opacity-50"
            >
              {busy ? "导入中…" : "开始导入"}
            </button>
            <button
              onClick={() => setShowBatch(false)}
              className="rounded-xl border border-gray-200 px-4 py-1.5 text-sm"
            >
              取消
            </button>
          </div>
        </div>
      )}

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
              className={`px-3 py-1.5 text-sm rounded-md ${
                filter === k ? "bg-white shadow-sm" : "text-gray-500"
              }`}
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
          <button
            onClick={() => setSortDesc((v) => !v)}
            className="rounded-xl border border-gray-200 px-3 py-1.5 text-sm"
          >
            金额 {sortDesc ? "↓" : "↑"}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-gray-100 divide-y divide-gray-50 overflow-x-auto">
        <div className="grid grid-cols-[1.4fr_80px_1fr_70px_90px] gap-2 px-4 py-2 text-xs text-gray-400 bg-gray-50 min-w-[560px]">
          <div>钱包</div>
          <div>类型</div>
          <div className="text-right">总资产 / 状态</div>
          <div className="text-right">DeBank</div>
          <div className="text-right">操作</div>
        </div>
        {filtered.map((w) => (
          <div
            key={w.id}
            className="grid grid-cols-[1.4fr_80px_1fr_70px_90px] gap-2 px-4 py-3 items-center min-w-[560px]"
          >
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
                {w.status === "ok"
                  ? `最新 · ${timeAgo(w.lastUpdated)}`
                  : w.status === "cached" || w.status === "stale"
                    ? `缓存 · ${timeAgo(w.lastUpdated)}`
                    : w.status === "baseline"
                      ? `基线 · ${timeAgo(w.lastUpdated)}`
                      : "同步失败（保留上次）"}
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
            <div className="text-right space-x-2">
              <button onClick={() => startEdit(w)} className="text-xs text-gray-500 hover:underline">
                编辑
              </button>
              <button
                onClick={() => removeWallet(w.id)}
                className="text-xs text-red-500 hover:underline"
              >
                删
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="text-xs text-gray-400 mt-3">
        {filtered.length} / 50 已显示 · 链上数据来自 DeBank（并发 3 · 重试 2 · 失败不归零）
      </div>
    </section>
  );
}
