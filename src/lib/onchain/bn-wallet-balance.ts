import type { TokenLine, WalletTokenCacheEntry } from "../types";
import { bnWeb3Credentials, bnWeb3Read, type BnWeb3Credentials } from "./bn-web3";
import { isFakeTokenContract, isJunkTokenSymbol } from "./junk-tokens";
import { OKX_CHAIN_IDS } from "./okx-web3-observation";
import { tokenIdentity } from "./token-cache-policy";

/**
 * Wallet totals from Binance Web3 token balances.
 * Rabby total_balance is a once-per-day reconciliation check and must not
 * replace a fresh Binance total. A failed Binance read keeps the last good
 * value until it is stale, then Rabby may fill in once — never on the next tick.
 */

export const RABBY_TOTAL_RECONCILE_MS = 24 * 60 * 60 * 1000;
/** Binance miss shorter than this keeps the last Binance total (no source flip). */
export const BN_TOTAL_STALE_FALLBACK_MS = 6 * 60 * 60 * 1000;
const ALL_TOKEN_BALANCES = "/api/v1/dex/balance/all-token-balances-by-address";
const MARKET_PRICE = "/api/v1/dex/market/price";
const PAGE_SIZE = 100;
const MAX_PAGES = 15;
/**
 * Binance rejects `chains=1,56` with code 40001. One chain per request.
 * A few reads stay in flight; the shared client still starts them 250ms apart.
 */
const CHAIN_READ_CONCURRENCY = 4;
const DUST_USD = 0.05;
const ABSURD_TOKEN_USD = 2_000_000;
const OUTLIER_MIN_USD = 10_000;
const ILLIQUID_MAX_USD = 1_000;
const ILLIQUID_VALUE_USD = 50;
const LIQUID_KEEP_USD = 50_000;

const CHAIN_BY_BN: Record<string, string> = Object.fromEntries(
  Object.entries(OKX_CHAIN_IDS).map(([slug, id]) => [id, slug])
);

const CHAIN_NAMES: Record<string, string> = {
  eth: "Ethereum",
  bsc: "BNB Chain",
  base: "Base",
  arb: "Arbitrum",
  op: "Optimism",
  matic: "Polygon",
  avax: "Avalanche",
  linea: "Linea",
  hood: "Robinhood Chain",
  abs: "Abstract",
  scrl: "Scroll",
  blast: "Blast",
  era: "zkSync Era",
  katana: "Katana",
  arc: "ARC",
  opbnb: "opBNB",
  xlayer: "X Layer",
  ink: "Ink",
  megaeth: "MegaETH",
  monad: "Monad",
  plasma: "Plasma",
  bera: "Berachain",
  zora: "Zora",
};

/** Gas coin per chain. Polygon accepts POL or MATIC. */
const NATIVE_SYMBOL: Record<string, string> = {
  eth: "ETH",
  arb: "ETH",
  op: "ETH",
  base: "ETH",
  linea: "ETH",
  hood: "ETH",
  abs: "ETH",
  era: "ETH",
  scrl: "ETH",
  blast: "ETH",
  katana: "ETH",
  ink: "ETH",
  zora: "ETH",
  megaeth: "ETH",
  uni: "ETH",
  world: "ETH",
  mode: "ETH",
  bob: "ETH",
  taiko: "ETH",
  bsc: "BNB",
  opbnb: "BNB",
  matic: "POL",
  avax: "AVAX",
  merlin: "BTC",
};

const NATIVE_PRICE_BAND: Record<string, [number, number]> = {
  ETH: [50, 100_000],
  BNB: [10, 20_000],
  POL: [0.02, 100],
  MATIC: [0.02, 100],
  AVAX: [1, 5_000],
  BTC: [1_000, 1_000_000],
};

/** Wrapped gas token. Its market price replaces Binance's native-row price. */
const WRAPPED_NATIVE: Record<string, string> = {
  eth: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
  arb: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",
  op: "0x4200000000000000000000000000000000000006",
  base: "0x4200000000000000000000000000000000000006",
  linea: "0xe5d7c2a44ffddf6b295a15c148167daaaf5cf34f",
  scrl: "0x5300000000000000000000000000000000000004",
  blast: "0x4300000000000000000000000000000000000004",
  era: "0x5aea5775959fbc2557cc8789bc1bf90a239d9a91",
  zora: "0x4200000000000000000000000000000000000006",
  ink: "0x4200000000000000000000000000000000000006",
  mode: "0x4200000000000000000000000000000000000006",
  bsc: "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
  opbnb: "0x4200000000000000000000000000000000000006",
  matic: "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270",
  avax: "0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7",
};

const NATIVE_CONTRACTS = new Set([
  "",
  "0x0000000000000000000000000000000000000000",
  "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
]);

const STABLE_SYMBOLS = new Set([
  "USDT", "USDC", "USDG", "USDE", "USD1", "USDT0", "USD0", "DAI", "FDUSD", "TUSD",
  "BUSD", "USDD", "PYUSD", "GHO", "USDS", "SUSDE", "SUSDS", "FRAX", "LUSD", "USDX",
  "USDP", "USDR", "USDF", "USDY", "SUSD", "CRVUSD",
]);

const BN_BY_CHAIN: Record<string, string> = Object.fromEntries(
  Object.entries(OKX_CHAIN_IDS).map(([slug, id]) => [slug, id])
);

export interface BnRawToken {
  chainId: string;
  bnChainId: string;
  contract: string;
  symbol: string;
  name: string;
  amount: number;
  amountExact: string;
  price: number;
  verified: boolean | null;
  risk: boolean;
  liquidity: number | null;
}

export interface BnWalletChain {
  id: string;
  name: string;
  valueUsd: number;
}

export interface BnWalletValuation {
  totalUsd: number;
  chains: BnWalletChain[];
  tokens: Array<TokenLine & { chain: string }>;
  /** A material native balance had no trusted price. Do not publish this sum. */
  incompleteNative: boolean;
  explicitEmpty: boolean;
  dropped: Record<string, number>;
}

export type WalletTotalChoice = "bn-web3" | "rabby" | "last-good";

let loggedMissingKeys = false;
let wrappedPriceCache: { at: number; prices: Record<string, number> } | null = null;

function finite(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : Number.NaN;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  }
  return Number.NaN;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function bnWalletChainIds(): string[] {
  return [...new Set(Object.values(OKX_CHAIN_IDS))].filter((id) => /^\d+$/.test(id));
}

/** Wrapped-native quotes, one request per chain. Cached across a wallet lap. */
export function wrappedNativePriceRequests(): number {
  return Object.keys(WRAPPED_NATIVE).filter((chain) => BN_BY_CHAIN[chain]).length;
}

/**
 * Cron treats `succeeded > 0` as a completed wallet-batch round.
 * Keeping the last good total (success clock unchanged) still counts.
 * `observed` is a real new success and is the only thing that should refresh observation time.
 */
export function countWalletBatch(
  wallets: Array<{
    attempted: boolean;
    status: string;
    successAt?: string | null;
    previousSuccessAt?: string | null;
  }>
): { attempted: number; succeeded: number; observed: number } {
  let attempted = 0;
  let succeeded = 0;
  let observed = 0;
  for (const wallet of wallets) {
    if (!wallet.attempted) continue;
    attempted += 1;
    if (wallet.status !== "ok") continue;
    succeeded += 1;
    const successAt = wallet.successAt || null;
    const previousSuccessAt = wallet.previousSuccessAt || null;
    if (successAt && successAt !== previousSuccessAt) observed += 1;
  }
  return { attempted, succeeded, observed };
}

async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  async function worker() {
    while (!failed && next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = await fn(items[index]);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  }
  const workers = Math.min(Math.max(1, limit), items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

export function chainSlugForBn(bnChainId: string): string {
  return CHAIN_BY_BN[bnChainId] || (/^\d+$/.test(bnChainId) ? `c${bnChainId}` : "");
}

export function isNativeCoin(chain: string, contract: string, symbol: string): boolean {
  const expected = NATIVE_SYMBOL[chain];
  if (!expected) return false;
  const sym = symbol.trim().toUpperCase();
  const matches = sym === expected || (expected === "POL" && sym === "MATIC");
  if (!matches) return false;
  return NATIVE_CONTRACTS.has(contract.trim().toLowerCase());
}

function nativeBandSymbol(chain: string, symbol: string): string {
  const sym = symbol.trim().toUpperCase();
  if (sym === "MATIC") return "MATIC";
  return NATIVE_SYMBOL[chain] || sym;
}

export function acceptNativePrice(chain: string, symbol: string, price: number): boolean {
  if (!(price > 0) || price > 1e7) return false;
  const band = NATIVE_PRICE_BAND[nativeBandSymbol(chain, symbol)];
  if (!band) return true;
  return price >= band[0] && price <= band[1];
}

/** Copy one chain's trusted native price onto every chain that uses the same coin. */
export function expandNativePrices(prices: Record<string, number>): Record<string, number> {
  const bySymbol: Record<string, number> = {};
  for (const [chain, price] of Object.entries(prices)) {
    const symbol = NATIVE_SYMBOL[chain];
    if (symbol && acceptNativePrice(chain, symbol, price)) bySymbol[symbol] = price;
  }
  const out = { ...prices };
  for (const [chain, symbol] of Object.entries(NATIVE_SYMBOL)) {
    if (!(out[chain] > 0) && bySymbol[symbol] > 0) out[chain] = bySymbol[symbol];
  }
  return out;
}

export function nativePricesFromTokenCache(
  entries: Iterable<WalletTokenCacheEntry | undefined>
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const entry of entries) {
    for (const token of entry?.tokens ?? []) {
      if (token.priceSource !== "coinstats") continue;
      if (!isNativeCoin(token.chain, token.contractAddress || "", token.symbol)) continue;
      const price = token.valuationPrice ?? (token.amount > 0 ? token.valueUsd / token.amount : 0);
      if (acceptNativePrice(token.chain, token.symbol, price)) out[token.chain] = price;
    }
  }
  return expandNativePrices(out);
}

function contractOf(row: Record<string, unknown>): string {
  if ("tokenContractAddress" in row) return String(row.tokenContractAddress ?? "").trim().toLowerCase();
  if ("contractAddress" in row) return String(row.contractAddress ?? "").trim().toLowerCase();
  if ("tokenAddress" in row) return String(row.tokenAddress ?? "").trim().toLowerCase();
  if ("address" in row && !("tokenAssets" in row)) return String(row.address ?? "").trim().toLowerCase();
  return "";
}

function readVerified(row: Record<string, unknown>): boolean | null {
  const value = "isVerified" in row ? row.isVerified : "is_verified" in row ? row.is_verified : undefined;
  if (value === true || value === "true" || value === 1 || value === "1") return true;
  if (value === false || value === "false" || value === 0 || value === "0") return false;
  return null;
}

function readRisk(row: Record<string, unknown>): boolean {
  const flagged = row.isRiskToken;
  if (flagged === true || flagged === "true" || flagged === 1 || flagged === "1") return true;
  if (row.isSpam === true || row.isPhishing === true || row.is_scam === true || row.is_suspicious === true) return true;
  const level = String(row.riskLevel ?? "").trim().toUpperCase();
  if (level === "HIGH" || level === "MEDIUM" || level === "SPAM" || level === "PHISHING" || level === "RISK") return true;
  const levelInt = finite(row.riskLevelInt);
  return Number.isFinite(levelInt) && levelInt >= 3;
}

function readLiquidity(row: Record<string, unknown>): number | null {
  if (row.lowLiquidity === 1 || row.lowLiquidity === true || row.lowLiquidity === "1") return 0;
  for (const key of ["liquidityUsd", "liquidity", "tokenLiquidity", "poolLiquidity"]) {
    if (row[key] == null || row[key] === "") continue;
    const value = finite(row[key]);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  return null;
}

function tokenArray(bucket: Record<string, unknown>): unknown[] | null {
  for (const key of ["tokenAssets", "tokenBalances", "tokenList", "balances", "list", "tokens"]) {
    if (Array.isArray(bucket[key])) return bucket[key] as unknown[];
  }
  return null;
}

function pushToken(out: BnRawToken[], row: Record<string, unknown>, inheritedChain: string) {
  const symbol = String(row.symbol ?? row.tokenSymbol ?? "").trim();
  const amountRaw = row.balance ?? row.tokenAmount ?? row.amount ?? row.remainQty;
  const amount = finite(amountRaw);
  if (!symbol || !Number.isFinite(amount) || amount < 0) return;
  const bnChainId = String(row.binanceChainId ?? row.chainId ?? row.chainIndex ?? inheritedChain ?? "").trim();
  if (!bnChainId || bnChainId.startsWith("CT_")) return;
  const chainId = chainSlugForBn(bnChainId);
  if (!chainId) return;
  const price = finite(row.tokenPrice ?? row.price);
  out.push({
    chainId,
    bnChainId,
    contract: contractOf(row),
    symbol,
    name: String(row.tokenName ?? row.name ?? "").trim(),
    amount,
    amountExact: typeof amountRaw === "string" ? amountRaw : String(amountRaw),
    price: Number.isFinite(price) && price > 0 ? price : 0,
    verified: readVerified(row),
    risk: readRisk(row),
    liquidity: readLiquidity(row),
  });
}

function visit(out: BnRawToken[], value: unknown, inheritedChain = "") {
  const row = asRecord(value);
  if (!row) return;
  const chainHint = String(row.binanceChainId ?? row.chainId ?? row.chainIndex ?? inheritedChain ?? "");
  const nested = tokenArray(row);
  const looksLikeToken = row.symbol != null || row.tokenSymbol != null || row.balance != null || row.remainQty != null;
  if (nested && !looksLikeToken) {
    for (const item of nested) visit(out, item, chainHint);
    return;
  }
  if (looksLikeToken) pushToken(out, row, chainHint);
  else if (nested) for (const item of nested) visit(out, item, chainHint);
}

/** Accept OKX-shaped tokenAssets, per-chain buckets, and flat balance rows. */
export function extractBnRawTokens(payload: unknown): BnRawToken[] {
  const root = asRecord(payload);
  const data = root && "data" in root ? root.data : payload;
  const out: BnRawToken[] = [];
  if (Array.isArray(data)) {
    for (const item of data) visit(out, item);
    return out;
  }
  visit(out, data);
  return out;
}

function bump(dropped: Record<string, number>, reason: string) {
  dropped[reason] = (dropped[reason] || 0) + 1;
}

function stableSymbol(symbol: string): boolean {
  const upper = symbol.trim().toUpperCase().replace(/\.E$/, "");
  return STABLE_SYMBOLS.has(upper);
}

interface KeptToken {
  raw: BnRawToken;
  price: number;
  valueUsd: number;
  native: boolean;
  stable: boolean;
  priceSource?: "coinstats";
}

function wrappedPriceFromRows(rows: BnRawToken[], chain: string): number {
  const wrapped = WRAPPED_NATIVE[chain];
  if (!wrapped) return 0;
  const symbol = NATIVE_SYMBOL[chain] || "";
  for (const row of rows) {
    if (row.chainId !== chain || row.contract !== wrapped || row.risk) continue;
    if (acceptNativePrice(chain, symbol, row.price)) return row.price;
  }
  return 0;
}

/**
 * Filter spam / unverified / illiquid / absurd rows and reprice native coins
 * from a trusted price. Binance's native tokenPrice is never used.
 */
export function valueBnWalletTokens(
  rows: BnRawToken[],
  options: { nativePrices?: Record<string, number>; marketPrices?: Record<string, number> } = {}
): BnWalletValuation {
  const trusted = expandNativePrices(options.nativePrices ?? {});
  const market = expandNativePrices(options.marketPrices ?? {});
  const dedup = new Map<string, BnRawToken>();
  for (const row of rows) {
    const key = `${row.chainId}:${row.contract}:${row.symbol.toUpperCase()}`;
    const previous = dedup.get(key);
    if (!previous || row.amount > previous.amount) dedup.set(key, row);
  }
  const unique = [...dedup.values()];
  const dropped: Record<string, number> = {};
  const kept: KeptToken[] = [];
  let incompleteNative = false;

  for (const raw of unique) {
    const native = isNativeCoin(raw.chainId, raw.contract, raw.symbol);
    if (!raw.symbol || isJunkTokenSymbol(raw.symbol, raw.name)) {
      bump(dropped, "junk");
      continue;
    }
    if (isFakeTokenContract(raw.chainId, raw.symbol, raw.contract)) {
      bump(dropped, "fake");
      continue;
    }
    if (raw.risk) {
      bump(dropped, "risk");
      continue;
    }
    if (!(raw.amount > 0)) {
      bump(dropped, "zero");
      continue;
    }

    let price = raw.price;
    let priceSource: "coinstats" | undefined;
    if (native) {
      const fromCache = trusted[raw.chainId] || 0;
      const fromWrapped = wrappedPriceFromRows(unique, raw.chainId);
      const fromMarket = market[raw.chainId] || 0;
      const chosen = [fromCache, fromWrapped, fromMarket].find((candidate) =>
        acceptNativePrice(raw.chainId, raw.symbol, candidate)
      );
      if (chosen) {
        price = chosen;
        if (chosen === fromCache) priceSource = "coinstats";
      } else if (raw.amount > 1e-6) {
        incompleteNative = true;
        bump(dropped, "native-unpriced");
        continue;
      } else {
        bump(dropped, "dust");
        continue;
      }
    } else if (!(price > 0)) {
      bump(dropped, "unpriced");
      continue;
    }

    const stable = stableSymbol(raw.symbol);
    const valueUsd = raw.amount * price;
    if (!Number.isFinite(valueUsd) || valueUsd < 0) {
      bump(dropped, "unpriced");
      continue;
    }
    if (valueUsd < DUST_USD) {
      bump(dropped, "dust");
      continue;
    }
    if (stable && (price < 0.5 || price > 1.5)) {
      bump(dropped, "bad-stable");
      continue;
    }
    if (raw.verified === false && !native && !stable && valueUsd >= 1) {
      bump(dropped, "unverified");
      continue;
    }
    if (
      !native &&
      !stable &&
      raw.liquidity != null &&
      raw.liquidity < ILLIQUID_MAX_USD &&
      valueUsd >= ILLIQUID_VALUE_USD
    ) {
      bump(dropped, "illiquid");
      continue;
    }
    if (valueUsd > ABSURD_TOKEN_USD) {
      bump(dropped, "absurd");
      continue;
    }
    kept.push({ raw, price, valueUsd, native, stable, priceSource });
  }

  let list = kept;
  for (let pass = 0; pass < 5; pass += 1) {
    const sorted = [...list].sort((left, right) => right.valueUsd - left.valueUsd);
    const top = sorted[0];
    if (!top || top.native || top.stable || top.raw.verified === true) break;
    if (top.raw.liquidity != null && top.raw.liquidity >= LIQUID_KEEP_USD) break;
    const rest = sorted.slice(1).reduce((sum, token) => sum + token.valueUsd, 0);
    if (top.valueUsd >= OUTLIER_MIN_USD && top.valueUsd > Math.max(150, rest) * 3) {
      list = list.filter((token) => token !== top);
      bump(dropped, "absurd");
      continue;
    }
    break;
  }

  const chainTotals = new Map<string, number>();
  const tokens: Array<TokenLine & { chain: string }> = [];
  for (const token of list) {
    chainTotals.set(token.raw.chainId, (chainTotals.get(token.raw.chainId) || 0) + token.valueUsd);
    const kind = token.stable ? "stable" : token.native ? "native" : "spot";
    tokens.push({
      chain: token.raw.chainId,
      symbol: token.raw.symbol,
      amount: token.raw.amount,
      amountExact: token.raw.amountExact,
      valueUsd: token.valueUsd,
      valuationPrice: token.price,
      priceSource: token.priceSource,
      tokenId: token.native ? token.raw.chainId : token.raw.contract || token.raw.symbol,
      contractAddress: token.native ? undefined : token.raw.contract || undefined,
      kind,
      isCore: token.native || token.stable || token.raw.verified === true,
    });
  }
  tokens.sort((left, right) => right.valueUsd - left.valueUsd);
  const totalUsd = round2([...chainTotals.values()].reduce((sum, value) => sum + value, 0));
  const chains = [...chainTotals.entries()]
    .map(([id, valueUsd]) => ({
      id,
      name: CHAIN_NAMES[id] || id,
      valueUsd: round2(valueUsd),
    }))
    .filter((chain) => chain.valueUsd >= 0.01)
    .sort((left, right) => right.valueUsd - left.valueUsd);
  return {
    totalUsd,
    chains,
    tokens,
    incompleteNative,
    explicitEmpty: totalUsd < 0.01 && !incompleteNative,
    dropped,
  };
}

export function applyBnWalletTokens(
  previous: WalletTokenCacheEntry | undefined,
  lines: Array<TokenLine & { chain: string }>,
  coveredChains: string[],
  at: string
): WalletTokenCacheEntry {
  const base = previous ?? { at: "", tokens: [], unpricedCount: 0, unpricedByChain: {}, coveredChains: [] };
  if (!coveredChains.length) return { ...base, lastAttemptAt: at };
  const covered = new Set(coveredChains);
  const rpcByKey = new Map<string, (typeof base.tokens)[number]>();
  for (const token of base.tokens) {
    if (token.quantitySource === "rpc" && covered.has(token.chain)) {
      rpcByKey.set(`${token.chain}:${tokenIdentity(token)}`, token);
    }
  }
  const tokens = lines.map((line) => {
    const rpc = rpcByKey.get(`${line.chain}:${tokenIdentity(line)}`);
    if (!rpc) return { ...line, updatedAt: at };
    const exact = Number(rpc.amountExact);
    const amount = Number.isFinite(exact) && exact >= 0 ? exact : rpc.amount;
    const price = line.valuationPrice ?? (line.amount > 0 ? line.valueUsd / line.amount : 0);
    return {
      ...line,
      amount,
      amountExact: rpc.amountExact ?? line.amountExact,
      valueUsd: amount * (price > 0 ? price : 0),
      quantitySource: "rpc" as const,
      quantityBlock: rpc.quantityBlock,
      updatedAt: rpc.updatedAt,
    };
  });
  const retained = base.tokens.filter(
    (token) => !covered.has(token.chain) && !isJunkTokenSymbol(token.symbol, "")
  );
  const inventory = { ...base.inventory };
  for (const token of tokens) {
    const id = tokenIdentity(token);
    inventory[`${token.chain}:${id}`] = {
      ...inventory[`${token.chain}:${id}`],
      amount: token.amount,
      amountExact: token.amountExact,
      updatedAt: token.quantitySource === "rpc" ? token.updatedAt || at : at,
    };
  }
  return {
    ...base,
    at,
    lastAttemptAt: at,
    lastError: undefined,
    source: "bn-web3",
    tokens: [...retained, ...tokens].sort((left, right) => right.valueUsd - left.valueUsd),
    unpricedCount: 0,
    unpricedByChain: {},
    coveredChains: [...new Set([...base.coveredChains.filter((id) => id !== "*"), ...coveredChains])],
    inventory,
  };
}

function parseMarketPrices(payload: unknown): Record<string, number> {
  const root = asRecord(payload);
  const data = root && "data" in root ? root.data : payload;
  const record = asRecord(data);
  const rows = Array.isArray(data) ? data : record && Array.isArray(record.list) ? record.list : [];
  const out: Record<string, number> = {};
  for (const item of rows) {
    const row = asRecord(item);
    if (!row) continue;
    const bnChainId = String(row.binanceChainId ?? row.chainId ?? row.chainIndex ?? "");
    const chain = chainSlugForBn(bnChainId);
    const contract = String(row.tokenContractAddress ?? row.contractAddress ?? "").trim().toLowerCase();
    const price = finite(row.price ?? row.tokenPrice);
    if (!chain || !contract || !acceptNativePrice(chain, NATIVE_SYMBOL[chain] || "", price)) continue;
    if (WRAPPED_NATIVE[chain] === contract) out[chain] = price;
  }
  return expandNativePrices(out);
}

/** One wrapped-native quote per chain, reused across wallets. A miss leaves cached or empty prices. */
export async function fetchWrappedNativePrices(
  options: { credentials?: BnWeb3Credentials; request?: typeof fetch } = {}
): Promise<Record<string, number>> {
  const now = Date.now();
  if (wrappedPriceCache && now - wrappedPriceCache.at < 10 * 60_000) return wrappedPriceCache.prices;
  if (!options.credentials && !bnWeb3Credentials()) return wrappedPriceCache?.prices ?? {};
  const pairs = Object.entries(WRAPPED_NATIVE).filter(([chain]) => BN_BY_CHAIN[chain]);
  try {
    const parts = await mapLimited(pairs, CHAIN_READ_CONCURRENCY, async ([chain, contract]) => {
      try {
        const payload = await bnWeb3Read(
          MARKET_PRICE,
          [{ binanceChainId: BN_BY_CHAIN[chain], tokenContractAddress: contract }],
          options
        );
        return parseMarketPrices(payload);
      } catch {
        return {};
      }
    });
    const prices: Record<string, number> = {};
    for (const part of parts) Object.assign(prices, part);
    if (Object.keys(prices).length) wrappedPriceCache = { at: now, prices };
    return Object.keys(prices).length ? prices : wrappedPriceCache?.prices ?? {};
  } catch {
    return wrappedPriceCache?.prices ?? {};
  }
}

export async function fetchBnWalletValuation(
  address: string,
  options: {
    nativePrices?: Record<string, number>;
    marketPrices?: Record<string, number>;
    deadlineMs?: number;
    credentials?: BnWeb3Credentials;
    request?: typeof fetch;
    chainIds?: string[];
  } = {}
): Promise<(BnWalletValuation & { queriedChains: string[] }) | null> {
  const normalized = address.trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(normalized)) return null;
  if (!options.credentials && !bnWeb3Credentials()) {
    if (!loggedMissingKeys) {
      loggedMissingKeys = true;
      console.warn("[wallet-total] bn_web3_keys_missing");
    }
    return null;
  }
  const chainIds = (options.chainIds?.length ? options.chainIds : bnWalletChainIds()).filter((id) => /^\d+$/.test(id));
  if (!chainIds.length) return null;
  const rows: BnRawToken[] = [];
  const queried = new Set<string>();
  try {
    const chainRows = await mapLimited(chainIds, CHAIN_READ_CONCURRENCY, async (chainId) => {
      if (options.deadlineMs != null && Date.now() >= options.deadlineMs - 1_500) {
        throw new Error("bn_web3_deadline");
      }
      const slug = chainSlugForBn(chainId);
      const seen = new Set<string>();
      const chainTokens: BnRawToken[] = [];
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        if (options.deadlineMs != null && Date.now() >= options.deadlineMs - 1_500) {
          throw new Error("bn_web3_deadline");
        }
        const params = new URLSearchParams({
          address: normalized,
          chains: chainId,
          excludeRiskToken: "true",
          page: String(page),
          pageSize: String(PAGE_SIZE),
        });
        const payload = await bnWeb3Read(`${ALL_TOKEN_BALANCES}?${params.toString()}`, undefined, options);
        const parsed = extractBnRawTokens(payload);
        if (!parsed.length) break;
        let added = 0;
        for (const row of parsed) {
          const key = `${row.chainId}:${row.contract}:${row.symbol.toUpperCase()}`;
          if (seen.has(key)) continue;
          seen.add(key);
          chainTokens.push(row);
          added += 1;
        }
        if (added === 0 || parsed.length < PAGE_SIZE) break;
      }
      return { slug, chainTokens };
    });
    for (const chain of chainRows) {
      if (chain.slug) queried.add(chain.slug);
      rows.push(...chain.chainTokens);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "bn_web3_failed";
    console.warn(
      `[wallet-total] bn_unavailable ${normalized.slice(0, 8)} ${/^bn_web3_[a-z0-9_]+$/.test(message) ? message : "bn_web3_failed"}`
    );
    return null;
  }
  const valuation = valueBnWalletTokens(rows, {
    nativePrices: options.nativePrices,
    marketPrices: options.marketPrices,
  });
  return { ...valuation, queriedChains: [...queried] };
}

export function binanceTotalIsFresh(
  source: string | null | undefined,
  successAt: string | null | undefined,
  nowMs: number
): boolean {
  if (source !== "bn-web3") return false;
  const at = successAt ? Date.parse(successAt) : Number.NaN;
  return Number.isFinite(at) && nowMs >= at && nowMs - at < BN_TOTAL_STALE_FALLBACK_MS;
}

/** Daily check only. Over max($150, 3%) is logged; it does not change the published total. */
export function rabbyTotalDiscrepancy(
  binanceUsd: number,
  rabbyUsd: number
): { delta: number; threshold: number } | null {
  if (!Number.isFinite(binanceUsd) || !Number.isFinite(rabbyUsd)) return null;
  const delta = Math.abs(binanceUsd - rabbyUsd);
  const threshold = Math.max(150, Math.max(Math.abs(binanceUsd), Math.abs(rabbyUsd)) * 0.03);
  return delta > threshold ? { delta, threshold } : null;
}

/**
 * Binance wins whenever the read succeeded. Rabby is used only after Binance
 * has been failing longer than the stale window (or there has never been a
 * Binance total). A fresh Binance total is never replaced by Rabby.
 */
export function chooseWalletTotal(input: {
  nowMs: number;
  previousUsd: number;
  previousAtMs: number | null;
  previousSource?: string | null;
  binanceUsd: number | null;
  rabbyUsd: number | null;
}): { usd: number; source: WalletTotalChoice; status: "ok" | "error" } {
  if (input.binanceUsd != null && Number.isFinite(input.binanceUsd) && input.binanceUsd >= 0) {
    return { usd: round2(input.binanceUsd), source: "bn-web3", status: "ok" };
  }
  const age = input.previousAtMs == null ? Number.POSITIVE_INFINITY : input.nowMs - input.previousAtMs;
  // Explicit 0 is a successful Binance read. Rabby must not replace it while it is fresh.
  const freshBinance =
    input.previousSource === "bn-web3" &&
    Number.isFinite(input.previousUsd) &&
    input.previousUsd >= 0 &&
    age >= 0 &&
    age < BN_TOTAL_STALE_FALLBACK_MS;
  if (freshBinance || input.rabbyUsd == null || !Number.isFinite(input.rabbyUsd) || input.rabbyUsd < 0) {
    return {
      usd: round2(Number(input.previousUsd) || 0),
      source: "last-good",
      status: freshBinance || input.previousUsd > 0 ? "ok" : "error",
    };
  }
  return { usd: round2(input.rabbyUsd), source: "rabby", status: "ok" };
}
