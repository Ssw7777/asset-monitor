"use client";

import { useMemo, useState } from "react";
import type { ChainType, Wallet } from "@/lib/types";
import { shortAddr, timeAgo, usd } from "./format";

type Filter = "all" | "EVM" | "ABSTRACT";

/** 地址管理：DeBank 风格表格 + 行内编辑，最多 50 条，删除需确认。 */
export function WalletsTable({
  wallets,
  onChange,
}: {
  wallets: Wallet[];
  onChange?: (wallets: Wallet[]) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<"none" | "add" | "batch">("none");
  const [form, setForm] = useState({ name: "", address: "", chain: "EVM" as ChainType });
  const [editId, setEditId] = useState<string | null>(null);
  const [batchText, setBatchText] = useState("");
  const [batchChain, setBatchChain] = useState<ChainType>("EVM");
  const [msg, setMsg] = useState("");

  const filtered = useMemo(() => {
    let list = wallets;
    if (filter !== "all") list = list.filter((wallet) => wallet.chain === filter);
    if (q.trim()) {
      const keyword = q.trim().toLowerCase();
      list = list.filter(
        (wallet) =>
          wallet.name.toLowerCase().includes(keyword) ||
          wallet.address.toLowerCase().includes(keyword)
      );
    }
    return [...list].sort((left, right) => right.balanceUsd - left.balanceUsd);
  }, [wallets, filter, q]);

  const evmCount = wallets.filter((wallet) => wallet.chain === "EVM").length;
  const absCount = wallets.filter((wallet) => wallet.chain === "ABSTRACT").length;

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
      setPanel("none");
      setEditId(null);
      setForm({ name: "", address: "", chain: "EVM" });
      setMsg(editId ? "已更新地址" : "已添加地址");
    }
  }

  async function removeWallet(wallet: Wallet) {
    if (!confirm(`确认删除「${wallet.name}」？该地址的余额会立即从总资产中移除。`)) return;
    await api({ action: "delete", id: wallet.id });
  }

  async function batchImport() {
    const data = await api({
      action: "batch",
      text: batchText,
      chain: batchChain,
      namePrefix: "Import",
    });
    if (data) {
      setPanel("none");
      setBatchText("");
      setMsg(`导入完成：新增 ${data.added || 0}，跳过重复 ${data.skipped || 0}`);
    }
  }

  async function exportCsv() {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/export?type=wallets");
      if (!res.ok) {
        setMsg("导出失败");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `0xstudy-wallets-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setMsg("已导出当前地址与余额");
    } finally {
      setBusy(false);
    }
  }

  function statusText(wallet: Wallet) {
    if (wallet.status === "ok") return { text: `最新 · ${timeAgo(wallet.lastUpdated)}`, cls: "pos" };
    if (wallet.status === "cached" || wallet.status === "stale")
      return { text: `上次成功数据 · ${timeAgo(wallet.lastUpdated)}`, cls: "" };
    if (wallet.status === "baseline") return { text: "基线数据", cls: "" };
    return {
      text: wallet.balanceUsd > 0 ? "读取失败 · 保留上次" : "读取失败 · 暂无历史数据",
      cls: "neg",
    };
  }

  return (
    <section className="section" id="addresses">
      <div className="section-head">
        <div className="section-title">
          <h2>地址管理</h2>
          <span className="hint">
            {wallets.length} / 50 个地址 · EVM {evmCount} · Abstract {absCount}
          </span>
        </div>
        <div className="inline">
          <button
            type="button"
            className="btn btn-accent"
            disabled={busy || wallets.length >= 50}
            onClick={() => {
              setPanel(panel === "add" ? "none" : "add");
              setEditId(null);
              setForm({ name: "", address: "", chain: "EVM" });
            }}
          >
            + 添加地址
          </button>
          <button
            type="button"
            className="btn btn-outline"
            disabled={busy}
            onClick={() => setPanel(panel === "batch" ? "none" : "batch")}
          >
            批量导入
          </button>
          <button type="button" className="btn btn-outline" disabled={busy} onClick={exportCsv}>
            导出 CSV
          </button>
        </div>
      </div>

      {msg && (
        <div className="notice" style={{ marginBottom: 10 }}>
          {msg}
        </div>
      )}

      {panel === "add" && (
        <div className="form-panel" style={{ borderRadius: "var(--radius-sm)", marginBottom: 10 }}>
          <div className="form-grid">
            <div>
              <label className="label" htmlFor="wallet-name">
                名称
              </label>
              <input
                id="wallet-name"
                className="field"
                value={form.name}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="例如：币安钱包"
              />
            </div>
            <div>
              <label className="label" htmlFor="wallet-address">
                地址（0x + 40 位）
              </label>
              <input
                id="wallet-address"
                className="field mono"
                value={form.address}
                onChange={(event) => setForm((prev) => ({ ...prev, address: event.target.value }))}
                placeholder="0x…"
              />
            </div>
            <div>
              <label className="label" htmlFor="wallet-chain">
                链类型
              </label>
              <select
                id="wallet-chain"
                className="field"
                value={form.chain}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, chain: event.target.value as ChainType }))
                }
              >
                <option value="EVM">EVM</option>
                <option value="ABSTRACT">ABSTRACT（自动加后缀）</option>
              </select>
            </div>
          </div>
          <div className="inline">
            <button
              type="button"
              className="btn btn-accent"
              onClick={saveWallet}
              disabled={busy || !form.address}
            >
              {busy ? "保存中…" : editId ? "保存修改" : "添加"}
            </button>
            <button type="button" className="btn btn-outline" onClick={() => setPanel("none")}>
              取消
            </button>
            <span className="small">
              地址不区分大小写去重，重复地址会被拒绝；只保存公开地址，永远不收集私钥。
            </span>
          </div>
        </div>
      )}

      {panel === "batch" && (
        <div className="form-panel" style={{ borderRadius: "var(--radius-sm)", marginBottom: 10 }}>
          <div>
            <label className="label" htmlFor="batch-text">
              批量粘贴地址（每行一个，或逗号 / 空格分隔）
            </label>
            <textarea
              id="batch-text"
              className="field mono"
              rows={4}
              value={batchText}
              onChange={(event) => setBatchText(event.target.value)}
              placeholder={"0xabc…\n0xdef…"}
            />
          </div>
          <div className="inline">
            <select
              className="field"
              style={{ width: 180 }}
              value={batchChain}
              onChange={(event) => setBatchChain(event.target.value as ChainType)}
            >
              <option value="EVM">EVM</option>
              <option value="ABSTRACT">ABSTRACT</option>
            </select>
            <button
              type="button"
              className="btn btn-accent"
              onClick={batchImport}
              disabled={busy || !batchText.trim()}
            >
              {busy ? "导入中…" : "开始导入"}
            </button>
            <button type="button" className="btn btn-outline" onClick={() => setPanel("none")}>
              取消
            </button>
          </div>
        </div>
      )}

      <div className="inline" style={{ marginBottom: 10 }}>
        <span className="seg">
          {(
            [
              ["all", `全部 ${wallets.length}`],
              ["EVM", `EVM ${evmCount}`],
              ["ABSTRACT", `Abstract ${absCount}`],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={filter === key ? "active" : ""}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </span>
        <span className="search" style={{ height: 34, minWidth: 200 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.2-3.2" />
          </svg>
          <input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="搜索名称或地址"
            aria-label="搜索钱包"
          />
        </span>
      </div>

      <div className="table">
        <div className="thead grid-wallet">
          <div>钱包</div>
          <div className="hide-lg">类型</div>
          <div className="right">余额</div>
          <div className="right hide-md">状态</div>
          <div className="right hide-lg">DeBank</div>
          <div className="right">操作</div>
        </div>
        {filtered.map((wallet) => {
          const status = statusText(wallet);
          return (
            <div className="trow grid-wallet" key={wallet.id}>
              <div className="cell-token-text">
                <b>{wallet.name}</b>
                <span className="num">{shortAddr(wallet.address)}</span>
              </div>
              <div className="hide-lg">
                <span className={`tag ${wallet.chain === "EVM" ? "line" : "accent"}`}>
                  {wallet.chain === "EVM" ? "EVM" : "Abstract"}
                </span>
              </div>
              <div className={`right cell-main num ${wallet.balanceUsd <= 0 ? "muted" : ""}`}>
                {usd(wallet.balanceUsd)}
              </div>
              <div className={`right cell-sub hide-md ${status.cls}`}>{status.text}</div>
              <div className="right hide-lg">
                <a
                  href={`https://debank.com/profile/${wallet.address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="small"
                  style={{ color: "var(--blue)" }}
                >
                  打开
                </a>
              </div>
              <div className="right inline" style={{ justifyContent: "flex-end" }}>
                <button
                  type="button"
                  className="btn-mini plain"
                  onClick={() => {
                    setEditId(wallet.id);
                    setForm({ name: wallet.name, address: wallet.address, chain: wallet.chain });
                    setPanel("add");
                  }}
                >
                  编辑
                </button>
                <button type="button" className="btn-mini danger" onClick={() => removeWallet(wallet)}>
                  删除
                </button>
              </div>
            </div>
          );
        })}
        {!filtered.length && (
          <div className="trow" style={{ gridTemplateColumns: "1fr" }}>
            <div className="empty">没有匹配的地址</div>
          </div>
        )}
      </div>
      <div className="table-foot">
        <span>
          显示 {filtered.length} / {wallets.length} 个地址 · 上限 50
        </span>
        <span>
          免费接口额度限制：余额前 3 的地址每 5 分钟更新，其余按 20 分钟 / 1 小时分级轮换，失败保留上次数据
        </span>
      </div>
    </section>
  );
}
