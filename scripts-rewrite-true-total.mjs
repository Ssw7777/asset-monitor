import { createClient } from "@libsql/client";
import { writeFileSync } from "node:fs";
import {
  reconcileSnapshotTotalsToWallets,
  sanitizeOscillatingBasisBands,
  sanitizeOscillatingTotals,
  sanitizeRoundTripBasisBands,
  sanitizeSpuriousWalletSpikes,
  sanitizeValueRoundTrips,
} from "./src/lib/onchain/snapshot-sanitize.ts";

const c = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const rs = await c.execute({
  sql: "SELECT value, updated_at FROM kv_store WHERE key = ?",
  args: ["portfolio"],
});
const row = rs.rows[0];
if (!row) throw new Error("no portfolio");
const prevRev = String(row.updated_at);
const store = JSON.parse(String(row.value));
console.log("prevRev", prevRev, "snaps", store.snapshots?.length, "lastRefresh", store.lastRefresh);
console.log("wallets", store.wallets?.length, "onchainCache", store.onchainCacheUsd);

const raw = store.snapshots || [];
const s1 = sanitizeSpuriousWalletSpikes(raw);
const s2 = sanitizeOscillatingBasisBands(s1.snapshots);
const s3 = sanitizeRoundTripBasisBands(s2.snapshots);
const s4 = sanitizeValueRoundTrips(s3.snapshots);
const s5 = sanitizeOscillatingTotals(s4.snapshots);
const s6 = reconcileSnapshotTotalsToWallets(s5.snapshots);
console.log("sanitize counts", {
  spikes: s1.changed,
  bands: s2.changed,
  roundTrips: s3.changed,
  valueTrips: s4.changed,
  totalsPinned: s5.changed,
  reconciled: s6.changed,
});

function cst(ts) {
  return new Date(ts).toLocaleString("en-CA", { timeZone: "Asia/Shanghai", hour12: false });
}
const start = Date.parse("2026-10-09T19:20:00.000Z"); // 10/10 03:20 CST
const end = Date.parse("2026-10-10T14:41:00.000Z"); // 10/10 22:41 CST
let winBefore = 0, winAfter = 0, winN = 0;
let winSumExcess = 0;
for (let i = 0; i < raw.length; i++) {
  const t = Date.parse(raw[i].ts);
  if (t < start || t > end) continue;
  winN++;
  const wsum = Object.values(raw[i].wallets || {}).reduce((a, v) => a + Number(v || 0), 0);
  const wsum2 = Object.values(s6.snapshots[i].wallets || {}).reduce((a, v) => a + Number(v || 0), 0);
  const gap = Number(raw[i].onchain) - wsum;
  if (Math.abs(gap) >= 50) { winBefore++; winSumExcess += gap; }
  if (Math.abs(Number(s6.snapshots[i].onchain) - wsum2) >= 50) winAfter++;
}
console.log("window inflated before/after", winBefore, winAfter, "of", winN, "excessSum", Math.round(winSumExcess));

for (const ts of ["2026-10-09T19:30:00.000Z", "2026-10-10T04:00:00.000Z", "2026-10-10T10:00:00.000Z", "2026-10-10T14:36:00.000Z", "2026-10-10T14:41:00.000Z"]) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < raw.length; i++) {
    const d = Math.abs(Date.parse(raw[i].ts) - Date.parse(ts));
    if (d < bestD) { bestD = d; best = i; }
  }
  const a = raw[best], b = s6.snapshots[best];
  console.log("sample", cst(a.ts), "before", a.totalUsd, "after", b.totalUsd, "delta", Math.round((b.totalUsd - a.totalUsd) * 100) / 100);
}

store.snapshots = s6.snapshots;
store.flowBaselineAt = new Date().toISOString();
store.flowDataVersion = Math.max(Number(store.flowDataVersion) || 1, 3);
store.flowEvents = [];
const nextRev = `${new Date().toISOString()}-true-total-fix`;
store.storeRevision = nextRev;

const payload = JSON.stringify(store);
writeFileSync("/workspace/true-total-fix/rewrite-meta.json", JSON.stringify({
  prevRev, nextRev, snapCount: raw.length, reconciled: s6.changed, winBefore, winAfter, winN,
  lastRefresh: store.lastRefresh, counts: {
    spikes: s1.changed, bands: s2.changed, roundTrips: s3.changed,
    valueTrips: s4.changed, totalsPinned: s5.changed, reconciled: s6.changed,
  }
}, null, 2));

const result = await c.execute({
  sql: `UPDATE kv_store SET value = ?, updated_at = ? WHERE key = ? AND updated_at = ?`,
  args: [payload, nextRev, "portfolio", prevRev],
});
console.log("rowsAffected", result.rowsAffected);
if (result.rowsAffected !== 1) throw new Error("CAS conflict — abort");
console.log("WROTE", nextRev, "bytes", payload.length);

const verify = await c.execute({ sql: "SELECT updated_at, length(value) as len FROM kv_store WHERE key=?", args: ["portfolio"] });
console.log("verify", verify.rows[0]);

const now = Date.now();
const PAUSED = new Set([
  "0x3a7a0477ad09d8abc78254bf1e53dcc7ed5f030d","0x9f600c729e953536f90fbf5dd41891eee68e1de7",
  "0x1897868924ba4722e9c01e9619aad55d83c17f34","0x41c0f5ca063da149c227c21d106a7838cbc74d19",
  "0x5d79bc991884f2316c06631f9de704c441f57121","0xabd87fc5e600ca7205b95f6d9b26e7c974067caa",
  "0x97a1f45f3e64d99d2e222547e20f9fcc8f2d5ff0","0x446018c09bd2a9c50cba161e90b1bca5433acdeb",
  "0xe8094c9380899205af6ac43181625cad21840c1e","0x3bfd51e42705873fbca47f22484820c9e09dcf61",
]);
const active = (store.wallets || []).filter((w) => !PAUSED.has(String(w.address || "").toLowerCase()) && w.refreshPaused !== true);
const ages = active.map((w) => {
  const t = Date.parse(w.lastUpdated || (w.lastSuccess && w.lastSuccess.at) || 0);
  return { name: w.name, ageSec: Number.isFinite(t) ? Math.round((now - t) / 1000) : null, bal: w.balanceUsd, addr: w.address };
}).sort((a, b) => (b.ageSec ?? 0) - (a.ageSec ?? 0));
console.log("active wallets", active.length);
console.log("oldest", ages.slice(0, 8));
console.log("over5min", ages.filter(a => (a.ageSec ?? 0) > 300).length);
console.log("lastRefresh ageSec", store.lastRefresh ? Math.round((now - Date.parse(store.lastRefresh)) / 1000) : null);

const last = s6.snapshots[s6.snapshots.length - 1];
console.log("latest snap", cst(last.ts), "total", last.totalUsd, "onchain", last.onchain);
