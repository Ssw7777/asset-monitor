/**
 * Authentic wallet-total calibration (NOT token-quantity sums).
 * Sources, in order:
 * 1) OKX OnchainOS total-value (assetType=0 = tokens + DeFi)
 * 2) Zerion positions no_filter (wallet + counted DeFi; loans excluded)
 * Never invent a total from tokenCache / RPC amounts alone.
 */
import { web3Credentials, web3Read } from "./okx-web3";
import { OKX_CHAIN_IDS } from "./okx-web3-observation";
import { nextZerionKey, zerionRequest } from "./zerion-keys";
import { normalizeChainId } from "./token-providers";

export type CalibrationSource = "okx-web3" | "zerion";

export interface CalibratedTotal {
  totalUsd: number;
  source: CalibrationSource;
  /** Provider covers tokens+DeFi on its chain set; App-native still comes from cache. */
  includesDefi: true;
}

const number = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

function parseOkxTotal(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;
  const envelope = payload as Record<string, unknown>;
  if (String(envelope.code) !== "0" || !Array.isArray(envelope.data) || !envelope.data.length) return null;
  const row = envelope.data[0];
  if (!row || typeof row !== "object") return null;
  const raw = (row as Record<string, unknown>).totalValue;
  const total = Number(raw);
  return Number.isFinite(total) && total >= 0 ? total : null;
}

/** OKX authentic total: tokens + DeFi on supported chains (assetType=0). */
export async function fetchOkxCalibratedTotal(
  address: string,
  opts: { chainIds?: string[]; deadlineMs?: number } = {}
): Promise<CalibratedTotal | null> {
  if (!web3Credentials()) return null;
  if (opts.deadlineMs != null && Date.now() >= opts.deadlineMs - 1_500) return null;
  const chains = (opts.chainIds?.length ? opts.chainIds : Object.values(OKX_CHAIN_IDS))
    .filter((id) => /^\d+$/.test(id))
    .slice(0, 50);
  if (!chains.length) return null;
  try {
    const path =
      "/api/v6/dex/balance/total-value-by-address?" +
      new URLSearchParams({
        address: address.toLowerCase(),
        chains: chains.join(","),
        assetType: "0",
        excludeRiskToken: "true",
      });
    const payload = await web3Read(path);
    const totalUsd = parseOkxTotal(payload);
    if (totalUsd == null) return null;
    return { totalUsd: Math.round(totalUsd * 100) / 100, source: "okx-web3", includesDefi: true };
  } catch {
    return null;
  }
}

/**
 * Zerion portfolio total from no_filter positions.
 * Counts wallet holdings + deposit/staked/reward/claimable/locker; excludes loans.
 */
export async function fetchZerionCalibratedTotal(
  address: string,
  opts: { deadlineMs?: number } = {}
): Promise<CalibratedTotal | null> {
  const key = nextZerionKey();
  if (!key) return null;
  const remainingMs = opts.deadlineMs == null ? 18_000 : opts.deadlineMs - Date.now();
  if (remainingMs < 2_000) return null;
  const COUNTED = new Set(["wallet", "deposit", "staked", "reward", "claimable", "locker"]);
  return zerionRequest(async () => {
    try {
      const response = await fetch(
        `https://api.zerion.io/v1/wallets/${encodeURIComponent(address)}/positions/?currency=usd&filter[positions]=no_filter&page[size]=100`,
        {
          headers: {
            Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`,
            Accept: "application/json",
          },
          cache: "no-store",
          signal: AbortSignal.timeout(Math.min(18_000, remainingMs)),
        }
      );
      if (!response.ok) return null;
      const body = (await response.json()) as {
        data?: Array<{
          attributes?: { position_type?: string; value?: unknown };
          relationships?: { chain?: { data?: { id?: string } } };
        }>;
        links?: { next?: string | null };
      };
      if (!Array.isArray(body.data)) return null;
      // Incomplete pagination must not become a wallet total.
      if (body.links?.next) return null;
      let totalUsd = 0;
      for (const item of body.data) {
        const type = String(item.attributes?.position_type || "");
        if (!COUNTED.has(type)) continue;
        // Keep chain normalization in the loop so junk rows still fail closed.
        normalizeChainId(String(item.relationships?.chain?.data?.id || "unknown"));
        const valueUsd = number(item.attributes?.value);
        if (valueUsd > 0.005) totalUsd += valueUsd;
      }
      if (!Number.isFinite(totalUsd) || totalUsd < 0) return null;
      return { totalUsd: Math.round(totalUsd * 100) / 100, source: "zerion", includesDefi: true };
    } catch {
      return null;
    }
  });
}

/** Rotate OKX → Zerion. Never fall back to summing token quantities. */
export async function fetchCalibratedWalletTotal(
  address: string,
  opts: { chainIds?: string[]; deadlineMs?: number; prefer?: CalibrationSource } = {}
): Promise<CalibratedTotal | null> {
  const order: CalibrationSource[] =
    opts.prefer === "zerion" ? ["zerion", "okx-web3"] : ["okx-web3", "zerion"];
  for (const source of order) {
    if (opts.deadlineMs != null && Date.now() >= opts.deadlineMs - 1_000) return null;
    const result =
      source === "okx-web3"
        ? await fetchOkxCalibratedTotal(address, opts)
        : await fetchZerionCalibratedTotal(address, opts);
    if (result) return result;
  }
  return null;
}
