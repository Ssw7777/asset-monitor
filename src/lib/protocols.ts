import { CHANGE_RANGES, type ChangeRangeKey } from "./changes";
import type { PortfolioState, SnapshotPoint } from "./types";

export interface ProtocolPerformance {
  name: string;
  currentUsd: number;
  pastUsd: number;
  changeUsd: number;
  changePct: number | null;
  /** 按所选区间线性年化出来的 APY（仅供参考，波动资产不适合看这个） */
  apy: number | null;
  coverageMs: number;
}

export interface ProtocolPerformanceSummary {
  range: ChangeRangeKey;
  rangeLabel: string;
  from: string | null;
  to: string | null;
  coverageMs: number;
  available: boolean;
  reason?: string;
  items: ProtocolPerformance[];
}

const round2 = (value: number) => Math.round(value * 100) / 100;

function pickPast(snapshots: SnapshotPoint[], targetMs: number): SnapshotPoint | null {
  let best: SnapshotPoint | null = null;
  let bestTs = -Infinity;
  for (const point of snapshots) {
    const ts = new Date(point.ts).getTime();
    if (!Number.isFinite(ts) || ts > targetMs) continue;
    if (ts > bestTs) {
      bestTs = ts;
      best = point;
    }
  }
  return best;
}

/**
 * 每个 DeFi 协议在所选区间内的净值变化，并按区间长度推算年化（APY）。
 * 数据来自每条快照里的 dapps 明细，最长可回溯 7 天。
 */
export function buildProtocolPerformance(
  state: PortfolioState,
  rangeKey: ChangeRangeKey,
  current: Array<{ name: string; netUsd: number }>
): ProtocolPerformanceSummary {
  const range = CHANGE_RANGES.find((item) => item.key === rangeKey) ?? CHANGE_RANGES[2];
  const snapshots = state.snapshots.filter((point) => point.dapps);
  const latest = snapshots.length ? snapshots[snapshots.length - 1] : null;
  const past = pickPast(snapshots, Date.now() - range.ms);

  const empty: ProtocolPerformanceSummary = {
    range: range.key,
    rangeLabel: range.label,
    from: past?.ts ?? null,
    to: latest?.ts ?? null,
    coverageMs: 0,
    available: false,
    reason: "快照还在积累，暂时算不出该区间的变化",
    items: [],
  };

  if (!latest || !past || latest.ts === past.ts) {
    return {
      ...empty,
      items: current.map((item) => ({
        name: item.name,
        currentUsd: round2(item.netUsd),
        pastUsd: 0,
        changeUsd: 0,
        changePct: null,
        apy: null,
        coverageMs: 0,
      })),
    };
  }

  const coverageMs = Math.max(0, new Date(latest.ts).getTime() - new Date(past.ts).getTime());
  const days = coverageMs / 86_400_000;
  const items: ProtocolPerformance[] = current.map((item) => {
    const before = Number(past.dapps?.[item.name] ?? 0);
    const after = Number(item.netUsd) || 0;
    const changeUsd = round2(after - before);
    const changePct = Math.abs(before) > 0.01 ? ((after - before) / Math.abs(before)) * 100 : null;
    // 线性年化，只对“有正收益”的仓位有意义；波动资产会被放大，界面上要标注
    const apy = changePct != null && days > 0.02 ? changePct * (365.25 / days) : null;
    return {
      name: item.name,
      currentUsd: round2(after),
      pastUsd: round2(before),
      changeUsd,
      changePct,
      apy,
      coverageMs,
    };
  });

  return {
    range: range.key,
    rangeLabel: range.label,
    from: past.ts,
    to: latest.ts,
    coverageMs,
    available: true,
    items,
  };
}
