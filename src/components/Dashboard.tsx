"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import type { ChangeRangeKey, ChangeSummary } from "@/lib/changes";
import type { FlowRangeKey, FlowSummary } from "@/lib/flows";
import type { ProtocolPerformanceSummary } from "@/lib/protocols";
import type {
  ExchangeBalance,
  ManualAsset,
  OnchainBreakdown,
  SnapshotPoint,
  Wallet,
} from "@/lib/types";
import { ChangeSection } from "./ChangeSection";
import { ExchangeSection } from "./ExchangeSection";
import { FlowSection } from "./FlowSection";
import { ManualAssets } from "./ManualAssets";
import { PortfolioChart } from "./PortfolioChart";
import { ProtocolSections } from "./ProtocolSections";
import { TokenTable } from "./TokenTable";
import { localChainIcon, TokenIcon } from "./TokenIcon";
import { WalletsTable } from "./WalletsTable";
import { cny, timeAgo, usd } from "./format";
import { walletFreshness } from "@/lib/freshness";

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
  onchainBreakdown?: OnchainBreakdown | null;
  snapshotCount?: number;
  snapshotLimit?: number;
  refreshStatus?: "ok" | "partial" | "failed";
}

/** 快照每 5 分钟记一条；钱包余额由云端接力循环每约 10 分钟滚动检查（成功时间最旧的优先）。 */
const AUTO_TICK_MS = 5 * 60 * 1000;
const AUTO_FULL_EVERY_MS = 5 * 60 * 1000;
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 10 * 60 * 1000;

/** DeBank 链色，用于链卡片左侧色条；没有映射的链回退为中性色。 */
const CHAIN_COLOR: Record<string, string> = {
  eth: "#627eea",
  bsc: "#f0b90b",
  xlayer: "#1a1a1a",
  abs: "#63d2ff",
  base: "#0052ff",
  arb: "#28a0f0",
  op: "#ff0420",
  matic: "#8247e5",
  hood: "#00c087",
  monad: "#836ef9",
  avax: "#e84142",
  zora: "#5b5bd6",
  scrl: "#ffd54f",
  linea: "#61dfff",
  bera: "#b76a1a",
  plasma: "#1a1a1a",
  solana: "#9945ff",
};

function ChainIcon({ chain }: { chain: OnchainBreakdown["chains"][number] }) {
  return (
    <TokenIcon
      symbol={chain.name || chain.id}
      localSrc={localChainIcon(chain.id)}
      logoUrl={chain.logoUrl}
      size={26}
      shape="square"
    />
  );
}

export function Dashboard() {
  const router = useRouter();
  const [data, setData] = useState<PortfolioPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [rateDraft, setRateDraft] = useState("");
  const [rateSaving, setRateSaving] = useState(false);
  const [range, setRange] = useState<ChangeRangeKey>("1h");
  const [changes, setChanges] = useState<ChangeSummary | null>(null);
  const [changesLoading, setChangesLoading] = useState(false);
  const [chainFilter, setChainFilter] = useState("all");
  const [smallChainsOpen, setSmallChainsOpen] = useState(false);
  const [exporting, setExporting] = useState("");
  const [flows, setFlows] = useState<FlowSummary | null>(null);
  const [protocolPerf, setProtocolPerf] = useState<ProtocolPerformanceSummary | null>(null);
  const [flowsLoading, setFlowsLoading] = useState(false);
  const [flowRange, setFlowRange] = useState<FlowRangeKey>("24h");
  const [flowMin, setFlowMin] = useState(50);

  const refreshingRef = useRef(false);
  const failStreakRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const rangeRef = useRef<ChangeRangeKey>("1h");
  const flowRangeRef = useRef<FlowRangeKey>("24h");
  const flowMinRef = useRef(50);
  const lastFullRef = useRef(Date.now());
  const [clockNow, setClockNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setClockNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const applyPayload = useCallback((json: PortfolioPayload) => {
    setData(json);
    if (json.usdCnyRate != null) setRateDraft(String(json.usdCnyRate));
    setError("");
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/portfolio");
      if (res.status === 401) {
        router.replace("/login");
        return;
      }
      applyPayload(await res.json());
    } catch {
      setError("加载失败");
    } finally {
      setLoading(false);
    }
  }, [router, applyPayload]);

  const loadChanges = useCallback(
    async (nextRange: ChangeRangeKey) => {
      setChangesLoading(true);
      try {
        const [res, perfRes] = await Promise.all([
          fetch(`/api/changes?range=${nextRange}`),
          fetch(`/api/protocols?range=${nextRange}`),
        ]);
        if (res.status === 401) {
          router.replace("/login");
          return;
        }
        if (res.ok) {
          const json = (await res.json()) as ChangeSummary;
          if (mountedRef.current) setChanges(json);
        }
        if (perfRes.ok) {
          const perf = (await perfRes.json()) as ProtocolPerformanceSummary;
          if (mountedRef.current) setProtocolPerf(perf);
        }
      } catch {
        /* 保留上一次结果，不显示伪造的 0 */
      } finally {
        if (mountedRef.current) setChangesLoading(false);
      }
    },
    [router]
  );

  const loadFlows = useCallback(
    async (nextRange: FlowRangeKey, nextMin: number) => {
      setFlowsLoading(true);
      try {
        const res = await fetch(`/api/flows?range=${nextRange}&min=${nextMin}`);
        if (res.status === 401) {
          router.replace("/login");
          return;
        }
        if (res.ok) {
          const json = (await res.json()) as FlowSummary;
          if (mountedRef.current) setFlows(json);
        }
      } catch {
        /* 保留上一次结果 */
      } finally {
        if (mountedRef.current) setFlowsLoading(false);
      }
    },
    [router]
  );

  const quietRefresh = useCallback(
    async (mode: "fast" | "full" = "fast", manual = false) => {
      if (refreshingRef.current) return;
      refreshingRef.current = true;
      if (manual) setRefreshing(true);
      try {
        const res = await fetch(`/api/refresh?mode=${mode}`, { method: "POST" });
        if (res.status === 401) {
          router.replace("/login");
          return;
        }
        if (!res.ok) throw new Error("refresh_failed");
        const json = (await res.json()) as PortfolioPayload;
        if (!mountedRef.current) return;
        applyPayload(json);
        failStreakRef.current = 0;
        if (mode === "full") lastFullRef.current = Date.now();
        void loadChanges(rangeRef.current);
        void loadFlows(flowRangeRef.current, flowMinRef.current);
      } catch {
        if (!mountedRef.current) return;
        failStreakRef.current += 1;
        if (manual) setError("刷新失败，界面保留上次成功数据");
      } finally {
        refreshingRef.current = false;
        if (manual) setRefreshing(false);
      }
    },
    [router, applyPayload, loadChanges, loadFlows]
  );

  useEffect(() => {
    void load();
    // 打开页面只刷新交易所与快照。链上钱包由云端分批任务持续更新，
    // 避免浏览器每次打开都触发 25 个公共接口请求并在函数时限内超时。
    if (!mountedRef.current) mountedRef.current = true;
    void quietRefresh("fast", false);
  }, [load, quietRefresh]);

  useEffect(() => {
    rangeRef.current = range;
    void loadChanges(range);
  }, [range, loadChanges]);

  useEffect(() => {
    flowRangeRef.current = flowRange;
    flowMinRef.current = flowMin;
    void loadFlows(flowRange, flowMin);
  }, [flowRange, flowMin, loadFlows]);

  useEffect(() => {
    mountedRef.current = true;
    const schedule = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      const streak = failStreakRef.current;
      const delay =
        streak === 0 ? AUTO_TICK_MS : Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * Math.pow(2, streak - 1));
      timerRef.current = setTimeout(async () => {
        // 后台每 5 分钟只刷交易所+快照；钱包余额由云端调度器每 10 分钟滚动刷新
        await quietRefresh("fast", false);
        if (mountedRef.current) schedule();
      }, delay);
    };
    schedule();
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [quietRefresh]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  async function saveRate(value?: string) {
    const rateNum = Number(value ?? rateDraft);
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
        setData((prev) => (prev ? { ...prev, usdCnyRate: json.usdCnyRate } : prev));
        setRateDraft(String(json.usdCnyRate));
      }
    } finally {
      setRateSaving(false);
    }
  }

  async function exportCsv(type: "wallets" | "dapps") {
    setExporting(type);
    try {
      const res = await fetch(`/api/export?type=${type}`);
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `0xstudy-${type}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExporting("");
    }
  }

  const breakdown = data?.onchainBreakdown ?? null;
  const chains = useMemo(() => breakdown?.chains ?? [], [breakdown]);
  // 链卡片动态可见性：主列表为 ≥50 U；1–50 U 折叠；<1 U 永不显示。
  const mainChains = useMemo(() => chains.filter((chain) => chain.valueUsd >= 50), [chains]);
  const smallChains = useMemo(
    () => chains.filter((chain) => chain.valueUsd >= 1 && chain.valueUsd < 50),
    [chains]
  );
  const displayedChains = useMemo(
    () => (smallChainsOpen ? [...mainChains, ...smallChains] : mainChains),
    [mainChains, smallChains, smallChainsOpen]
  );

  if (loading || !data) {
    return (
      <main className="page">
        <div className="container" style={{ paddingTop: 80 }}>
          <div className="skeleton" style={{ height: 40, width: 260 }} />
          <div className="skeleton" style={{ height: 160, marginTop: 20 }} />
          <div className="skeleton" style={{ height: 220, marginTop: 20 }} />
          <div className="muted" style={{ marginTop: 16 }}>
            {error || "加载中…"}
          </div>
        </div>
      </main>
    );
  }

  const { totals, exchanges, wallets, manual, snapshots, usdCnyRate, lastRefresh } = data;
  const rate = usdCnyRate || 6.66;
  const freshness = walletFreshness(wallets, clockNow);
  const partial = breakdown?.partial === true;
  const dapps = breakdown?.dapps ?? [];
  const onchainUsd = totals.onchainUsd || chains.reduce((sum, chain) => sum + chain.valueUsd, 0);
  return (
    <main className="page">
      <header className="topbar">
        <div className="container topbar-inner">
          <a className="brand" href="#top">
            <Image src="/avatar.jpg" alt="0xStudy" width={26} height={26} className="brand-mark" />
            <span className="brand-name">0xStudy Checker</span>
          </a>
          <nav className="topnav">
            <a href="#trend" className="active">
              总览
            </a>
            <a href="#flows">流水</a>
            <a href="#tokens">代币</a>
            <a href="#defi">DeFi</a>
            <a href="#exchanges">交易所</a>
            <a href="#changes">变动</a>
            <a href="#addresses">地址</a>
          </nav>
          <div className="topbar-actions">
            <span className="small">快照 {timeAgo(lastRefresh)}</span>
            <button
              type="button"
              className="btn btn-accent"
              onClick={() => quietRefresh("fast", true)}
              disabled={refreshing}
              title="立即刷新三家交易所并读取云端最近的钱包结果"
            >
              {refreshing ? "刷新中…" : "刷新数据"}
            </button>
            <button type="button" className="btn btn-outline" onClick={logout}>
              退出
            </button>
          </div>
        </div>
      </header>

      <div className="container" id="top">
        <div className="overview-duo">
        <section className="summary-panel overview-summary">
              <Image src="/avatar.jpg" alt="0xStudy" width={48} height={48} className="avatar" />
              <div className="stats">
                <div>
                  <div className="stat-label">链上资产</div>
                  <div className="stat-value num">{usd(totals.onchainUsd)}</div>
                </div>
                <div>
                  <div className="stat-label">交易所资产</div>
                  <div className="stat-value num">{usd(totals.cexUsd)}</div>
                </div>
                <div>
                  <div className="stat-label">手动资产</div>
                  <div className="stat-value num">{usd(totals.manualUsd)}</div>
                </div>
                <div>
                  <div className="stat-label">DApp 协议</div>
                  <div className="stat-value num">{dapps.length}</div>
                </div>
                <div>
                  <div className="stat-label">地址上限</div>
                  <div className="stat-value num">
                    {wallets.length}/50
                  </div>
                </div>
              </div>
              <div className="profile-right">
                <div className="summary-label">总资产</div>
                <div className="profile-status">
                  <span
                    className={`tag ${
                      error || data.refreshStatus === "failed" ? "neg" : freshness.stale || partial ? "warn" : "pos"
                    }`}
                  >
                    {error || data.refreshStatus === "failed"
                      ? "数据获取失败"
                      : freshness.stale
                        ? `${freshness.stale} 个钱包超过10分钟未更新`
                        : partial
                          ? "钱包已更新 · 部分明细待核验"
                          : `钱包已更新 ${freshness.fresh}/${freshness.total}`}
                  </span>
                  <span className="small">{rateSaving ? "汇率保存中…" : `最旧钱包：${Number.isFinite(freshness.oldestAgeMs) ? `${Math.ceil(freshness.oldestAgeMs / 60_000)}分钟前` : "尚无成功记录"}`}</span>
                </div>
                <div className="networth-value num">{usd(totals.totalUsd)}</div>
                <div className="networth-cny num">{cny(totals.totalUsd * rate)}</div>
                <div className="networth-rate">
                  <label htmlFor="usd-cny-rate">USD/CNY</label>
                  <input
                    id="usd-cny-rate"
                    type="number"
                    step="0.01"
                    inputMode="decimal"
                    value={rateDraft}
                    onChange={(event) => setRateDraft(event.target.value)}
                    onBlur={() => saveRate()}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                    }}
                  />
                </div>
              </div>
        </section>

          <PortfolioChart
            snapshots={snapshots}
            usdCnyRate={rate}
            range={range}
            summary={changes}
            onRangeChange={setRange}
          />
          <FlowSection
            summary={flows}
            loading={flowsLoading}
            range={flowRange}
            minUsd={flowMin}
            onRangeChange={setFlowRange}
            onMinChange={setFlowMin}
          />
        </div>

        <section className="section" id="chains">
          <div className="section-head">
            <div className="section-title">
              <h2>链上分布</h2>
              <span className="hint">
                {displayedChains.length} 条链
                {smallChains.length ? ` · ${smallChains.length} 条小额链${smallChainsOpen ? "已展开" : "已收起"}` : ""}
                {" · 点击链卡片可筛选下方代币"}
              </span>
            </div>
            <span className="section-total num">{usd(onchainUsd)}</span>
          </div>
          {displayedChains.length || smallChains.length ? (
            <div className="chain-strip">
              <button
                type="button"
                className={`chain-card${chainFilter === "all" ? " active" : ""}`}
                style={{ ["--chain-color" as string]: "#b3bcd2" }}
                onClick={() => setChainFilter("all")}
              >
                <span className="icon-fallback">ALL</span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span className="name" style={{ display: "block" }}>
                    全部链
                  </span>
                  <span className="value num" style={{ display: "block" }}>
                    {usd(onchainUsd)}
                  </span>
                </span>
              </button>
              {displayedChains.map((chain) => (
                <button
                  key={chain.id}
                  type="button"
                  className={`chain-card${chainFilter === chain.id ? " active" : ""}`}
                  style={{ ["--chain-color" as string]: CHAIN_COLOR[chain.id] || "#b3bcd2" }}
                  onClick={() => setChainFilter(chainFilter === chain.id ? "all" : chain.id)}
                >
                  <ChainIcon chain={chain} />
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span className="name" style={{ display: "block" }}>
                      {chain.name === "Robinhood Chain" ? "Robinhood" : chain.name}
                    </span>
                    <span className="value num" style={{ display: "block" }}>
                      {usd(chain.valueUsd)}
                    </span>
                  </span>
                </button>
              ))}
              {smallChains.length > 0 && (
                <button
                  type="button"
                  className="chain-dust-card"
                  onClick={() => setSmallChainsOpen((open) => !open)}
                  aria-expanded={smallChainsOpen}
                >
                  <span className="icon-fallback">⋯</span>
                  <span>
                    <span className="name">小额链 {smallChains.length} 条</span>
                    <span className="value num">每条 1–50 USDT · {smallChainsOpen ? "点击收起" : "点击展开"}</span>
                  </span>
                </button>
              )}
            </div>
          ) : (
            <div className="empty">还没有链上明细：点击右上角刷新获取</div>
          )}
        </section>

        <TokenTable
          tokens={breakdown?.tokens ?? []}
          onchainUsd={onchainUsd}
          chainFilter={chainFilter}
          partial={partial}
          tokenSource={breakdown?.tokenSource}
        />

        <ProtocolSections
          dapps={dapps}
          perf={protocolPerf}
          range={range}
          onRangeChange={setRange}
        />

        <ExchangeSection
          exchanges={exchanges}
          totalUsd={totals.cexUsd}
          range={range}
          changes={changes}
          onRangeChange={setRange}
        />

        <ManualAssets
          items={manual}
          onChange={(next) =>
            setData((prev) =>
              prev
                ? {
                    ...prev,
                    manual: next,
                    totals: {
                      ...prev.totals,
                      manualUsd: next.reduce((sum, item) => sum + item.amountUsd, 0),
                      totalUsd:
                        next.reduce((sum, item) => sum + item.amountUsd, 0) +
                        prev.totals.onchainUsd +
                        prev.totals.cexUsd,
                    },
                  }
                : prev
            )
          }
        />

        <ChangeSection
          range={range}
          summary={changes}
          loading={changesLoading}
          onRangeChange={setRange}
        />

        <WalletsTable
          wallets={wallets}
          onChange={(next) =>
            setData((prev) => {
              if (!prev) return prev;
              const round2 = (value: number) => Math.round(value * 100) / 100;
              const onchain = round2(next.reduce((sum, wallet) => sum + wallet.balanceUsd, 0));
              return {
                ...prev,
                wallets: next,
                totals: {
                  ...prev.totals,
                  onchainUsd: onchain,
                  evmUsd: round2(
                    next.filter((wallet) => wallet.chain === "EVM").reduce((sum, wallet) => sum + wallet.balanceUsd, 0)
                  ),
                  abstractUsd: round2(
                    next
                      .filter((wallet) => wallet.chain === "ABSTRACT")
                      .reduce((sum, wallet) => sum + wallet.balanceUsd, 0)
                  ),
                  totalUsd: round2(prev.totals.manualUsd + onchain + prev.totals.cexUsd),
                },
              };
            })
          }
        />

        <section className="section" id="export">
          <div className="section-head">
            <div className="section-title">
              <h2>导出</h2>
              <span className="hint">导出当前展示的数据，不含任何密钥、密码或会话信息</span>
            </div>
            <div className="inline">
              <button
                type="button"
                className="btn btn-outline"
                disabled={exporting !== ""}
                onClick={() => exportCsv("wallets")}
              >
                {exporting === "wallets" ? "导出中…" : "钱包 CSV"}
              </button>
              <button
                type="button"
                className="btn btn-outline"
                disabled={exporting !== ""}
                onClick={() => exportCsv("dapps")}
              >
                {exporting === "dapps" ? "导出中…" : "DApp 明细 CSV"}
              </button>
            </div>
          </div>
          <div className="notice notice-stack">
            <p>DApp 明细单独导出一个文件，是为避免把「钱包余额」和「协议仓位」再相加（协议仓位本来就包含在钱包余额里）</p>
            <p>
              历史快照目前 {data.snapshotCount ?? snapshots.length} / {data.snapshotLimit ?? 2016} 条：每 5 分钟记一条，上限 2016 条覆盖 7 天，超过就自动删除超时记录
            </p>
          </div>
        </section>

        <footer className="table-foot" style={{ paddingLeft: 0, paddingRight: 0 }}>
          <span>链上：DeBank（服务端缓存）· 交易所：官方只读 API</span>
          <span>密钥不下发浏览器 · 失败保留上次成功数据，绝不归零</span>
        </footer>
      </div>
    </main>
  );
}
