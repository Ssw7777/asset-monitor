import fs from "fs";
import path from "path";
import type { ExchangeBalance, ManualAsset, PortfolioState, SnapshotPoint, Wallet } from "./types";
import { BASELINE, SEED_MANUAL, seedWallets } from "./seed";

const DATA_DIR = path.join(process.cwd(), "data");
const STORE_PATH = path.join(DATA_DIR, "store.json");

function defaultExchanges(): ExchangeBalance[] {
  const now = new Date().toISOString();
  return [
    { exchange: "okx", balanceUsd: BASELINE.okx, lastUpdated: now, status: "baseline" },
    { exchange: "binance", balanceUsd: BASELINE.binance, lastUpdated: now, status: "baseline" },
    { exchange: "gate", balanceUsd: BASELINE.gate, lastUpdated: now, status: "baseline" },
  ];
}

function seedSnapshots(): SnapshotPoint[] {
  const now = Date.now();
  const points: SnapshotPoint[] = [];
  const base = BASELINE.totalUsd;
  for (let i = 48; i >= 0; i--) {
    const jitter = Math.sin(i / 3) * 180 + Math.cos(i / 7) * 90;
    points.push({
      ts: new Date(now - i * 30 * 60 * 1000).toISOString(),
      totalUsd: Math.round((base - 320 + jitter + (48 - i) * 7) * 100) / 100,
    });
  }
  points[points.length - 1].totalUsd = base;
  return points;
}

function defaultState(): PortfolioState {
  const rate = Number(process.env.USD_CNY_RATE || "6.66") || 6.66;
  return {
    manual: SEED_MANUAL.map((m) => ({ ...m })),
    wallets: seedWallets(),
    exchanges: defaultExchanges(),
    snapshots: seedSnapshots(),
    onchainCacheUsd: BASELINE.onchainUsd,
    lastRefresh: null,
    usdCnyRate: rate,
  };
}

function ensureStore(): PortfolioState {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STORE_PATH)) {
    const s = defaultState();
    fs.writeFileSync(STORE_PATH, JSON.stringify(s, null, 2), "utf-8");
    return s;
  }
  try {
    const raw = fs.readFileSync(STORE_PATH, "utf-8");
    return JSON.parse(raw) as PortfolioState;
  } catch {
    const s = defaultState();
    fs.writeFileSync(STORE_PATH, JSON.stringify(s, null, 2), "utf-8");
    return s;
  }
}

export function readStore(): PortfolioState {
  return ensureStore();
}

export function writeStore(state: PortfolioState) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(state, null, 2), "utf-8");
}

export function updateManual(manual: ManualAsset[]) {
  const s = readStore();
  s.manual = manual;
  writeStore(s);
  return s;
}

export function upsertManual(item: ManualAsset) {
  const s = readStore();
  const idx = s.manual.findIndex((m) => m.id === item.id);
  if (idx >= 0) s.manual[idx] = item;
  else s.manual.push(item);
  writeStore(s);
  return s;
}

export function deleteManual(id: string) {
  const s = readStore();
  s.manual = s.manual.filter((m) => m.id !== id);
  writeStore(s);
  return s;
}

export function updateWallets(wallets: Wallet[]) {
  const s = readStore();
  s.wallets = wallets;
  s.onchainCacheUsd = wallets.reduce((a, w) => a + w.balanceUsd, 0);
  writeStore(s);
  return s;
}

export function updateExchanges(exchanges: ExchangeBalance[]) {
  const s = readStore();
  s.exchanges = exchanges;
  writeStore(s);
  return s;
}

export function pushSnapshot(totalUsd: number) {
  const s = readStore();
  s.snapshots.push({ ts: new Date().toISOString(), totalUsd });
  // keep ~14 days of 30-min points max ~700
  if (s.snapshots.length > 700) s.snapshots = s.snapshots.slice(-700);
  s.lastRefresh = new Date().toISOString();
  writeStore(s);
  return s;
}

export function computeTotals(s: PortfolioState) {
  const manualUsd = s.manual.reduce((a, m) => a + (Number(m.amountUsd) || 0), 0);
  const onchainUsd = s.wallets.reduce((a, w) => a + (Number(w.balanceUsd) || 0), 0);
  const cexUsd = s.exchanges.reduce((a, e) => a + (Number(e.balanceUsd) || 0), 0);
  const evmUsd = s.wallets.filter((w) => w.chain === "EVM").reduce((a, w) => a + w.balanceUsd, 0);
  const abstractUsd = s.wallets.filter((w) => w.chain === "ABSTRACT").reduce((a, w) => a + w.balanceUsd, 0);
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return {
    manualUsd: round2(manualUsd),
    onchainUsd: round2(onchainUsd),
    cexUsd: round2(cexUsd),
    evmUsd: round2(evmUsd),
    abstractUsd: round2(abstractUsd),
    totalUsd: round2(manualUsd + onchainUsd + cexUsd),
  };
}
