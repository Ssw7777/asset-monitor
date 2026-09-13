import type {
  ChainAllocation,
  DappAllocation,
  DappChainAllocation,
  DappTokenPosition,
  DappWalletShare,
  OnchainBreakdown,
  TokenLine,
  TokenHolding,
  WalletProtocolCacheEntry,
  WalletTokenCacheEntry,
  Wallet,
} from "../types";
import { activeTokenSource, fetchZerionTokens, type TokenSource } from "./token-providers";

interface ChainBalanceDetail {
  id: string;
  name: string;
  valueUsd: number;
  logoUrl?: string;
}

interface TotalBalanceDetail {
  totalUsd: number;
  chains: ChainBalanceDetail[];
}

/** Token lines for one wallet, already classified. `chain` is the DeBank chain id. */
interface WalletTokenDetail {
  tokens: Array<TokenLine & { chain: string }>;
  unpricedCount: number;
  unpricedByChain: Record<string, number>;
  /** 本次真正取到明细的链；`*` 表示官方接口一次性覆盖全部链。 */
  coveredChains: string[];
}

const cache = new Map<string, { detail: TotalBalanceDetail; at: number }>();
const TTL = 5 * 60 * 1000;
/** 协议明细缓存 6 小时；过期时一轮尝试补齐全部地址，失败则继续保留上次成功值。 */
const PROTOCOL_TTL = 6 * 60 * 60 * 1000;
/** Fill every missing/stale wallet protocol record in one full cycle when the API allows it. */
const PROTOCOL_WALLET_BUDGET = 25;
/** One five-minute cycle attempts every configured wallet (the UI limit is 50). */
const MAX_PUBLIC_REQUESTS_PER_RUN = 50;
const CONCURRENCY = 4;
/**
 * 公共接口的请求间隔。实测：同一个 IP 按 450ms 间隔逐个请求 10 个地址全部 200，
 * 而并发 4 + 320ms 错峰会被判定为突发流量直接 429。所以这里放慢到 700ms。
 */
const PUBLIC_REQUEST_INTERVAL_MS = 900;
/**
 * 代币明细额度控制：Zerion 免费版是 300 次/天，所以
 * 每轮最多补 8 个地址、单地址结果缓存 6 小时（持久化到数据库，冷启动也不重复消耗）。
 */
const TOKEN_TTL_MS = 6 * 60 * 60 * 1000;
const TOKEN_WALLET_BUDGET = 4;
const TOKEN_CHAINS_PER_WALLET = 3;
const TOKEN_MIN_WALLET_USD = 10;
const TOKEN_MIN_CHAIN_USD = 5;
const TOKEN_MIN_VALUE_USD = 0.01;

/** 稳定币白名单：这些代币在链上分类时归入“稳定币”，其余归入“现货”。 */
const STABLE_SYMBOLS = new Set([
  "USDT", "USDC", "USDG", "USDE", "USD1", "USDT.E", "USDC.E", "USDT0", "USD0",
  "DAI", "FDUSD", "TUSD", "BUSD", "USDD", "PYUSD", "GHO", "USDS", "SUSDE", "SUSDS",
  "FRAX", "LUSD", "USDX", "USDP", "USDR", "USDF", "USDY", "USD+", "SUSD", "CRVUSD",
]);

const TOKENS_PER_GROUP = 12;

let publicRequestQueue: Promise<void> = Promise.resolve();
let nextPublicRequestAt = 0;
/**
 * 公共接口（Rabby / DeBank 无 Key 路径）被限流后的全局冷却截止时间。
 * 冷却期内不再发新请求，直接沿用上次成功数据，避免把 429 变成请求轰炸。
 */
let publicBlockedUntil = 0;
/** 连续 429 计数：偶发一两次不该把整轮刷新锁死，连续多次才进入全局冷却。 */
let publicConsecutive429 = 0;

export type WalletFetchStatus = "ok" | "cached" | "error";

export function getPublicBlockedUntil(): number {
  return publicBlockedUntil;
}

function publicBlocked(): boolean {
  return Date.now() < publicBlockedUntil;
}

function markPublicBlocked(ms: number) {
  const wait = Math.min(2 * 60_000, Math.max(15_000, ms));
  publicBlockedUntil = Math.max(publicBlockedUntil, Date.now() + wait);
}

const number = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function unwrapObject(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  if (record.data && typeof record.data === "object" && !Array.isArray(record.data)) {
    return record.data as Record<string, unknown>;
  }
  return record;
}

function unwrapArray(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data.filter((item): item is Record<string, unknown> => !!item && typeof item === "object");
  if (!data || typeof data !== "object") return [];
  const record = data as Record<string, unknown>;
  const list = Array.isArray(record.data)
    ? record.data
    : record.data && typeof record.data === "object" && Array.isArray((record.data as Record<string, unknown>).list)
      ? ((record.data as Record<string, unknown>).list as unknown[])
      : Array.isArray(record.list)
        ? record.list
        : [];
  return list.filter((item): item is Record<string, unknown> => !!item && typeof item === "object");
}

function parseTotalDetail(data: unknown): TotalBalanceDetail | null {
  const body = unwrapObject(data);
  if (!body) return null;
  const rawTotal = body.total_usd_value ?? body.total_usd;
  const totalUsd = Number(rawTotal);
  if (!Number.isFinite(totalUsd) || totalUsd < 0) return null;
  const rawChains = Array.isArray(body.chain_list) ? body.chain_list : [];
  const chains = rawChains
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((chain) => ({
      id: String(chain.id || chain.community_id || "unknown"),
      name: String(chain.name || chain.id || "Unknown"),
      valueUsd: number(chain.usd_value ?? chain.total_usd_value),
      logoUrl: typeof chain.logo_url === "string" && chain.logo_url ? chain.logo_url : undefined,
    }))
    .filter((chain) => chain.valueUsd >= 0.01)
    .sort((left, right) => right.valueUsd - left.valueUsd);
  return { totalUsd, chains };
}

const commonHeaders = { Accept: "application/json", "User-Agent": "asset-monitor/0.2" };

function waitForPublicSlot(url: string) {
  const host = new URL(url).hostname;
  if (host !== "api.rabby.io" && host !== "api.debank.com") return Promise.resolve();
  const turn = publicRequestQueue.then(async () => {
    const delay = Math.max(0, nextPublicRequestAt - Date.now());
    if (delay) await sleep(delay);
    nextPublicRequestAt = Date.now() + PUBLIC_REQUEST_INTERVAL_MS;
  });
  publicRequestQueue = turn.catch(() => undefined);
  return turn;
}

function isPublicEndpoint(url: string) {
  try {
    const host = new URL(url).hostname;
    return host === "api.rabby.io" || host === "api.debank.com";
  } catch {
    return false;
  }
}

function retryDelay(response: Response, attempt: number) {
  const header = response.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.min(8_000, Math.max(750, seconds * 1_000));
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.min(8_000, Math.max(750, date - Date.now()));
  }
  return Math.min(8_000, 900 * 2 ** attempt);
}

async function fetchJson(
  url: string,
  headers: Record<string, string> = {},
  retries = 2
): Promise<{ data: unknown | null; status: number }> {
  const publicEndpoint = isPublicEndpoint(url);
  // 冷却期内直接返回限流状态：不再发请求，调用方沿用上次成功数据。
  if (publicEndpoint && publicBlocked()) return { data: null, status: 429 };
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      await waitForPublicSlot(url);
      const response = await fetch(url, {
        headers: { ...commonHeaders, ...headers },
        cache: "no-store",
        signal: AbortSignal.timeout(18_000),
      });
      if (response.ok) {
        if (publicEndpoint) publicConsecutive429 = 0;
        return { data: await response.json(), status: response.status };
      }
      if (response.status === 429) {
        const wait = retryDelay(response, attempt);
        if (publicEndpoint) {
          publicConsecutive429 += 1;
          // 偶发 429：先自己退避重试同一请求；只有连续多次才进入全局冷却
          if (publicConsecutive429 >= 3) markPublicBlocked(wait);
          if (attempt < retries) {
            await sleep(wait);
            continue;
          }
          return { data: null, status: 429 };
        }
        if (attempt < retries) {
          await sleep(wait);
          continue;
        }
        return { data: null, status: 429 };
      }
      if (response.status >= 500 && attempt < retries) {
        await sleep(retryDelay(response, attempt));
        continue;
      }
      return { data: null, status: response.status };
    } catch {
      if (attempt < retries) {
        await sleep(Math.min(4_000, 600 * 2 ** attempt));
        continue;
      }
      return { data: null, status: 0 };
    }
  }
  return { data: null, status: 0 };
}

async function fetchDetailOnce(address: string): Promise<TotalBalanceDetail | null> {
  const key = process.env.DEBANK_ACCESS_KEY;
  if (key) {
    const response = await fetchJson(
      `https://pro-openapi.debank.com/v1/user/total_balance?id=${address}`,
      { AccessKey: key },
      1
    );
    const official = parseTotalDetail(
      response.data
    );
    if (official) return official;
  }
  const rabbyResponse = await fetchJson(`https://api.rabby.io/v1/user/total_balance?id=${address}`);
  const rabby = parseTotalDetail(rabbyResponse.data);
  if (rabby) return rabby;
  // The legacy host is a last-resort fallback. Avoid doubling requests while Rabby is rate-limiting.
  if (rabbyResponse.status === 429) return null;
  const legacyResponse = await fetchJson(
    `https://api.debank.com/user/total_balance?addr=${address}`,
    { Origin: "https://debank.com", Referer: "https://debank.com/" },
    1
  );
  return parseTotalDetail(
    legacyResponse.data
  );
}

async function fetchWalletDetail(address: string, force = false): Promise<{ detail: TotalBalanceDetail | null; status: WalletFetchStatus }> {
  const normalized = address.toLowerCase();
  const hit = cache.get(normalized);
  if (!force && hit && Date.now() - hit.at < TTL) return { detail: hit.detail, status: "cached" };

  const detail = await fetchDetailOnce(normalized);
  if (detail) {
    cache.set(normalized, { detail, at: Date.now() });
    return { detail, status: "ok" };
  }
  return hit ? { detail: hit.detail, status: "cached" } : { detail: null, status: "error" };
}

type ProtocolCache = Record<string, WalletProtocolCacheEntry>;

async function fetchComplexProtocols(
  address: string,
  store: ProtocolCache
): Promise<Record<string, unknown>[] | null> {
  const normalized = address.toLowerCase();
  const hit = store[normalized] || null;
  if (hit && Date.now() - new Date(hit.at).getTime() < PROTOCOL_TTL) return hit.protocols;
  const key = process.env.DEBANK_ACCESS_KEY;
  const urls: Array<{ url: string; headers?: Record<string, string> }> = [];
  if (key) {
    urls.push({
      url: `https://pro-openapi.debank.com/v1/user/all_complex_protocol_list?id=${normalized}`,
      headers: { AccessKey: key },
    });
  }
  urls.push(
    { url: `https://api.rabby.io/v1/user/complex_protocol_list?id=${normalized}` }
  );
  for (const candidate of urls) {
    const response = await fetchJson(candidate.url, candidate.headers);
    if (response.data !== null) {
      const protocols = unwrapArray(response.data);
      store[normalized] = { protocols, at: new Date().toISOString() };
      return protocols;
    }
  }
  return hit?.protocols ?? null;
}

function tokenKind(symbol: string, isCore: boolean): TokenLine["kind"] {
  const upper = symbol.toUpperCase();
  if (STABLE_SYMBOLS.has(upper)) return "stable";
  if (upper.endsWith(".E") && STABLE_SYMBOLS.has(upper.slice(0, -2))) return "stable";
  return isCore ? "native" : "spot";
}

/**
 * Parse `/v1/user/all_token_list` output into wallet token lines.
 * Returns null only when the response shape is unusable, so an empty wallet is still "ok".
 */
function parseTokenList(data: unknown): WalletTokenDetail | null {
  if (data === null || data === undefined) return null;
  const items = unwrapArray(data);
  const tokens: Array<TokenLine & { chain: string }> = [];
  const unpricedByChain: Record<string, number> = {};
  let unpricedCount = 0;
  for (const item of items) {
    const symbol = String(item.optimized_symbol || item.display_symbol || item.symbol || "").trim();
    if (!symbol) continue;
    const amount = number(item.amount);
    if (!amount || Math.abs(amount) < 1e-9) continue;
    const chain = String(item.chain || "unknown");
    // Protocol receipt tokens (aToken / PT / YT / LP share…) belong to the DApp section,
    // not to “钱包内稳定币 / 现货”. Skipping them keeps the two views from double-explaining.
    if (String(item.protocol_id || "").trim()) continue;
    const price = number(item.price);
    const valueUsd = number(item.usd_value) || Math.abs(amount * price);
    const isCore = item.is_core === true;
    const isVerified = item.is_verified === true || isCore;
    const isSuspicious = item.is_suspicious === true;
    // Unverified / suspicious / valueless tokens never enter the priced lists, so scam-token
    // prices cannot inflate the explanatory totals.
    if (!Number.isFinite(valueUsd) || valueUsd < TOKEN_MIN_VALUE_USD || !isVerified || isSuspicious) {
      unpricedCount += 1;
      unpricedByChain[chain] = (unpricedByChain[chain] || 0) + 1;
      continue;
    }
    tokens.push({
      symbol,
      amount,
      valueUsd: Math.abs(valueUsd),
      tokenId: String(item.id || symbol),
      kind: tokenKind(symbol, isCore),
      isCore,
      logoUrl: typeof item.logo_url === "string" && item.logo_url ? item.logo_url : undefined,
      chain,
    });
  }
  tokens.sort((left, right) => right.valueUsd - left.valueUsd);
  return { tokens, unpricedCount, unpricedByChain, coveredChains: [] };
}

/**
 * Wallet token list (stablecoins / native / spot per chain).
 * Official DeBank Pro endpoint first (one request covers every chain), then the Rabby
 * public endpoint for a bounded number of chains per wallet.
 */
async function fetchTokenListOnce(address: string, chainIds: string[]): Promise<WalletTokenDetail | null> {
  const key = process.env.DEBANK_ACCESS_KEY;
  if (key) {
    const official = await fetchJson(
      `https://pro-openapi.debank.com/v1/user/all_token_list?id=${address}&is_all=true`,
      { AccessKey: key },
      1
    );
    const parsed = parseTokenList(official.data);
    if (parsed) return { ...parsed, coveredChains: ["*"] };
  }

  // 免费替代方案：Zerion 一个请求拿到全链代币（含价格与图标）
  if (process.env.ZERION_API_KEY) {
    const zerion = await fetchZerionTokens(address);
    if (zerion) return zerion;
  }

  if (!chainIds.length) return null;
  const merged: WalletTokenDetail = {
    tokens: [],
    unpricedCount: 0,
    unpricedByChain: {},
    coveredChains: [],
  };
  let anyOk = false;
  for (const chainId of chainIds) {
    const response = await fetchJson(
      `https://api.rabby.io/v1/user/token_list?id=${address}&chain_id=${encodeURIComponent(chainId)}&is_all=true`
    );
    const parsed = parseTokenList(response.data);
    if (!parsed) continue;
    anyOk = true;
    merged.tokens.push(...parsed.tokens);
    merged.unpricedCount += parsed.unpricedCount;
    for (const [chain, count] of Object.entries(parsed.unpricedByChain)) {
      merged.unpricedByChain[chain] = (merged.unpricedByChain[chain] || 0) + count;
    }
    merged.coveredChains.push(chainId);
  }
  if (!anyOk) return null;
  merged.tokens.sort((left, right) => right.valueUsd - left.valueUsd);
  return merged;
}

async function fetchWalletTokens(
  address: string,
  chainIds: string[],
  store: TokenCache,
  force = false
): Promise<{ detail: WalletTokenDetail | null; status: WalletFetchStatus }> {
  const normalized = address.toLowerCase();
  const hit = store[normalized] || null;
  const fresh = hit ? Date.now() - new Date(hit.at).getTime() < TOKEN_TTL_MS : false;
  if (!force && hit && fresh) return { detail: hit, status: "cached" };
  const detail = await fetchTokenListOnce(normalized, chainIds);
  if (detail) {
    store[normalized] = { at: new Date().toISOString(), ...detail };
    return { detail, status: "ok" };
  }
  return hit ? { detail: hit, status: "cached" } : { detail: null, status: "error" };
}

type TokenCache = Record<string, WalletTokenCacheEntry>;

/** 需要补代币明细的地址：本地缓存过期，或从来没取过。 */
function tokenCacheStale(address: string, store: TokenCache) {
  const hit = store[address.toLowerCase()];
  if (!hit) return true;
  return Date.now() - new Date(hit.at).getTime() >= TOKEN_TTL_MS;
}

/** Chains worth a token request: the largest ones that actually hold value. */
function tokenChainsFor(address: string): string[] {
  const detail = cache.get(address.toLowerCase())?.detail;
  if (!detail) return [];
  return detail.chains
    .filter((chain) => chain.valueUsd >= TOKEN_MIN_CHAIN_USD)
    .slice(0, TOKEN_CHAINS_PER_WALLET)
    .map((chain) => chain.id);
}

export async function fetchWalletUsd(
  address: string,
  opts?: { force?: boolean }
): Promise<{ usd: number; status: WalletFetchStatus }> {
  const { detail, status } = await fetchWalletDetail(address, opts?.force);
  return { usd: detail?.totalUsd ?? 0, status };
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

export async function refreshWallets(
  wallets: Wallet[],
  tokenStore: TokenCache,
  protocolStore: ProtocolCache,
  opts: { budget?: number } = {}
): Promise<Wallet[]> {
  if (!wallets.length) return [];
  const originalOrder = new Map(wallets.map((wallet, index) => [wallet.id, index]));
  /**
   * 每轮按最久未成功优先尝试地址余额（每个地址 1 个请求，错峰 900ms）；
   * 只有真实成功才更新 lastSuccess，失败继续保留缓存和原成功时间。
   * 协议明细 / 代币明细变化慢，按各自 6 小时缓存轮换补，避免把公共接口额度一次用光。
   */
  /** Every scheduled full refresh polls every wallet once. Failed reads retain the last good value. */
  const budget = Math.max(
    1,
    Math.min(opts.budget ?? MAX_PUBLIC_REQUESTS_PER_RUN, MAX_PUBLIC_REQUESTS_PER_RUN)
  );
  const targets = [...wallets]
    .sort((left, right) => {
      const leftSuccess = new Date(left.lastSuccess?.at ?? left.lastUpdated ?? 0).getTime();
      const rightSuccess = new Date(right.lastSuccess?.at ?? right.lastUpdated ?? 0).getTime();
      if (leftSuccess !== rightSuccess) return leftSuccess - rightSuccess;
      // 同样没有成功历史时，优先上轮靠后、最可能因全局限流而没真正发出请求的地址。
      const leftAttempt = new Date(left.updatedAt ?? 0).getTime();
      const rightAttempt = new Date(right.updatedAt ?? 0).getTime();
      return rightAttempt - leftAttempt;
    })
    .slice(0, budget);
  const targetIds = new Set(targets.map((wallet) => wallet.id));
  /** 本轮补协议明细的地址（6 小时缓存），优先最久没补过的。 */
  const protocolTargets = new Set(
    [...targets]
      .filter((wallet) => {
        const hit = protocolStore[wallet.address.toLowerCase()];
        return !hit || Date.now() - new Date(hit.at).getTime() >= PROTOCOL_TTL;
      })
      .sort((left, right) => {
        const leftAt = new Date(protocolStore[left.address.toLowerCase()]?.at || 0).getTime();
        const rightAt = new Date(protocolStore[right.address.toLowerCase()]?.at || 0).getTime();
        if (leftAt !== rightAt) return leftAt - rightAt;
        return right.balanceUsd - left.balanceUsd;
      })
      .slice(0, PROTOCOL_WALLET_BUDGET)
      .map((wallet) => wallet.address.toLowerCase())
  );
  /**
   * 本轮要补代币明细的地址：优先“从来没取过”的地址（例如余额抓取失败的币安钱包，
   * 里面的 PONS / stonks 只能靠代币明细补出来），其次按余额从大到小。
   */
  const tokenTargets = new Set(
    [...targets]
      .filter((wallet) => tokenCacheStale(wallet.address, tokenStore))
      .sort((left, right) => {
        const leftCached = tokenStore[left.address.toLowerCase()] ? 1 : 0;
        const rightCached = tokenStore[right.address.toLowerCase()] ? 1 : 0;
        if (leftCached !== rightCached) return leftCached - rightCached;
        return right.balanceUsd - left.balanceUsd;
      })
      .slice(0, TOKEN_WALLET_BUDGET)
      .map((wallet) => wallet.address.toLowerCase())
  );
  const refreshed = await mapPool(targets, CONCURRENCY, async (wallet) => {
    const attemptedAt = new Date().toISOString();
    const previous = wallet.balanceUsd;
    const { usd, status } = await fetchWalletUsd(wallet.address, { force: true });
    const wantsTokenDetail = tokenTargets.has(wallet.address.toLowerCase());
    const wantsProtocolDetail = protocolTargets.has(wallet.address.toLowerCase());
    if (status === "ok") {
      if (usd >= 0.01 && wantsProtocolDetail) {
        // Same task, right after the total: avoids a second request storm and keeps
        // the total request from eating the rate limit before DApp/token detail loads.
        await fetchComplexProtocols(wallet.address, protocolStore);
        if (wantsTokenDetail) {
          await fetchWalletTokens(wallet.address, tokenChainsFor(wallet.address), tokenStore, true);
        }
      }
      const balanceUsd = Math.round(usd * 100) / 100;
      return {
        ...wallet,
        balanceUsd,
        lastUpdated: attemptedAt,
        updatedAt: attemptedAt,
        lastSuccess: { at: attemptedAt, balanceUsd },
        status: "ok" as const,
      };
    }
    if (status === "cached") {
      if (usd >= 0.01 && wantsProtocolDetail) await fetchComplexProtocols(wallet.address, protocolStore);
      // 公共 DeBank 接口失败时，代币明细仍可能从 Zerion 拿到，所以这里也尝试补一次
      if (wantsTokenDetail) {
        await fetchWalletTokens(wallet.address, tokenChainsFor(wallet.address), tokenStore, true);
      }
      return {
        ...wallet,
        balanceUsd: Math.round((usd > 0 ? usd : previous) * 100) / 100,
        updatedAt: attemptedAt,
        status: "cached" as const,
      };
    }
    // Never zero out on failure — keep the last known balance and say so.
    return {
      ...wallet,
      balanceUsd: previous,
      updatedAt: attemptedAt,
      status: previous > 0 ? ("cached" as const) : ("error" as const),
    };
  });
  // 没被选中的地址原样返回（保留上次成功的余额与状态）
  const untouched = wallets.filter((wallet) => !targetIds.has(wallet.id));
  return [...refreshed, ...untouched].sort(
    (left, right) => (originalOrder.get(left.id) ?? 0) - (originalOrder.get(right.id) ?? 0)
  );
}

function canonicalDappName(value: string) {
  const name = value.trim() || "Unknown DApp";
  if (/^aave\b/i.test(name)) return "Aave";
  if (/^pendle\b/i.test(name)) return "Pendle";
  return name.replace(/\s+(v|version)\s*\d+(?:\.\d+)?$/i, "").trim();
}

function chainName(id: string, fallback = "") {
  const names: Record<string, string> = {
    eth: "Ethereum", arb: "Arbitrum", op: "Optimism", base: "Base", bsc: "BNB Chain",
    linea: "Linea", abs: "Abstract", xlayer: "X Layer", matic: "Polygon", avax: "Avalanche",
    bera: "Berachain", scrl: "Scroll", hood: "Robinhood Chain", plasma: "Plasma", monad: "Monad",
  };
  return names[id] || fallback || id || "Unknown";
}

function tokensFromItem(item: Record<string, unknown>): DappTokenPosition[] {
  const detail = item.detail && typeof item.detail === "object" ? (item.detail as Record<string, unknown>) : {};
  const output: DappTokenPosition[] = [];
  const append = (raw: unknown, role: DappTokenPosition["role"]) => {
    if (!Array.isArray(raw)) return;
    for (const token of raw) {
      if (!token || typeof token !== "object") continue;
      const value = token as Record<string, unknown>;
      const amount = number(value.amount);
      const valueUsd = number(value.usd_value) || amount * number(value.price);
      if (Math.abs(valueUsd) < 0.01) continue;
      output.push({
        symbol: String(value.optimized_symbol || value.display_symbol || value.symbol || "TOKEN"),
        amount,
        valueUsd: Math.abs(valueUsd),
        role,
      });
    }
  };
  const supply = detail.supply_token_list;
  append(Array.isArray(supply) && supply.length ? supply : detail.token_list, "asset");
  append(detail.reward_token_list, "reward");
  const borrow = detail.borrow_token_list;
  append(Array.isArray(borrow) && borrow.length ? borrow : detail.debt_token_list, "debt");
  return output;
}

function mergeTokens(target: DappTokenPosition[], additions: DappTokenPosition[]) {
  for (const token of additions) {
    const current = target.find((item) => item.symbol === token.symbol && item.role === token.role);
    if (current) {
      current.amount += token.amount;
      current.valueUsd += token.valueUsd;
    } else {
      target.push({ ...token });
    }
  }
}

type WalletAccumulator = DappWalletShare;
type ChainAccumulator = Omit<DappChainAllocation, "wallets"> & { wallets: Map<string, WalletAccumulator> };
type DappAccumulator = Omit<DappAllocation, "chains" | "wallets"> & {
  chains: Map<string, ChainAccumulator>;
  wallets: Map<string, WalletAccumulator>;
};

function addWalletShare(
  map: Map<string, WalletAccumulator>,
  wallet: Wallet,
  assetUsd: number,
  debtUsd: number,
  netUsd: number,
  tokens: DappTokenPosition[]
) {
  const current = map.get(wallet.id) || {
    walletId: wallet.id,
    walletName: wallet.name,
    address: wallet.address,
    assetUsd: 0,
    debtUsd: 0,
    netUsd: 0,
    tokens: [],
  };
  current.assetUsd += assetUsd;
  current.debtUsd += debtUsd;
  current.netUsd += netUsd;
  mergeTokens(current.tokens, tokens);
  map.set(wallet.id, current);
}

const rounded = (value: number) => Math.round(value * 100) / 100;

export async function refreshOnchainBreakdown(
  wallets: Wallet[],
  tokenStore: TokenCache,
  protocolStore: ProtocolCache
): Promise<OnchainBreakdown> {
  const chainMap = new Map<string, {
    id: string;
    name: string;
    logoUrl?: string;
    valueUsd: number;
    wallets: Map<string, { walletId: string; walletName: string; address: string; valueUsd: number }>;
    tokens: Map<string, TokenLine>;
    unpricedCount: number;
    tokenCovered: boolean;
  }>();
  const dappMap = new Map<string, DappAccumulator>();
  const dappByChain = new Map<string, number>();
  const chainUnpriced = new Map<string, number>();
  const tokenMap = new Map<
    string,
    Omit<TokenHolding, "wallets" | "walletCount" | "amount" | "valueUsd" | "price"> & {
      amount: number;
      valueUsd: number;
      wallets: Map<string, { walletId: string; walletName: string; address: string; amount: number; valueUsd: number }>;
    }
  >();
  let successfulWallets = 0;
  let cachedWallets = 0;

  await mapPool(wallets, CONCURRENCY, async (wallet) => {
    // refreshWallets runs immediately before this and fills the cache. Avoid a second
    // network storm for addresses whose total request just failed.
    const cachedDetail = cache.get(wallet.address.toLowerCase())?.detail ?? null;
    const detail = cachedDetail;
    // 协议缓存持久化后不再依赖本次函数实例里的余额缓存；冷启动也能聚合全部钱包。
    const protocols = protocolStore[wallet.address.toLowerCase()]?.protocols ?? null;
    const tokenDetail = tokenStore[wallet.address.toLowerCase()] ?? null;
    if (wallet.status === "cached" || wallet.status === "error" || wallet.status === "stale") {
      cachedWallets += 1;
    }
    if (detail) {
      successfulWallets += 1;
      for (const chain of detail.chains) {
        const current = chainMap.get(chain.id) || {
          id: chain.id,
          name: chainName(chain.id, chain.name),
          logoUrl: chain.logoUrl,
          valueUsd: 0,
          wallets: new Map(),
          tokens: new Map(),
          unpricedCount: 0,
          tokenCovered: false,
        };
        if (!current.logoUrl && chain.logoUrl) current.logoUrl = chain.logoUrl;
        current.valueUsd += chain.valueUsd;
        const share = current.wallets.get(wallet.id) || {
          walletId: wallet.id,
          walletName: wallet.name,
          address: wallet.address,
          valueUsd: 0,
        };
        share.valueUsd += chain.valueUsd;
        current.wallets.set(wallet.id, share);
        chainMap.set(chain.id, current);
      }
    }
    if (tokenDetail) {
      for (const token of tokenDetail.tokens) {
        const chainId = token.chain;
        const current = chainMap.get(chainId) || {
          id: chainId,
          name: chainName(chainId),
          logoUrl: undefined as string | undefined,
          valueUsd: 0,
          wallets: new Map(),
          tokens: new Map(),
          unpricedCount: 0,
          tokenCovered: false,
        };
        current.tokenCovered =
          current.tokenCovered || tokenDetail.coveredChains.includes("*") || tokenDetail.coveredChains.includes(chainId);
        const key = `${token.kind}:${token.symbol.toUpperCase()}`;
        const existing = current.tokens.get(key);
        if (existing) {
          existing.amount += token.amount;
          existing.valueUsd += token.valueUsd;
        } else {
          const { chain: _chain, ...line } = token;
          void _chain;
          current.tokens.set(key, { ...line });
        }
        chainMap.set(chainId, current);

        // 跨钱包的代币聚合：同一个代币在不同钱包分别持有多少，是"多钱包综合体"的核心。
        const tokenKey = `${chainId}:${token.symbol.toUpperCase()}`;
        const holding =
          tokenMap.get(tokenKey) ||
          {
            id: tokenKey,
            symbol: token.symbol,
            chain: chainId,
            chainName: chainName(chainId),
            amount: 0,
            valueUsd: 0,
            kind: token.kind,
            logoUrl: token.logoUrl,
            wallets: new Map<string, { walletId: string; walletName: string; address: string; amount: number; valueUsd: number }>(),
          };
        holding.amount += token.amount;
        holding.valueUsd += token.valueUsd;
        if (!holding.logoUrl && token.logoUrl) holding.logoUrl = token.logoUrl;
        const walletShare = holding.wallets.get(wallet.id) || {
          walletId: wallet.id,
          walletName: wallet.name,
          address: wallet.address,
          amount: 0,
          valueUsd: 0,
        };
        walletShare.amount += token.amount;
        walletShare.valueUsd += token.valueUsd;
        holding.wallets.set(wallet.id, walletShare);
        tokenMap.set(tokenKey, holding);
      }
      for (const [chainId, count] of Object.entries(tokenDetail.unpricedByChain)) {
        chainUnpriced.set(chainId, (chainUnpriced.get(chainId) || 0) + count);
      }
      if (tokenDetail.coveredChains.includes("*")) {
        for (const entry of chainMap.values()) entry.tokenCovered = true;
      }
    }
    if (!protocols) return;

    for (const protocol of protocols) {
      const items = Array.isArray(protocol.portfolio_item_list)
        ? protocol.portfolio_item_list.filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
        : [];
      if (!items.length) continue;
      const name = canonicalDappName(String(protocol.name || protocol.id || "Unknown DApp"));
      const key = name.toLowerCase();
      const protocolChain = String(protocol.chain || "unknown");
      const current = dappMap.get(key) || {
        id: String(protocol.id || key),
        name,
        siteUrl: String(protocol.site_url || ""),
        logoUrl: typeof protocol.logo_url === "string" && protocol.logo_url ? protocol.logo_url : undefined,
        assetUsd: 0,
        debtUsd: 0,
        netUsd: 0,
        chains: new Map(),
        wallets: new Map(),
      };
      if (!current.logoUrl && typeof protocol.logo_url === "string" && protocol.logo_url) {
        current.logoUrl = protocol.logo_url;
      }
      const chain = current.chains.get(protocolChain) || {
        id: protocolChain,
        name: chainName(protocolChain),
        assetUsd: 0,
        debtUsd: 0,
        netUsd: 0,
        wallets: new Map(),
      };

      let assetUsd = 0;
      let debtUsd = 0;
      let netUsd = 0;
      const tokens: DappTokenPosition[] = [];
      for (const item of items) {
        const stats = item.stats && typeof item.stats === "object" ? (item.stats as Record<string, unknown>) : {};
        const itemAsset = number(stats.asset_usd_value);
        const itemDebt = Math.abs(number(stats.debt_usd_value));
        assetUsd += itemAsset;
        debtUsd += itemDebt;
        netUsd += stats.net_usd_value == null ? itemAsset - itemDebt : number(stats.net_usd_value);
        mergeTokens(tokens, tokensFromItem(item));
      }
      if (Math.abs(netUsd) < 0.01 && assetUsd < 0.01 && debtUsd < 0.01) continue;

      current.assetUsd += assetUsd;
      current.debtUsd += debtUsd;
      current.netUsd += netUsd;
      chain.assetUsd += assetUsd;
      chain.debtUsd += debtUsd;
      chain.netUsd += netUsd;
      addWalletShare(current.wallets, wallet, assetUsd, debtUsd, netUsd, tokens);
      addWalletShare(chain.wallets, wallet, assetUsd, debtUsd, netUsd, tokens);
      current.chains.set(protocolChain, chain);
      dappMap.set(key, current);
      dappByChain.set(protocolChain, (dappByChain.get(protocolChain) || 0) + netUsd);
    }
  });

  const chains: ChainAllocation[] = [...chainMap.values()]
    .map((chain) => {
      const dappUsd = dappByChain.get(chain.id) || 0;
      const walletsForChain = [...chain.wallets.values()]
        .map((wallet) => ({ ...wallet, valueUsd: rounded(wallet.valueUsd) }))
        .sort((left, right) => right.valueUsd - left.valueUsd);
      const allTokens = [...chain.tokens.values()].sort((left, right) => right.valueUsd - left.valueUsd);
      const stablecoins = allTokens
        .filter((token) => token.kind === "stable")
        .slice(0, TOKENS_PER_GROUP)
        .map((token) => ({ ...token, amount: rounded(token.amount), valueUsd: rounded(token.valueUsd) }));
      const spot = allTokens
        .filter((token) => token.kind !== "stable")
        .slice(0, TOKENS_PER_GROUP)
        .map((token) => ({ ...token, amount: rounded(token.amount), valueUsd: rounded(token.valueUsd) }));
      const stableUsd = rounded(
        allTokens.filter((token) => token.kind === "stable").reduce((sum, token) => sum + token.valueUsd, 0)
      );
      const nativeUsd = rounded(
        allTokens.filter((token) => token.kind === "native").reduce((sum, token) => sum + token.valueUsd, 0)
      );
      const spotUsd = rounded(
        allTokens.filter((token) => token.kind !== "stable").reduce((sum, token) => sum + token.valueUsd, 0)
      );
      return {
        id: chain.id,
        name: chain.name,
        logoUrl: chain.logoUrl,
        valueUsd: rounded(chain.valueUsd),
        walletUsd: rounded(chain.valueUsd - dappUsd),
        dappUsd: rounded(dappUsd),
        walletCount: walletsForChain.length,
        wallets: walletsForChain,
        stablecoins,
        spot,
        stableUsd,
        spotUsd,
        nativeUsd,
        unpricedCount: chainUnpriced.get(chain.id) || chain.unpricedCount || 0,
        tokenDetailAvailable: chain.tokenCovered,
      };
    })
    .sort((left, right) => right.valueUsd - left.valueUsd);

  const finalizeWallet = (wallet: WalletAccumulator): DappWalletShare => ({
    ...wallet,
    assetUsd: rounded(wallet.assetUsd),
    debtUsd: rounded(wallet.debtUsd),
    netUsd: rounded(wallet.netUsd),
    tokens: wallet.tokens
      .map((token) => ({ ...token, amount: rounded(token.amount), valueUsd: rounded(token.valueUsd) }))
      .sort((left, right) => right.valueUsd - left.valueUsd)
      .slice(0, 12),
  });

  const dapps: DappAllocation[] = [...dappMap.values()]
    .map((dapp) => ({
      id: dapp.id,
      name: dapp.name,
      siteUrl: dapp.siteUrl,
      logoUrl: dapp.logoUrl,
      assetUsd: rounded(dapp.assetUsd),
      debtUsd: rounded(dapp.debtUsd),
      netUsd: rounded(dapp.netUsd),
      wallets: [...dapp.wallets.values()].map(finalizeWallet).sort((left, right) => right.netUsd - left.netUsd),
      chains: [...dapp.chains.values()]
        .map((chain): DappChainAllocation => ({
          id: chain.id,
          name: chain.name,
          assetUsd: rounded(chain.assetUsd),
          debtUsd: rounded(chain.debtUsd),
          netUsd: rounded(chain.netUsd),
          wallets: [...chain.wallets.values()].map(finalizeWallet).sort((left, right) => right.netUsd - left.netUsd),
        }))
        .sort((left, right) => right.netUsd - left.netUsd),
    }))
    .sort((left, right) => right.netUsd - left.netUsd);

  const tokens: TokenHolding[] = [...tokenMap.values()]
    .map((holding) => ({
      id: holding.id,
      symbol: holding.symbol,
      chain: holding.chain,
      chainName: holding.chainName,
      amount: rounded(holding.amount),
      price: holding.amount > 0 ? holding.valueUsd / holding.amount : 0,
      valueUsd: rounded(holding.valueUsd),
      kind: holding.kind,
      logoUrl: holding.logoUrl,
      walletCount: holding.wallets.size,
      wallets: [...holding.wallets.values()]
        .map((share) => ({
          ...share,
          amount: rounded(share.amount),
          valueUsd: rounded(share.valueUsd),
        }))
        .sort((left, right) => right.valueUsd - left.valueUsd),
    }))
    .filter((holding) => holding.valueUsd >= 0.01)
    .sort((left, right) => right.valueUsd - left.valueUsd);

  return {
    generatedAt: new Date().toISOString(),
    walletCount: wallets.length,
    successfulWallets,
    chains,
    dapps,
    tokens,
    tokensTotalUsd: rounded(tokens.reduce((sum, token) => sum + token.valueUsd, 0)),
    tokenSource: activeTokenSource(),
    cachedWallets,
    partial: cachedWallets > 0,
    rateLimitedUntil: publicBlocked() ? new Date(publicBlockedUntil).toISOString() : null,
  };
}
