import crypto from "crypto";
import { resolveCexKeys } from "../crypto";
import type { EncryptedSecretsBlob } from "../types";

export interface CexResult {
  balanceUsd: number;
  status: "ok" | "missing_keys" | "missing_passphrase" | "error";
  error?: string;
}

function missing(...keys: (string | undefined)[]) {
  return keys.some((k) => !k || !k.trim());
}

export async function fetchOkxBalance(blob?: EncryptedSecretsBlob | null): Promise<CexResult> {
  const keys = resolveCexKeys(blob);
  const apiKey = keys.okx.apiKey;
  const secret = keys.okx.secret;
  const passphrase = keys.okx.passphrase;

  // Surfacing: keys present but passphrase absent → missing_passphrase (not silent baseline)
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
  try {
    const ts = new Date().toISOString();
    const method = "GET";
    const path = "/api/v5/account/balance";
    const prehash = ts + method + path;
    const sign = crypto.createHmac("sha256", secret!).update(prehash).digest("base64");
    const headers: Record<string, string> = {
      "OK-ACCESS-KEY": apiKey!,
      "OK-ACCESS-SIGN": sign,
      "OK-ACCESS-TIMESTAMP": ts,
      "OK-ACCESS-PASSPHRASE": passphrase!,
      "Content-Type": "application/json",
    };
    if (keys.okx.simulated) headers["x-simulated-trading"] = "1";
    const res = await fetch("https://www.okx.com" + path, { headers, cache: "no-store" });
    const data = await res.json();
    if (!res.ok || data.code !== "0") {
      return { balanceUsd: 0, status: "error", error: data.msg || res.statusText || `HTTP ${res.status}` };
    }
    const details = data.data?.[0]?.details || [];
    let total = 0;
    for (const d of details) {
      const eq = parseFloat(d.eqUsd || d.eq || "0");
      if (!Number.isNaN(eq)) total += eq;
    }
    if (!total && data.data?.[0]?.totalEq) total = parseFloat(data.data[0].totalEq) || 0;
    return { balanceUsd: Math.round(total * 100) / 100, status: "ok" };
  } catch (e) {
    return { balanceUsd: 0, status: "error", error: e instanceof Error ? e.message : "okx fail" };
  }
}

export async function fetchBinanceBalance(blob?: EncryptedSecretsBlob | null): Promise<CexResult> {
  const keys = resolveCexKeys(blob);
  const apiKey = keys.binance.apiKey;
  const secret = keys.binance.secret;
  if (missing(apiKey, secret)) {
    return { balanceUsd: 0, status: "missing_keys", error: "Binance API key/secret not configured" };
  }
  try {
    const ts = Date.now();
    const query = `timestamp=${ts}`;
    const signature = crypto.createHmac("sha256", secret!).update(query).digest("hex");
    const url = `https://api.binance.com/api/v3/account?${query}&signature=${signature}`;
    const res = await fetch(url, {
      headers: { "X-MBX-APIKEY": apiKey! },
      cache: "no-store",
    });
    const data = await res.json();
    if (!res.ok) {
      const msg = data.msg || res.statusText || `HTTP ${res.status}`;
      // Geo / restricted region often returns 451 or explicit restriction text
      return { balanceUsd: 0, status: "error", error: msg };
    }
    const balances: Array<{ asset: string; free: string; locked: string }> = data.balances || [];
    const stables = new Set(["USDT", "USDC", "FDUSD", "BUSD", "TUSD", "DAI"]);
    let total = 0;
    const nonStable: Array<{ asset: string; qty: number }> = [];
    for (const b of balances) {
      const qty = parseFloat(b.free) + parseFloat(b.locked);
      if (!qty || qty < 1e-8) continue;
      if (stables.has(b.asset)) total += qty;
      else nonStable.push({ asset: b.asset, qty });
    }
    for (const { asset, qty } of nonStable.slice(0, 30)) {
      try {
        const sym = asset + "USDT";
        const pr = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${sym}`, {
          cache: "no-store",
        });
        if (!pr.ok) continue;
        const pj = await pr.json();
        const price = parseFloat(pj.price);
        if (price) total += qty * price;
      } catch {
        /* skip */
      }
    }
    return { balanceUsd: Math.round(total * 100) / 100, status: "ok" };
  } catch (e) {
    return { balanceUsd: 0, status: "error", error: e instanceof Error ? e.message : "binance fail" };
  }
}

export async function fetchGateBalance(blob?: EncryptedSecretsBlob | null): Promise<CexResult> {
  const keys = resolveCexKeys(blob);
  const apiKey = keys.gate.apiKey;
  const secret = keys.gate.secret;
  if (missing(apiKey, secret)) {
    return { balanceUsd: 0, status: "missing_keys", error: "Gate API key/secret not configured" };
  }
  try {
    const method = "GET";
    const urlPath = "/api/v4/spot/accounts";
    const query = "";
    const bodyHash = crypto.createHash("sha512").update("").digest("hex");
    const ts = Math.floor(Date.now() / 1000).toString();
    const signStr = [method, urlPath, query, bodyHash, ts].join("\n");
    const sign = crypto.createHmac("sha512", secret!).update(signStr).digest("hex");
    const res = await fetch("https://api.gateio.ws" + urlPath, {
      headers: {
        KEY: apiKey!,
        Timestamp: ts,
        SIGN: sign,
        Accept: "application/json",
      },
      cache: "no-store",
    });
    const data = await res.json();
    if (!res.ok) {
      return {
        balanceUsd: 0,
        status: "error",
        error: typeof data === "object" ? JSON.stringify(data) : res.statusText,
      };
    }
    const list = Array.isArray(data) ? data : [];
    let total = 0;
    const stables = new Set(["USDT", "USDC", "USD"]);
    for (const a of list) {
      const avail = parseFloat(a.available || "0") + parseFloat(a.locked || "0");
      if (!avail) continue;
      const cur = (a.currency || "").toUpperCase();
      if (stables.has(cur)) total += avail;
      else {
        try {
          const pr = await fetch(
            `https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${cur}_USDT`,
            { cache: "no-store" }
          );
          if (pr.ok) {
            const pj = await pr.json();
            const price = parseFloat(pj?.[0]?.last || "0");
            if (price) total += avail * price;
          }
        } catch {
          /* skip */
        }
      }
    }
    return { balanceUsd: Math.round(total * 100) / 100, status: "ok" };
  } catch (e) {
    return { balanceUsd: 0, status: "error", error: e instanceof Error ? e.message : "gate fail" };
  }
}
