"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
const AUTO_REFRESH_MS = 5 * 60 * 1000;
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 10 * 60 * 1000;

function formatClock(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "—";
  }
}

export function Dashboard() {
  const router = useRouter();
  const [data, setData] = useState<PortfolioPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [rateDraft, setRateDraft] = useState("");
  const [rateSaving, setRateSaving] = useState(false);
  const [lastUpdateAt, setLastUpdateAt] = useState<string | null>(null);
  const [autoHint, setAutoHint] = useState("每 5 分钟自动刷新");

  const refreshingRef = useRef(false);
  const failStreakRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const applyPayload = useCallback((json: PortfolioPayload) => {
    setData(json);
    if (json.usdCnyRate != null) setRateDraft(String(json.usdCnyRate));
    setLastUpdateAt(json.lastRefresh || new Date().toISOString());
    setError("");
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/portfolio");
      if (res.status === 401) {
        router.replace("/login");
        return;
      }
      const json = await res.json();
      applyPayload(json);
    } catch {
      setError("加载失败");
    } finally {
      setLoading(false);
    }
  }, [router, applyPayload]);

  const quietRefresh = useCallback(
    async (manual = false) => {
      if (refreshingRef.current) return;
      refreshingRef.current = true;
      if (manual) setRefreshing(true);
      try {
        const res = await fetch("/api/refresh", { method: "POST" });
        if (res.status === 401) {
          router.replace("/login");
          return;
        }
        if (!res.ok) throw new Error("refresh_failed");
        const json = await res.json();
        if (!mountedRef.current) return;
        applyPayload(json);
        failStreakRef.current = 0;
        setAutoHint(manual ? "已手动刷新" : "自动刷新成功");
      } catch {
        if (!mountedRef.current) return;
        failStreakRef.current += 1;
        if (manual) setError("刷新失败");
        else setAutoHint("自动刷新失败，稍后重试");
      } finally {
        refreshingRef.current = false;
        if (manual) setRefreshing(false);
      }
    },
    [router, applyPayload]
  );

  useEffect(() => {
    load();
  }, [load]);

  // Frontend-only auto refresh every 5 minutes with exponential backoff on errors
  useEffect(() => {
    mountedRef.current = true;

    const schedule = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      const streak = failStreakRef.current;
      const delay =
        streak === 0
          ? AUTO_REFRESH_MS
          : Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * Math.pow(2, streak - 1));
      timerRef.current = setTimeout(async () => {
        await quietRefresh(false);
        if (mountedRef.current) schedule();
      }, delay);
    };

    schedule();

    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [quietRefresh]);

  async function refreshAll() {
    await quietRefresh(true);
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
      <main className="min-h-screen flex items-center justify-center text-gray-400 px-4">
        {error || "加载中…"}
      </main>
    );
  }

  const { totals, exchanges, wallets, manual, snapshots, usdCnyRate, lastRefresh } = data;
  const rate = usdCnyRate || 6.66;
  const shownUpdate = lastUpdateAt || lastRefresh;

  return (
    <main className="min-h-screen pb-20 overflow-x-hidden">
      <header className="sticky top-0 z-20 bg-[#f5f6f8]/90 backdrop-blur border-b border-gray-100/80">
        <div className="page-shell py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 shrink-0 rounded-full bg-gray-900 text-white flex items-center justify-center text-xs font-bold">
              0x
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-[15px] sm:text-base truncate">0xStudy Checker</div>
              <div className="text-[11px] sm:text-xs text-gray-400 flex items-center gap-1.5 truncate">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block shrink-0" />
                <span className="truncate">
                  服务器已连接
                  {shownUpdate ? ` · 更新于 ${timeAgo(shownUpdate)}` : " · 使用基线数据"}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={logout} className="btn-ghost !min-h-[40px] !px-3 hidden xs:inline-flex sm:inline-flex">
              退出
            </button>
            <button onClick={logout} className="btn-ghost !min-h-[40px] !px-2.5 sm:hidden text-xs">
              退出
            </button>
            <button onClick={refreshAll} disabled={refreshing} className="btn-primary !min-h-[40px]">
              {refreshing ? "刷新中…" : "刷新全部"}
            </button>
          </div>
        </div>
      </header>

      <div className="page-shell mt-4 sm:mt-6 space-y-4 sm:space-y-5">
        {error && <div className="text-sm text-red-500 px-0.5">{error}</div>}

        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] sm:text-xs text-gray-400 px-0.5">
          <span>
            上次更新：{formatClock(shownUpdate)}
            {shownUpdate ? `（${timeAgo(shownUpdate)}）` : ""}
          </span>
          <span className="text-gray-400/90">{autoHint} · 不阻塞界面</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4">
          <section className="card p-4 sm:p-5 md:col-span-1">
            <div className="text-sm text-gray-500 mb-1.5">资产总览</div>
            <div className="stat-value">{usd(totals.totalUsd)}</div>
            <div className="text-gray-400 mt-1 text-sm">{cny(totals.totalUsd * rate)}</div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-gray-500">
              <span>汇率</span>
              <input
                type="number"
                step="0.01"
                inputMode="decimal"
                value={rateDraft}
                onChange={(e) => setRateDraft(e.target.value)}
                onBlur={() => saveRate()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                className="w-20 rounded-lg border border-gray-200 px-2 py-1.5 bg-gray-50 text-sm"
              />
              <span className="text-xs text-gray-400">{rateSaving ? "保存中…" : "自动保存"}</span>
            </div>
            <div className="mt-3 text-xs text-gray-400 leading-relaxed">
              手动 {usd(totals.manualUsd)} · 链上{" "}
              {wallets.filter((w) => w.status !== "error").length}/{wallets.length}
            </div>
          </section>

          <section className="card p-4 sm:p-5">
            <div className="flex items-center justify-between mb-1.5 gap-2">
              <div className="text-sm text-gray-500">链上资产</div>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-sky-50 text-sky-600 shrink-0">
                EVM/ABSTRACT
              </span>
            </div>
            <div className="stat-value">{usd(totals.onchainUsd)}</div>
            <div className="mt-3 sm:mt-4 flex justify-between gap-3 text-sm text-gray-500">
              <span>EVM {usd(totals.evmUsd)}</span>
              <span>Abstract {usd(totals.abstractUsd)}</span>
            </div>
          </section>

          <section className="card p-4 sm:p-5">
            <div className="text-sm text-gray-500 mb-1.5">交易所资产</div>
            <div className="stat-value">{usd(totals.cexUsd)}</div>
            <div className="mt-3 sm:mt-4 text-sm text-gray-500 leading-relaxed">
              {exchanges.filter((e) => e.status === "ok").length} / {exchanges.length} 实时 · 其余保留上次/基线
              {data.hasEncryptedSecrets ? " · 已存加密密钥" : ""}
            </div>
          </section>
        </div>

        <PortfolioChart snapshots={snapshots} usdCnyRate={rate} />

        <section className="card p-4 sm:p-5 md:p-6">
          <div className="mb-3 sm:mb-4">
            <div className="section-kicker">Exchanges</div>
            <h2 className="text-base sm:text-lg font-semibold mt-0.5">交易所资产</h2>
            <p className="text-sm text-gray-400 mt-1 leading-relaxed">
              OKX / Binance / Gate · 密钥仅服务端，只读余额
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {exchanges.map((ex) => (
              <div key={ex.exchange} className="rounded-xl border border-gray-100 p-3.5 sm:p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-medium">{EX_LABEL[ex.exchange] || ex.exchange}</div>
                  <span
                    className={`w-2 h-2 rounded-full ${
                      ex.status === "ok"
                        ? "bg-emerald-500"
                        : ex.status === "baseline"
                          ? "bg-emerald-500"
                          : ex.status === "error" || ex.status === "missing_passphrase"
                            ? "bg-red-400"
                            : "bg-amber-400"
                    }`}
                  />
                </div>
                <div className="text-xl sm:text-2xl font-semibold tabular-nums">{usd(ex.balanceUsd)}</div>
                <div className="text-xs text-gray-400 mt-2 leading-relaxed break-words">
                  {ex.status === "missing_passphrase"
                    ? `缺少 passphrase · ${ex.error || "请配置 OKX_API_PASSPHRASE"}`
                    : ex.status === "missing_keys"
                      ? `未配置 API · ${ex.error || "显示上次/基线余额"}`
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
                Math.round(w.filter((x) => x.chain === "EVM").reduce((a, x) => a + x.balanceUsd, 0) * 100) /
                100;
              const abstractUsd =
                Math.round(
                  w.filter((x) => x.chain === "ABSTRACT").reduce((a, x) => a + x.balanceUsd, 0) * 100
                ) / 100;
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

        <footer className="text-xs text-gray-400 flex flex-col sm:flex-row sm:flex-wrap justify-between gap-1.5 pt-1 pb-2">
          <span>链上：DeBank（服务端缓存）· 交易所：官方只读 API</span>
          <span>密钥不下发浏览器 · 可选 AES-256-GCM 加密入库</span>
        </footer>
      </div>
    </main>
  );
}
