import crypto from "crypto";
import { resolveCexKeys } from "../crypto";
import type { EncryptedSecretsBlob } from "../types";

export interface CexResult {
  balanceUsd: number;
  status: "ok" | "missing_keys" | "missing_passphrase" | "error";
  error?: string;
}

const STABLES = new Set(["USDT", "USDC", "FDUSD", "BUSD", "TUSD", "DAI", "USD"]);
const BINANCE_BASE = "https://api.binance.com";
const OKX_BASE = "https://www.okx.com";
const GATE_BASE = "https://api.gateio.ws";

function missing(...keys: (string | undefined)[]) {
  return keys.some((k) => !k || !k.trim());
}

function roundUsd(n: number) {
  return Math.round(n * 100) / 100;
}

function parseNum(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "0"));
  return Number.isFinite(n) ? n : 0;
}

/** Value asset qty in USD using stable=1:1 and a price lookup for the rest. */
async function valueHoldings(
  holdings: Array<{ asset: string; qty: number }>,
  priceOf: (asset: string) => Promise<number | null>
): Promise<number> {
  let total = 0;
  const nonStable: Array<{ asset: string; qty: number }> = [];
  for (const h of holdings) {
    if (!h.qty || Math.abs(h.qty) < 1e-12) continue;
    const asset = h.asset.toUpperCase();
    if (STABLES.has(asset)) total += h.qty;
    else nonStable.push({ asset, qty: h.qty });
  }
  // Cap price lookups to avoid hammering APIs
  for (const { asset, qty } of nonStable.slice(0, 40)) {
    try {
      const price = await priceOf(asset);
      if (price) total += qty * price;
    } catch {
      /* skip unpriceable */
    }
  }
  return total;
}

function binancePriceCache() {
  const cache = new Map<string, number | null>();
  return async (asset: string): Promise<number | null> => {
    if (cache.has(asset)) return cache.get(asset)!;
    try {
      const sym = asset + "USDT";
      const pr = await fetch(`${BINANCE_BASE}/api/v3/ticker/price?symbol=${sym}`, {
        cache: "no-store",
      });
      if (!pr.ok) {
        cache.set(asset, null);
        return null;
      }
      const pj = await pr.json();
      const price = parseNum(pj.price);
      cache.set(asset, price || null);
      return price || null;
    } catch {
      cache.set(asset, null);
      return null;
    }
  };
}

function okxPriceCache() {
  const cache = new Map<string, number | null>();
  return async (asset: string): Promise<number | null> => {
    if (cache.has(asset)) return cache.get(asset)!;
    try {
      const instId = `${asset}-USDT`;
      const pr = await fetch(`${OKX_BASE}/api/v5/market/ticker?instId=${instId}`, {
        cache: "no-store",
      });
      if (!pr.ok) {
        cache.set(asset, null);
        return null;
      }
      const pj = await pr.json();
      const price = parseNum(pj.data?.[0]?.last);
      cache.set(asset, price || null);
      return price || null;
    } catch {
      cache.set(asset, null);
      return null;
    }
  };
}

function gatePriceCache() {
  const cache = new Map<string, number | null>();
  return async (asset: string): Promise<number | null> => {
    if (cache.has(asset)) return cache.get(asset)!;
    try {
      const pr = await fetch(
        `${GATE_BASE}/api/v4/spot/tickers?currency_pair=${asset}_USDT`,
        { cache: "no-store" }
      );
      if (!pr.ok) {
        cache.set(asset, null);
        return null;
      }
      const pj = await pr.json();
      const price = parseNum(pj?.[0]?.last);
      cache.set(asset, price || null);
      return price || null;
    } catch {
      cache.set(asset, null);
      return null;
    }
  };
}

// ─── OKX ─────────────────────────────────────────────────────────────────────

async function okxSignedGet(
  path: string,
  apiKey: string,
  secret: string,
  passphrase: string,
  simulated: boolean,
  query = ""
): Promise<{ ok: boolean; data: any; error?: string }> {
  const ts = new Date().toISOString();
  const requestPath = query ? `${path}?${query}` : path;
  const prehash = ts + "GET" + requestPath;
  const sign = crypto.createHmac("sha256", secret).update(prehash).digest("base64");
  const headers: Record<string, string> = {
    "OK-ACCESS-KEY": apiKey,
    "OK-ACCESS-SIGN": sign,
    "OK-ACCESS-TIMESTAMP": ts,
    "OK-ACCESS-PASSPHRASE": passphrase,
    "Content-Type": "application/json",
  };
  if (simulated) headers["x-simulated-trading"] = "1";
  const res = await fetch(OKX_BASE + requestPath, { headers, cache: "no-store" });
  const data = await res.json();
  if (!res.ok || data.code !== "0") {
    return {
      ok: false,
      data,
      error: data.msg || res.statusText || `HTTP ${res.status}`,
    };
  }
  return { ok: true, data };
}

export async function fetchOkxBalance(blob?: EncryptedSecretsBlob | null): Promise<CexResult> {
  const keys = resolveCexKeys(blob);
  const apiKey = keys.okx.apiKey;
  const secret = keys.okx.secret;
  const passphrase = keys.okx.passphrase;

  if (!missing(apiKey, secret) && missing(passphrase)) {
    return {
      balanceUsd: 0,
      status: "missing_passphrase",
      error: "OKX passphrase missing (OKX_API_PASSPHRASE or encrypted keys)",
    };
  }
  if (missing(apiKey, secret, passphrase)) {
    return { balanceUsd: 0, status: "missing_keys", error: "OKX API key/secret/passphrase not configured" };
  }

  const priceOf = okxPriceCache();
  const errors: string[] = [];
  let total = 0;
  let majorOk = false;

  try {
    // 1) Trading account — prefer totalEq (includes trading + auto-earn collateral)
    const trading = await okxSignedGet(
      "/api/v5/account/balance",
      apiKey!,
      secret!,
      passphrase!,
      keys.okx.simulated
    );
    if (trading.ok) {
      const row = trading.data.data?.[0];
      let eq = parseNum(row?.totalEq);
      if (!eq && Array.isArray(row?.details)) {
        for (const d of row.details) {
          eq += parseNum(d.eqUsd || d.eq);
        }
      }
      total += eq;
      majorOk = true;
    } else {
      errors.push(`trading: ${trading.error}`);
    }

    // 2) Funding wallet (separate from trading totalEq)
    const funding = await okxSignedGet(
      "/api/v5/asset/balances",
      apiKey!,
      secret!,
      passphrase!,
      keys.okx.simulated
    );
    if (funding.ok) {
      const holdings: Array<{ asset: string; qty: number }> = [];
      for (const b of funding.data.data || []) {
        const qty = parseNum(b.bal ?? b.availBal);
        if (qty) holdings.push({ asset: String(b.ccy || ""), qty });
      }
      total += await valueHoldings(holdings, priceOf);
      majorOk = true;
    } else {
      // Empty funding is often code≠0 with no keys permission — note but don't fail hard
      errors.push(`funding: ${funding.error}`);
    }

    // 3) Simple Earn / savings (理财) if present outside trading
    const savings = await okxSignedGet(
      "/api/v5/finance/savings/balance",
      apiKey!,
      secret!,
      passphrase!,
      keys.okx.simulated
    );
    if (savings.ok) {
      const holdings: Array<{ asset: string; qty: number }> = [];
      for (const b of savings.data.data || []) {
        const qty = parseNum(b.amt);
        if (qty) holdings.push({ asset: String(b.ccy || ""), qty });
      }
      total += await valueHoldings(holdings, priceOf);
    } else if (savings.error) {
      errors.push(`savings: ${savings.error}`);
    }

    if (!majorOk) {
      return {
        balanceUsd: 0,
        status: "error",
        error: errors.join("; ") || "OKX all wallets failed",
      };
    }
    return {
      balanceUsd: roundUsd(total),
      status: "ok",
      error: errors.length ? errors.join("; ") : undefined,
    };
  } catch (e) {
    return { balanceUsd: 0, status: "error", error: e instanceof Error ? e.message : "okx fail" };
  }
}

// ─── Binance ─────────────────────────────────────────────────────────────────

async function binanceSigned(
  method: "GET" | "POST",
  path: string,
  apiKey: string,
  secret: string,
  extra: Record<string, string | number> = {}
): Promise<{ ok: boolean; data: any; error?: string; status: number }> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(extra)) params.set(k, String(v));
  params.set("timestamp", String(Date.now()));
  const query = params.toString();
  const signature = crypto.createHmac("sha256", secret).update(query).digest("hex");
  const url = `${BINANCE_BASE}${path}?${query}&signature=${signature}`;
  const res = await fetch(url, {
    method,
    headers: { "X-MBX-APIKEY": apiKey },
    cache: "no-store",
  });
  let data: any;
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (!res.ok || (data && typeof data.code === "number" && data.code < 0)) {
    return {
      ok: false,
      data,
      status: res.status,
      error: data.msg || data.message || res.statusText || `HTTP ${res.status}`,
    };
  }
  return { ok: true, data, status: res.status };
}

/** Paginate Binance Simple Earn position endpoints (size max 100). */
async function binanceEarnRows(
  path: string,
  apiKey: string,
  secret: string
): Promise<{ ok: boolean; rows: any[]; error?: string }> {
  const all: any[] = [];
  let current = 1;
  const size = 100;
  for (;;) {
    const r = await binanceSigned("GET", path, apiKey, secret, { current, size });
    if (!r.ok) return { ok: false, rows: all, error: r.error };
    const rows = Array.isArray(r.data?.rows) ? r.data.rows : Array.isArray(r.data) ? r.data : [];
    all.push(...rows);
    const total = parseNum(r.data?.total);
    if (rows.length < size || (total && all.length >= total) || current >= 20) break;
    current += 1;
  }
  return { ok: true, rows: all };
}

export async function fetchBinanceBalance(blob?: EncryptedSecretsBlob | null): Promise<CexResult> {
  const keys = resolveCexKeys(blob);
  const apiKey = keys.binance.apiKey;
  const secret = keys.binance.secret;
  if (missing(apiKey, secret)) {
    return { balanceUsd: 0, status: "missing_keys", error: "Binance API key/secret not configured" };
  }

  const priceOf = binancePriceCache();
  const errors: string[] = [];
  let total = 0;
  let majorOk = false; // spot / funding / earn count as major

  try {
    // 1) Spot
    const spot = await binanceSigned("GET", "/api/v3/account", apiKey!, secret!);
    if (spot.ok) {
      const holdings: Array<{ asset: string; qty: number }> = [];
      for (const b of spot.data.balances || []) {
        const qty = parseNum(b.free) + parseNum(b.locked);
        if (qty >= 1e-8) holdings.push({ asset: String(b.asset), qty });
      }
      total += await valueHoldings(holdings, priceOf);
      majorOk = true;
    } else {
      errors.push(`spot: ${spot.error}`);
    }

    // 2) Funding wallet
    const funding = await binanceSigned("POST", "/sapi/v1/asset/get-funding-asset", apiKey!, secret!);
    if (funding.ok) {
      const list = Array.isArray(funding.data) ? funding.data : [];
      const holdings: Array<{ asset: string; qty: number }> = [];
      for (const b of list) {
        const qty =
          parseNum(b.free) + parseNum(b.locked) + parseNum(b.freeze) + parseNum(b.withdrawing);
        if (qty >= 1e-8) holdings.push({ asset: String(b.asset), qty });
      }
      total += await valueHoldings(holdings, priceOf);
      majorOk = true;
    } else {
      errors.push(`funding: ${funding.error}`);
    }

    // 3) Simple Earn flexible
    let earnUsd = 0;
    let earnOk = false;
    const flex = await binanceEarnRows("/sapi/v1/simple-earn/flexible/position", apiKey!, secret!);
    if (flex.ok) {
      const holdings: Array<{ asset: string; qty: number }> = [];
      for (const row of flex.rows) {
        const qty = parseNum(row.totalAmount);
        if (qty >= 1e-8) holdings.push({ asset: String(row.asset || ""), qty });
      }
      earnUsd += await valueHoldings(holdings, priceOf);
      earnOk = true;
    } else {
      errors.push(`earn-flexible: ${flex.error}`);
    }

    // 4) Simple Earn locked
    const locked = await binanceEarnRows("/sapi/v1/simple-earn/locked/position", apiKey!, secret!);
    if (locked.ok) {
      const holdings: Array<{ asset: string; qty: number }> = [];
      for (const row of locked.rows) {
        const qty = parseNum(row.amount ?? row.totalAmount);
        if (qty >= 1e-8) holdings.push({ asset: String(row.asset || ""), qty });
      }
      earnUsd += await valueHoldings(holdings, priceOf);
      earnOk = true;
    } else {
      errors.push(`earn-locked: ${locked.error}`);
    }

    // Fallback / cross-check: Simple Earn account totals already in USDT
    if (!earnOk) {
      const earnAcct = await binanceSigned("GET", "/sapi/v1/simple-earn/account", apiKey!, secret!);
      if (earnAcct.ok) {
        earnUsd = parseNum(earnAcct.data.totalAmountInUSDT);
        earnOk = true;
      } else {
        errors.push(`earn-account: ${earnAcct.error}`);
      }
    }

    if (earnOk) {
      total += earnUsd;
      majorOk = true;
    }

    // 5) Optional wallet overview (BTC-denominated) — only for diagnostics if all majors failed
    if (!majorOk) {
      const wallets = await binanceSigned("GET", "/sapi/v1/asset/wallet/balance", apiKey!, secret!);
      if (wallets.ok) {
        errors.push("wallet-balance returned but BTC-denominated; not used for USD sum");
      } else {
        errors.push(`wallet-balance: ${wallets.error}`);
      }
    }

    if (!majorOk) {
      return {
        balanceUsd: 0,
        status: "error",
        error: errors.join("; ") || "Binance all wallets failed",
      };
    }
    return {
      balanceUsd: roundUsd(total),
      status: "ok",
      error: errors.length ? errors.join("; ") : undefined,
    };
  } catch (e) {
    return { balanceUsd: 0, status: "error", error: e instanceof Error ? e.message : "binance fail" };
  }
}

// ─── Gate ────────────────────────────────────────────────────────────────────

async function gateSignedGet(
  urlPath: string,
  apiKey: string,
  secret: string,
  query = ""
): Promise<{ ok: boolean; data: any; error?: string }> {
  const method = "GET";
  const bodyHash = crypto.createHash("sha512").update("").digest("hex");
  const ts = Math.floor(Date.now() / 1000).toString();
  const signStr = [method, urlPath, query, bodyHash, ts].join("\n");
  const sign = crypto.createHmac("sha512", secret).update(signStr).digest("hex");
  const url = GATE_BASE + urlPath + (query ? `?${query}` : "");
  const res = await fetch(url, {
    headers: {
      KEY: apiKey,
      Timestamp: ts,
      SIGN: sign,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  let data: any;
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (!res.ok) {
    return {
      ok: false,
      data,
      error: typeof data === "object" ? JSON.stringify(data) : res.statusText || `HTTP ${res.status}`,
    };
  }
  return { ok: true, data };
}

export async function fetchGateBalance(blob?: EncryptedSecretsBlob | null): Promise<CexResult> {
  const keys = resolveCexKeys(blob);
  const apiKey = keys.gate.apiKey;
  const secret = keys.gate.secret;
  if (missing(apiKey, secret)) {
    return { balanceUsd: 0, status: "missing_keys", error: "Gate API key/secret not configured" };
  }

  const priceOf = gatePriceCache();
  const errors: string[] = [];

  try {
    // Prefer unified estimated total (spot + finance + other accounts, no double-count)
    const totalBal = await gateSignedGet(
      "/api/v4/wallet/total_balance",
      apiKey!,
      secret!,
      "currency=USDT"
    );
    if (totalBal.ok) {
      const amount = parseNum(totalBal.data?.total?.amount);
      // Include positive equity accounts only; total.amount is Gate's estimated net
      if (amount > 0 || totalBal.data?.total) {
        return {
          balanceUsd: roundUsd(amount),
          status: "ok",
        };
      }
    } else {
      errors.push(`total_balance: ${totalBal.error}`);
    }

    // Fallback: spot + earn uni lends (finance), avoid double-counting margin/futures
    let total = 0;
    let majorOk = false;

    const spot = await gateSignedGet("/api/v4/spot/accounts", apiKey!, secret!);
    if (spot.ok) {
      const list = Array.isArray(spot.data) ? spot.data : [];
      const holdings: Array<{ asset: string; qty: number }> = [];
      for (const a of list) {
        const avail = parseNum(a.available) + parseNum(a.locked);
        if (avail) holdings.push({ asset: String(a.currency || "").toUpperCase(), qty: avail });
      }
      total += await valueHoldings(holdings, priceOf);
      majorOk = true;
    } else {
      errors.push(`spot: ${spot.error}`);
    }

    const lends = await gateSignedGet("/api/v4/earn/uni/lends", apiKey!, secret!);
    if (lends.ok) {
      const list = Array.isArray(lends.data) ? lends.data : [];
      const holdings: Array<{ asset: string; qty: number }> = [];
      for (const a of list) {
        // Prefer currentAmount (active), fall back to amount
        const qty = parseNum(a.currentAmount ?? a.amount ?? a.lentAmount);
        if (qty) holdings.push({ asset: String(a.currency || "").toUpperCase(), qty });
      }
      total += await valueHoldings(holdings, priceOf);
      majorOk = true;
    } else {
      errors.push(`earn-uni: ${lends.error}`);
    }

    if (!majorOk) {
      return {
        balanceUsd: 0,
        status: "error",
        error: errors.join("; ") || "Gate all wallets failed",
      };
    }
    return {
      balanceUsd: roundUsd(total),
      status: "ok",
      error: errors.length ? errors.join("; ") : undefined,
    };
  } catch (e) {
    return { balanceUsd: 0, status: "error", error: e instanceof Error ? e.message : "gate fail" };
  }
}
