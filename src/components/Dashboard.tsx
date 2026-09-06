"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ExchangeBalance, ManualAsset, SnapshotPoint, Wallet } from "@/lib/types";
import { PortfolioChart } from "./PortfolioChart";
import { ManualAssets } from "./ManualAssets";
import { WalletsTable } from "./WalletsTable";
import { cny, timeAgo, usd } from "./format";

interface Totals {
  manualUsd: number;
  onchainUsd: number;
  cexUsd: number;
  evmUsd: number;
  abstractUsd: number;
  totalUsd: number;
}

interface PortfolioPayload {
  manual: ManualAsset[];
  wallets: Wallet[];
  exchanges: ExchangeBalance[];
  snapshots: SnapshotPoint[];
  lastRefresh: string | null;
  usdCnyRate: number;
  totals: Totals;
  serverConnected?: boolean;
  hasEncryptedSecrets?: boolean;
  encryptionReady?: boolean;
}

const EX_LABEL: Record<string, string> = { okx: "OKX", binance: "Binance", gate: "Gate" };

export function Dashboard() {
  const router = useRouter();
  const [data, setData] = useState<PortfolioPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [rateDraft, setRateDraft] = useState("");
  const [rateSaving, setRateSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/portfolio");
      if (res.status === 401) {
        router.replace("/login");
        return;
      }
      const json = await res.json();
      setData(json);
      setRateDraft(String(json.usdCnyRate ?? 6.66));
      setError("");
    } catch {
      setError("加载失败");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  async function refreshAll() {
    setRefreshing(true);
    try {
      const res = await fetch("/api/refresh", { method: "POST" });
      if (res.status === 401) {
        router.replace("/login");
        return;
      }
      const json = await res.json();
      setData(json);
      if (json.usdCnyRate != null) setRateDraft(String(json.usdCnyRate));
    } catch {
      setError("刷新失败");
    } finally {
      setRefreshing(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  async function saveRate(value?: string) {
    const raw = value ?? rateDraft;
    const rateNum = Number(raw);
    if (!Number.isFinite(rateNum) || rateNum <= 0) return;
    setRateSaving(true);
    try {
      const res = await fetch("/api/rate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usdCnyRate: rateNum }),
      });
      const json = await res.json();
      if (res.ok) {
        setData((d) => (d ? { ...d, usdCnyRate: json.usdCnyRate } : d));
        setRateDraft(String(json.usdCnyRate));
      }
    } finally {
      setRateSaving(false);
    }
  }

  if (loading || !data) {
    return (
      <main className="min-h-screen flex items-center justify-center text-gray-400">
        {error || "加载中…"}
      </main>
    );
  }

  const { totals, exchanges, wallets, manual, snapshots, usdCnyRate, lastRefresh } = data;
  const rate = usdCnyRate || 6.66;

  return (
    <main className="min-h-screen pb-16">
      <header className="sticky top-0 z-20 bg-[#f5f6f8]/90 backdrop-blur border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-gray-900 text-white flex items-center justify-center text-xs font-bold">0x</div>
            <div>
              <div className="font-semibold">0xStudy Checker</div>
              <div className="text-xs text-gray-400 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                服务器已连接
                {lastRefresh ? ` · 上次刷新 ${timeAgo(lastRefresh)}` : " · 使用基线数据"}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={logout} className="rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-white">
              退出
            </button>
            <button
              onClick={refreshAll}
              disabled={refreshing}
              className="rounded-xl bg-gray-900 text-white px-4 py-2 text-sm font-medium disabled:opacity-60"
            >
              {refreshing ? "刷新中…" : "刷新全部"}
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 mt-6 space-y-5">
        {error && <div className="text-sm text-red-500">{error}</div>}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <section className="card p-5 md:col-span-1">
            <div className="text-sm text-gray-500 mb-2">资产总览</div>
            <div className="text-3xl font-semibold tracking-tight">{usd(totals.totalUsd)}</div>
            <div className="text-gray-400 mt-1">{cny(totals.totalUsd * rate)}</div>
            <div className="mt-3 flex items-center gap-2 text-sm text-gray-500">
              <span>汇率</span>
              <input
                type="number"
                step="0.01"
                value={rateDraft}
                onChange={(e) => setRateDraft(e.target.value)}
                onBlur={() => saveRate()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                className="w-20 rounded-lg border border-gray-200 px-2 py-0.5 bg-gray-50 text-sm"
              />
              <span className="text-xs text-gray-400">{rateSaving ? "保存中…" : "自动保存"}</span>
            </div>
            <div className="mt-3 text-xs text-gray-400">手动 {usd(totals.manualUsd)} · 链上 {wallets.filter((w) => w.status !== "error").length}/{wallets.length}</div>
          </section>

          <section className="card p-5">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm text-gray-500">链上资产</div>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-sky-50 text-sky-600">EVM/ABSTRACT</span>
            </div>
            <div className="text-3xl font-semibold">{usd(totals.onchainUsd)}</div>
            <div className="mt-4 flex justify-between text-sm text-gray-500">
              <span>EVM {usd(totals.evmUsd)}</span>
              <span>Abstract {usd(totals.abstractUsd)}</span>
            </div>
          </section>

          <section className="card p-5">
            <div className="text-sm text-gray-500 mb-2">交易所资产</div>
            <div className="text-3xl font-semibold">{usd(totals.cexUsd)}</div>
            <div className="mt-4 text-sm text-gray-500">
              {exchanges.filter((e) => e.status === "ok" || e.status === "baseline").length} / {exchanges.length} 已读取
              {data.hasEncryptedSecrets ? " · 已存加密密钥" : ""}
            </div>
          </section>
        </div>

        <PortfolioChart snapshots={snapshots} />

        <section className="card p-5 md:p-6">
          <div className="mb-4">
            <div className="text-xs tracking-wider text-gray-400 font-medium">EXCHANGES</div>
            <h2 className="text-lg font-semibold">交易所资产</h2>
            <p className="text-sm text-gray-400 mt-1">OKX / Binance / Gate · 密钥仅服务端（环境变量或加密入库），只读余额，无提现/交易接口</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {exchanges.map((ex) => (
              <div key={ex.exchange} className="rounded-xl border border-gray-100 p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-medium">{EX_LABEL[ex.exchange] || ex.exchange}</div>
                  <span
                    className={`w-2 h-2 rounded-full ${
                      ex.status === "ok" || ex.status === "baseline" ? "bg-emerald-500" : "bg-amber-400"
                    }`}
                  />
                </div>
                <div className="text-2xl font-semibold">{usd(ex.balanceUsd)}</div>
                <div className="text-xs text-gray-400 mt-2">
                  {ex.status === "missing_keys"
                    ? "未配置 API（显示基线）"
                    : ex.status === "error"
                      ? `错误，保留上次 · ${ex.error || ""}`
                      : ex.status === "baseline"
                        ? `基线数据 · ${timeAgo(ex.lastUpdated)}`
                        : `最新数据 · ${timeAgo(ex.lastUpdated)}`}
                </div>
              </div>
            ))}
          </div>
        </section>

        <ManualAssets
          items={manual}
          onChange={(m) =>
            setData((d) =>
              d
                ? {
                    ...d,
                    manual: m,
                    totals: {
                      ...d.totals,
                      manualUsd: m.reduce((a, x) => a + x.amountUsd, 0),
                      totalUsd:
                        m.reduce((a, x) => a + x.amountUsd, 0) + d.totals.onchainUsd + d.totals.cexUsd,
                    },
                  }
                : d
            )
          }
        />

        <WalletsTable
          wallets={wallets}
          onChange={(w) =>
            setData((d) => {
              if (!d) return d;
              const onchainUsd = Math.round(w.reduce((a, x) => a + x.balanceUsd, 0) * 100) / 100;
              const evmUsd =
                Math.round(w.filter((x) => x.chain === "EVM").reduce((a, x) => a + x.balanceUsd, 0) * 100) / 100;
              const abstractUsd =
                Math.round(w.filter((x) => x.chain === "ABSTRACT").reduce((a, x) => a + x.balanceUsd, 0) * 100) / 100;
              return {
                ...d,
                wallets: w,
                totals: {
                  ...d.totals,
                  onchainUsd,
                  evmUsd,
                  abstractUsd,
                  totalUsd: Math.round((d.totals.manualUsd + onchainUsd + d.totals.cexUsd) * 100) / 100,
                },
              };
            })
          }
        />

        <footer className="text-xs text-gray-400 flex flex-wrap justify-between gap-2 pt-2">
          <span>链上：DeBank（服务端缓存）· 交易所：官方只读 API</span>
          <span>密钥不下发浏览器 · 可选 AES-256-GCM 加密入库</span>
        </footer>
      </div>
    </main>
  );
}
