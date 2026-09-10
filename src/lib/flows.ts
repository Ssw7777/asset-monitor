import type { PortfolioState, SnapshotPoint } from "./types";

export type FlowRangeKey = "24h" | "7d" | "all";

export const FLOW_RANGES: Array<{ key: FlowRangeKey; label: string; ms: number | null }> = [
  { key: "24h", label: "24 小时", ms: 24 * 60 * 60 * 1000 },
  { key: "7d", label: "7 天", ms: 7 * 24 * 60 * 60 * 1000 },
  { key: "all", label: "全部记录", ms: null },
];

export type FlowDirection = "in" | "out" | "transfer";
export type FlowEntityType = "wallet" | "exchange" | "manual";

export interface FlowEvent {
  id: string;
  ts: string;
  direction: FlowDirection;
  amountUsd: number;
  before: number;
  after: number;
  changePct: number | null;
  entityType: FlowEntityType;
  entityKey: string;
  entityLabel: string;
  entityAddress: string | null;
  from: string;
  to: string;
  matched: boolean;
  counterparty: string | null;
  status: "live" | "cached" | "partial";
}

export interface FlowSummary {
  range: FlowRangeKey;
  rangeLabel: string;
  minUsd: number;
  generatedAt: string;
  events: FlowEvent[];
  totalIn: number;
  totalOut: number;
  netUsd: number;
  /** 实际扫描的相邻快照对数 */
  intervals: number;
  scannedFrom: string | null;
  scannedTo: string | null;
  note: string;
}

const EXCHANGE_LABEL: Record<string, string> = { okx: "OKX", binance: "Binance", gate: "Gate" };
/** 间隔超过 6 小时就不做归因：中间可能发生了多次变动，硬算会得出错误结论。 */
const MAX_INTERVAL_MS = 6 * 60 * 60 * 1000;

const round2 = (value: number) => Math.round(value * 100) / 100;

function shortAddress(address: string) {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

interface Delta {
  entityType: FlowEntityType;
  entityKey: string;
  entityLabel: string;
  entityAddress: string | null;
  before: number;
  after: number;
  change: number;
}

function collectDeltas(state: PortfolioState, prev: SnapshotPoint, cur: SnapshotPoint): Delta[] {
  const out: Delta[] = [];
  const walletByAddress = new Map(
    state.wallets.map((wallet) => [wallet.address.toLowerCase(), wallet])
  );

  const walletKeys = new Set([
    ...Object.keys(prev.wallets || {}),
    ...Object.keys(cur.wallets || {}),
  ]);
  for (const address of walletKeys) {
    const before = Number(prev.wallets?.[address] ?? 0);
    const after = Number(cur.wallets?.[address] ?? before);
    const wallet = walletByAddress.get(address);
    out.push({
      entityType: "wallet",
      entityKey: `wallet:${address}`,
      entityLabel: wallet?.name || shortAddress(address),
      entityAddress: address,
      before,
      after,
      change: after - before,
    });
  }

  for (const [key, label] of Object.entries(EXCHANGE_LABEL)) {
    const before = Number(prev.exchanges?.[key] ?? 0);
    const after = Number(cur.exchanges?.[key] ?? before);
    out.push({
      entityType: "exchange",
      entityKey: `exchange:${key}`,
      entityLabel: label,
      entityAddress: null,
      before,
      after,
      change: after - before,
    });
  }

  const manualKeys = new Set([
    ...Object.keys(prev.manualItems || {}),
    ...Object.keys(cur.manualItems || {}),
  ]);
  for (const name of manualKeys) {
    const before = Number(prev.manualItems?.[name] ?? 0);
    const after = Number(cur.manualItems?.[name] ?? before);
    out.push({
      entityType: "manual",
      entityKey: `manual:${name}`,
      entityLabel: name,
      entityAddress: null,
      before,
      after,
      change: after - before,
    });
  }

  return out;
}

function pct(before: number, after: number) {
  if (Math.abs(before) < 0.01) return null;
  return ((after - before) / Math.abs(before)) * 100;
}

/**
 * 大额资金变动流水。
 * 逐张快照对比“每个钱包 / 每家交易所 / 每条手动资产”的余额差，
 * 超过阈值就记一条；同一轮里金额接近的一减一增会被标成“疑似转入转出”。
 *
 * 注意：链上无法证明资金去向，匹配只是基于同一轮快照的推测，
 * 因此每条都带 `matched` 与状态说明，不把推测当成事实。
 */
export function buildFlowSummary(
  state: PortfolioState,
  opts: { range?: FlowRangeKey; minUsd?: number; limit?: number } = {}
): FlowSummary {
  const rangeKey = opts.range ?? "24h";
  const range = FLOW_RANGES.find((item) => item.key === rangeKey) ?? FLOW_RANGES[0];
  const minUsd = Math.max(0, opts.minUsd ?? 50);
  const limit = Math.max(1, opts.limit ?? 120);
  const now = Date.now();

  // 只比较“真实刷新”写入的快照：演示基线快照没有逐钱包明细，
  // 拿它做基准会把“从 0 到当前值”误报成大额转入。
  const snapshots = state.snapshots
    .filter((point) => point.wallets)
    .sort((left, right) => new Date(left.ts).getTime() - new Date(right.ts).getTime());

  const events: FlowEvent[] = [];
  let intervals = 0;

  for (let index = 1; index < snapshots.length; index += 1) {
    const prev = snapshots[index - 1];
    const cur = snapshots[index];
    if (!prev.wallets || !cur.wallets) continue;
    const prevTs = new Date(prev.ts).getTime();
    const curTs = new Date(cur.ts).getTime();
    const intervalMs = curTs - prevTs;
    if (!Number.isFinite(intervalMs) || intervalMs <= 0 || intervalMs > MAX_INTERVAL_MS) continue;
    if (range.ms != null && curTs < now - range.ms) continue;
    intervals += 1;

    const status: FlowEvent["status"] = cur.partial ? "partial" : "live";
    const deltas = collectDeltas(state, prev, cur).filter(
      (delta) => Math.abs(delta.change) >= minUsd
    );
    const outs = deltas.filter((delta) => delta.change < 0).sort((a, b) => a.change - b.change);
    const ins = deltas.filter((delta) => delta.change > 0).sort((a, b) => b.change - a.change);
    const usedIn = new Set<number>();
    const usedOut = new Set<number>();

    // 一减一增、金额接近 → 疑似同一笔转账
    for (let oi = 0; oi < outs.length; oi += 1) {
      const outDelta = outs[oi];
      const outAbs = Math.abs(outDelta.change);
      let bestIndex = -1;
      let bestGap = Infinity;
      for (let ii = 0; ii < ins.length; ii += 1) {
        if (usedIn.has(ii)) continue;
        const inDelta = ins[ii];
        const gap = Math.abs(inDelta.change - outAbs);
        const tolerance = Math.max(30, Math.max(outAbs, inDelta.change) * 0.25);
        if (gap <= tolerance && gap < bestGap) {
          bestGap = gap;
          bestIndex = ii;
        }
      }
      if (bestIndex >= 0) {
        const inDelta = ins[bestIndex];
        usedIn.add(bestIndex);
        usedOut.add(oi);
        events.push({
          id: `${cur.ts}-${outDelta.entityKey}-${inDelta.entityKey}`,
          ts: cur.ts,
          direction: "transfer",
          amountUsd: round2(Math.min(outAbs, inDelta.change)),
          before: round2(outDelta.before),
          after: round2(outDelta.after),
          changePct: pct(outDelta.before, outDelta.after),
          entityType: outDelta.entityType,
          entityKey: outDelta.entityKey,
          entityLabel: outDelta.entityLabel,
          entityAddress: outDelta.entityAddress,
          from: outDelta.entityLabel,
          to: inDelta.entityLabel,
          matched: true,
          counterparty: inDelta.entityLabel,
          status,
        });
      }
    }

    for (let oi = 0; oi < outs.length; oi += 1) {
      if (usedOut.has(oi)) continue;
      const delta = outs[oi];
      events.push({
        id: `${cur.ts}-${delta.entityKey}-out`,
        ts: cur.ts,
        direction: "out",
        amountUsd: round2(Math.abs(delta.change)),
        before: round2(delta.before),
        after: round2(delta.after),
        changePct: pct(delta.before, delta.after),
        entityType: delta.entityType,
        entityKey: delta.entityKey,
        entityLabel: delta.entityLabel,
        entityAddress: delta.entityAddress,
        from: delta.entityLabel,
        to: "外部（未匹配到去向）",
        matched: false,
        counterparty: null,
        status,
      });
    }

    for (let ii = 0; ii < ins.length; ii += 1) {
      if (usedIn.has(ii)) continue;
      const delta = ins[ii];
      events.push({
        id: `${cur.ts}-${delta.entityKey}-in`,
        ts: cur.ts,
        direction: "in",
        amountUsd: round2(delta.change),
        before: round2(delta.before),
        after: round2(delta.after),
        changePct: pct(delta.before, delta.after),
        entityType: delta.entityType,
        entityKey: delta.entityKey,
        entityLabel: delta.entityLabel,
        entityAddress: delta.entityAddress,
        from: "外部（收益 / 转入 / 价格波动）",
        to: delta.entityLabel,
        matched: false,
        counterparty: null,
        status,
      });
    }
  }

  events.sort((left, right) => new Date(right.ts).getTime() - new Date(left.ts).getTime());
  const limited = events.slice(0, limit);
  const totalIn = round2(
    limited.filter((event) => event.direction !== "out").reduce((sum, event) => sum + event.amountUsd, 0)
  );
  const totalOut = round2(
    limited.filter((event) => event.direction !== "in").reduce((sum, event) => sum + event.amountUsd, 0)
  );

  return {
    range: range.key,
    rangeLabel: range.label,
    minUsd,
    generatedAt: new Date().toISOString(),
    events: limited,
    totalIn,
    totalOut,
    netUsd: round2(totalIn - totalOut),
    intervals,
    scannedFrom: snapshots.length ? snapshots[0].ts : null,
    scannedTo: snapshots.length ? snapshots[snapshots.length - 1].ts : null,
    note: "只比较真实刷新写入的快照；同一轮内金额接近的一减一增标记为疑似转账，未匹配的方向标记为外部（可能是对手方、提币或价格波动），仅供参考。",
  };
}
