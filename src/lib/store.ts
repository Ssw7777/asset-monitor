import fs from "fs";
import path from "path";
import type {
  EncryptedSecretsBlob,
  ExchangeBalance,
  ManualAsset,
  PortfolioState,
  SnapshotPoint,
  Wallet,
} from "./types";
import { BASELINE, SEED_MANUAL, seedWallets } from "./seed";

const DATA_DIR = path.join(process.cwd(), "data");
const LOCAL_STORE = path.join(DATA_DIR, "store.json");
const TMP_STORE = "/tmp/asset-monitor-store.json";
const TURSO_ROW_KEY = "portfolio";

type GlobalCache = { __amStore?: PortfolioState; __amStoreLock?: Promise<void> };
const g = globalThis as unknown as GlobalCache;

function isServerless(): boolean {
  return !!(
    process.env.VERCEL ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.FUNCTION_NAME
  );
}

function preferTurso(): boolean {
  return !!(process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN);
}

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
    const totalUsd = Math.round((base - 320 + jitter + (48 - i) * 7) * 100) / 100;
    points.push({
      ts: new Date(now - i * 30 * 60 * 1000).toISOString(),
      totalUsd,
      onchain: BASELINE.onchainUsd,
      cex: BASELINE.cexUsd,
      manual: BASELINE.manualUsd,
      exchanges: { okx: BASELINE.okx, binance: BASELINE.binance, gate: BASELINE.gate },
    });
  }
  points[points.length - 1].totalUsd = base;
  return points;
}

export function defaultState(): PortfolioState {
  const rate = Number(process.env.USD_CNY_RATE || "6.66") || 6.66;
  return {
    manual: SEED_MANUAL.map((m) => ({ ...m })),
    wallets: seedWallets(),
    exchanges: defaultExchanges(),
    snapshots: seedSnapshots(),
    onchainCacheUsd: BASELINE.onchainUsd,
    lastRefresh: null,
    usdCnyRate: rate,
    encryptedSecrets: null,
  };
}

function normalizeState(raw: Partial<PortfolioState> | null | undefined): PortfolioState {
  const d = defaultState();
  if (!raw || typeof raw !== "object") return d;
  return {
    manual: Array.isArray(raw.manual) ? raw.manual : d.manual,
    wallets: Array.isArray(raw.wallets) ? raw.wallets : d.wallets,
    exchanges: Array.isArray(raw.exchanges) ? raw.exchanges : d.exchanges,
    snapshots: Array.isArray(raw.snapshots) ? raw.snapshots : d.snapshots,
    onchainCacheUsd: Number(raw.onchainCacheUsd) || d.onchainCacheUsd,
    lastRefresh: raw.lastRefresh ?? null,
    usdCnyRate: Number(raw.usdCnyRate) || d.usdCnyRate,
    encryptedSecrets: raw.encryptedSecrets ?? null,
  };
}

function readJsonFile(filePath: string): PortfolioState | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf-8");
    return normalizeState(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeJsonFile(filePath: string, state: PortfolioState) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
}

async function tursoClient() {
  const { createClient } = await import("@libsql/client");
  return createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  });
}

async function ensureTursoSchema() {
  const client = await tursoClient();
  await client.execute(`
    CREATE TABLE IF NOT EXISTS kv_store (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  return client;
}

async function readTurso(): Promise<PortfolioState | null> {
  try {
    const client = await ensureTursoSchema();
    const rs = await client.execute({
      sql: "SELECT value FROM kv_store WHERE key = ?",
      args: [TURSO_ROW_KEY],
    });
    const row = rs.rows[0];
    if (!row) return null;
    const value = row.value as string;
    return normalizeState(JSON.parse(value));
  } catch (e) {
    console.error("[store] turso read failed", e);
    return null;
  }
}

async function writeTurso(state: PortfolioState): Promise<boolean> {
  try {
    const client = await ensureTursoSchema();
    const now = new Date().toISOString();
    await client.execute({
      sql: `INSERT INTO kv_store (key, value, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      args: [TURSO_ROW_KEY, JSON.stringify(state), now],
    });
    return true;
  } catch (e) {
    console.error("[store] turso write failed", e);
    return false;
  }
}

function readMemoryOrTmp(): PortfolioState | null {
  if (g.__amStore) return g.__amStore;
  if (isServerless()) return readJsonFile(TMP_STORE);
  return null;
}

function writeMemoryAndTmp(state: PortfolioState) {
  g.__amStore = state;
  if (isServerless()) {
    try {
      writeJsonFile(TMP_STORE, state);
    } catch {
      /* /tmp may be full — memory still holds it for warm instances */
    }
  }
}

export async function readStore(): Promise<PortfolioState> {
  if (preferTurso()) {
    const fromDb = await readTurso();
    if (fromDb) {
      writeMemoryAndTmp(fromDb);
      return fromDb;
    }
    const cached = readMemoryOrTmp();
    if (cached) return cached;
    const seeded = defaultState();
    await writeTurso(seeded);
    writeMemoryAndTmp(seeded);
    return seeded;
  }

  if (isServerless()) {
    const cached = readMemoryOrTmp();
    if (cached) return cached;
    const seeded = defaultState();
    writeMemoryAndTmp(seeded);
    return seeded;
  }

  // Local next dev / node server: durable file under data/
  const local = readJsonFile(LOCAL_STORE);
  if (local) {
    g.__amStore = local;
    return local;
  }
  const seeded = defaultState();
  writeJsonFile(LOCAL_STORE, seeded);
  g.__amStore = seeded;
  return seeded;
}

export async function writeStore(state: PortfolioState): Promise<void> {
  writeMemoryAndTmp(state);
  if (preferTurso()) {
    await writeTurso(state);
    return;
  }
  if (isServerless()) {
    // already wrote /tmp + memory
    return;
  }
  writeJsonFile(LOCAL_STORE, state);
}

export async function updateManual(manual: ManualAsset[]) {
  const s = await readStore();
  s.manual = manual;
  await writeStore(s);
  return s;
}

export async function upsertManual(item: ManualAsset) {
  const s = await readStore();
  const idx = s.manual.findIndex((m) => m.id === item.id);
  if (idx >= 0) s.manual[idx] = item;
  else s.manual.push(item);
  await writeStore(s);
  return s;
}

export async function deleteManual(id: string) {
  const s = await readStore();
  s.manual = s.manual.filter((m) => m.id !== id);
  await writeStore(s);
  return s;
}

export async function updateWallets(wallets: Wallet[]) {
  const s = await readStore();
  s.wallets = wallets;
  s.onchainCacheUsd = wallets.reduce((a, w) => a + w.balanceUsd, 0);
  await writeStore(s);
  return s;
}

export async function updateExchanges(exchanges: ExchangeBalance[]) {
  const s = await readStore();
  s.exchanges = exchanges;
  await writeStore(s);
  return s;
}

export async function setUsdCnyRate(rate: number) {
  const s = await readStore();
  s.usdCnyRate = Math.round(rate * 10000) / 10000 || 6.66;
  await writeStore(s);
  return s;
}

export async function setEncryptedSecrets(blob: EncryptedSecretsBlob | null) {
  const s = await readStore();
  s.encryptedSecrets = blob;
  await writeStore(s);
  return s;
}

export async function pushSnapshot(point: Omit<SnapshotPoint, "ts"> & { ts?: string }) {
  const s = await readStore();
  const snap: SnapshotPoint = {
    ts: point.ts || new Date().toISOString(),
    totalUsd: point.totalUsd,
    onchain: point.onchain,
    cex: point.cex,
    manual: point.manual,
    exchanges: point.exchanges,
    wallets: point.wallets,
  };
  s.snapshots.push(snap);
  if (s.snapshots.length > 700) s.snapshots = s.snapshots.slice(-700);
  s.lastRefresh = snap.ts;
  await writeStore(s);
  return s;
}

export function computeTotals(s: PortfolioState) {
  const manualUsd = s.manual.reduce((a, m) => a + (Number(m.amountUsd) || 0), 0);
  const onchainUsd = s.wallets.reduce((a, w) => a + (Number(w.balanceUsd) || 0), 0);
  const cexUsd = s.exchanges.reduce((a, e) => a + (Number(e.balanceUsd) || 0), 0);
  const evmUsd = s.wallets.filter((w) => w.chain === "EVM").reduce((a, w) => a + w.balanceUsd, 0);
  const abstractUsd = s.wallets
    .filter((w) => w.chain === "ABSTRACT")
    .reduce((a, w) => a + w.balanceUsd, 0);
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

/** Strip secrets before sending state to client */
export function publicState(s: PortfolioState) {
  const { encryptedSecrets: _omit, ...rest } = s;
  void _omit;
  return {
    ...rest,
    hasEncryptedSecrets: !!s.encryptedSecrets,
    encryptionReady: !!(process.env.ENCRYPTION_KEY && process.env.ENCRYPTION_KEY.trim()),
  };
}
