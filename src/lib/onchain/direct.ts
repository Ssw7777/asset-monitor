import { fetchZerionTokens, normalizeChainId } from "./token-providers";
import { nextZerionKey } from "./zerion-keys";

/**
 * 直连数据源层：不经 Rabby/DeBank 公共接口，直接向官方基础设施查询钱包余额。
 *
 * - Alchemy（鉴权 Key）：eth / arb / base / op / bsc / matic / linea 七条链，
 *   alchemy_getTokenBalances + eth_getBalance 一次批量请求拿全部代币与原生币。
 * - Zerion（4 Key 轮转）：Abstract 及其他长尾链（hood / xlayer 等）的仓位，
 *   自带 USD 估值；同时为 Alchemy 层提供"同币种隐含价格"交叉源。
 * - DeFi 协议净值不在这层：由上层协议缓存叠加（Rabby 6 小时轮换）。
 *
 * 价格阶梯：稳定币 = $1 → 原生币（币安公开 ticker）→ Zerion 隐含价
 * → CoinGecko 合约价 → 无价（不计入总额，计入 unpricedCount，如实展示）。
 */

interface AlchemyChainSpec {
  net: string;
  nativeSymbol: string;
  binanceTicker: string;
  coingeckoPlatform: string;
}

/** DeBank 风格链 id → Alchemy 网络。这七条链 Alchemy 免费档实测可用（含 Linea）。 */
const ALCHEMY_CHAINS: Record<string, AlchemyChainSpec> = {
  eth: { net: "eth-mainnet", nativeSymbol: "ETH", binanceTicker: "ETHUSDT", coingeckoPlatform: "ethereum" },
  arb: { net: "arb-mainnet", nativeSymbol: "ETH", binanceTicker: "ETHUSDT", coingeckoPlatform: "arbitrum-one" },
  base: { net: "base-mainnet", nativeSymbol: "ETH", binanceTicker: "ETHUSDT", coingeckoPlatform: "base" },
  op: { net: "opt-mainnet", nativeSymbol: "ETH", binanceTicker: "ETHUSDT", coingeckoPlatform: "optimistic-ethereum" },
  bsc: { net: "bnb-mainnet", nativeSymbol: "BNB", binanceTicker: "BNBUSDT", coingeckoPlatform: "binance-smart-chain" },
  matic: { net: "polygon-mainnet", nativeSymbol: "POL", binanceTicker: "POLUSDT", coingeckoPlatform: "polygon-pos" },
  linea: { net: "linea-mainnet", nativeSymbol: "ETH", binanceTicker: "ETHUSDT", coingeckoPlatform: "linea" },
  hood: { net: "robinhood-mainnet", nativeSymbol: "ETH", binanceTicker: "ETHUSDT", coingeckoPlatform: "robinhood-chain" },
  abs: { net: "abstract-mainnet", nativeSymbol: "ETH", binanceTicker: "ETHUSDT", coingeckoPlatform: "abstract" },
};

/** 钱包已知链全部查询（不再截断）：Alchemy 免费额度足够 25 钱包 × 全链。 */

const STABLES = new Set([
  "USDT", "USDC", "USDG", "USDE", "USD1", "USDT0", "USD0", "DAI", "FDUSD", "TUSD",
  "BUSD", "USDD", "PYUSD", "GHO", "USDS", "SUSDE", "SUSDS", "FRAX", "LUSD", "USDX",
  "USDP", "USDR", "USDF", "USDY", "USD+", "SUSD", "CRVUSD", "USDT.E", "USDC.E",
]);

const CHAIN_NAMES: Record<string, string> = {
  eth: "Ethereum", arb: "Arbitrum", op: "Optimism", base: "Base", bsc: "BNB Chain",
  linea: "Linea", abs: "Abstract", xlayer: "X Layer", matic: "Polygon", hood: "Robinhood Chain",
};

export interface DirectDetail {
  /** 代币 + 原生币总值（不含 DeFi 协议净值），已含 Zerion 长尾链。
   *  null 表示本轮所有数据源都没读到（保留旧值，不算成功）。 */
  tokenUsd: number;
  chains: Array<{ id: string; name: string; valueUsd: number }>;
  unpricedCount: number;
}

/** 已知链里是否有 Alchemy 覆盖不到的链（xlayer 等长尾）→ 需要花 Zerion 额度。 */
export function hasLongTailChains(chainIds: string[]): boolean {
  return chainIds.some((id) => !ALCHEMY_CHAINS[id]);
}

export interface ZerionDefiPosition {
  name: string;
  chain: string;
  valueUsd: number;
}

const dappNameCache = new Map<string, string>();

/** Zerion dapp id → 人类可读名称（实例级缓存，冷启动最多重建一次）。 */
async function resolveDappName(dappId: string): Promise<string> {
  const hit = dappNameCache.get(dappId);
  if (hit) return hit;
  try {
    const key = nextZerionKey();
    if (!key) return dappId;
    const response = await fetch(`https://api.zerion.io/v1/dapps/${dappId}`, {
      headers: { Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return dappId;
    const body = (await response.json()) as { data?: { attributes?: { name?: string } } };
    const name = String(body.data?.attributes?.name || dappId);
    dappNameCache.set(dappId, name);
    return name;
  } catch {
    return dappId;
  }
}

/**
 * Zerion DeFi 仓位（no_filter 全集减去钱包代币）。
 * 只计入语义明确的资产类仓位：deposit / staked / reward / claimable。
 * loan（借贷）、investment 不并入总额：实测某个钱包曾出现 3.5 万的 loan 仓位
 * 几小时内消失，perps/借贷的 notion 语义不稳定，掺进总额会重演「79U 变 1.1 万」。
 */
export async function fetchZerionDefi(
  address: string,
  opts: { deadlineMs?: number } = {}
): Promise<{ netUsd: number; positions: ZerionDefiPosition[] } | null> {
  const key = nextZerionKey();
  if (!key) return null;
  const COUNTED = new Set(["deposit", "staked", "reward", "claimable", "locker"]);
  const remainingMs = opts.deadlineMs == null ? 20_000 : opts.deadlineMs - Date.now();
  if (remainingMs < 2_000) return null;
  try {
    const response = await fetch(
      `https://api.zerion.io/v1/wallets/${address}/positions/?currency=usd&filter[positions]=no_filter&page[size]=100`,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`,
          Accept: "application/json",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(Math.min(20_000, remainingMs)),
      }
    );
    if (!response.ok) return null;
    const body = (await response.json()) as {
      data?: Array<{
        attributes?: { position_type?: string; value?: unknown; fungible_info?: { symbol?: string } };
        relationships?: { chain?: { data?: { id?: string } }; dapp?: { data?: { id?: string } } };
      }>;
    };
    if (!Array.isArray(body.data)) return null;

    const dappIds = new Set<string>();
    const raw: Array<{ type: string; symbol: string; chain: string; dappId: string; valueUsd: number }> = [];
    for (const item of body.data) {
      const type = String(item.attributes?.position_type || "");
      if (type === "wallet" || !COUNTED.has(type)) continue;
      const valueUsd = number(item.attributes?.value);
      if (valueUsd <= 0.005) continue;
      const chain = normalizeChainId(String(item.relationships?.chain?.data?.id || "unknown"));
      const dappId = String(item.relationships?.dapp?.data?.id || "");
      if (dappId) dappIds.add(dappId);
      raw.push({
        type,
        symbol: String(item.attributes?.fungible_info?.symbol || ""),
        chain,
        dappId,
        valueUsd,
      });
    }
    if (!raw.length) return { netUsd: 0, positions: [] };

    const names = new Map<string, string>();
    for (const dappId of dappIds) {
      names.set(dappId, await resolveDappName(dappId));
    }
    const positions: ZerionDefiPosition[] = [];
    let netUsd = 0;
    for (const entry of raw) {
      netUsd += entry.valueUsd;
      const base = names.get(entry.dappId) || (entry.type === "deposit" && entry.symbol ? `${entry.symbol} 存款` : entry.dappId || entry.type);
      positions.push({ name: base, chain: entry.chain, valueUsd: Math.round(entry.valueUsd * 100) / 100 });
    }
    return { netUsd: Math.round(netUsd * 100) / 100, positions };
  } catch {
    return null;
  }
}

const number = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const chainName = (id: string) => CHAIN_NAMES[id] || id;

/** 模块级缓存：Serverless 实例存活期间复用，冷启动最多重建一次。 */
const metadataCache = new Map<string, { symbol: string; decimals: number }>();
const tickerCache = new Map<string, { at: number; usd: number }>();
const contractPriceCache = new Map<string, { at: number; usd: number }>();
const PRICE_TTL_MS = 10 * 60 * 1000;
/** 长尾链（Zerion）结果缓存 1 小时：25 钱包轮换 ≈ 300 次/天，落在 4 把 Key 池内。 */
const LONGTAIL_TTL_MS = 60 * 60 * 1000;

async function alchemyRpc(net: string, calls: Array<{ method: string; params: unknown[] }>) {
  const key = process.env.ALCHEMY_API_KEY;
  if (!key) return null;
  try {
    const response = await fetch(`https://${net}.g.alchemy.com/v2/${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(calls.map((call, index) => ({ jsonrpc: "2.0", id: index + 1, ...call }))),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as Array<{ id: number; result?: unknown }>;
    const byId = new Map(body.map((entry) => [entry.id, entry.result]));
    return calls.map((_, index) => byId.get(index + 1) ?? null);
  } catch {
    return null;
  }
}

/** 批量元数据：一次 JSON-RPC 批请求拿全部未知代币的符号与精度，命中缓存的不再请求。 */
async function tokenMetadataBatch(net: string, contracts: string[]) {
  const unknown = contracts.filter((contract) => !metadataCache.has(`${net}:${contract.toLowerCase()}`));
  if (!unknown.length) return;
  const result = await alchemyRpc(
    net,
    unknown.slice(0, 90).map((contract) => ({ method: "alchemy_getTokenMetadata", params: [contract] }))
  );
  if (!result) return;
  unknown.slice(0, 90).forEach((contract, index) => {
    const meta = result[index] as { symbol?: string; decimals?: number } | null;
    if (meta && Number.isFinite(Number(meta.decimals))) {
      metadataCache.set(`${net}:${contract.toLowerCase()}`, {
        symbol: String(meta.symbol || ""),
        decimals: Number(meta.decimals),
      });
    }
  });
}

/** 币安公开 ticker：不需要 Key，价格权威且实时；失败沿用上次缓存。 */
async function tickerPrice(ticker: string): Promise<number | null> {
  const hit = tickerCache.get(ticker);
  if (hit && Date.now() - hit.at < PRICE_TTL_MS) return hit.usd;
  try {
    const response = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${ticker}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return hit?.usd ?? null;
    const body = (await response.json()) as { price?: string };
    const usd = number(body.price);
    if (usd <= 0) return hit?.usd ?? null;
    tickerCache.set(ticker, { at: Date.now(), usd });
    return usd;
  } catch {
    return hit?.usd ?? null;
  }
}

/** CoinGecko 合约价（按平台批量，单平台最多 40 个）。失败返回空映射，不阻塞余额。 */
async function coingeckoContractPrices(
  platform: string,
  contracts: string[]
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!contracts.length) return out;
  try {
    const response = await fetch(
      `https://api.coingecko.com/api/v3/simple/token_price/${platform}?contract_addresses=${contracts.join(",")}&vs_currencies=usd`,
      { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(10_000) }
    );
    if (!response.ok) return out;
    const body = (await response.json()) as Record<string, { usd?: number }>;
    for (const [contract, price] of Object.entries(body)) {
      const usd = number(price?.usd);
      if (usd > 0) out.set(contract.toLowerCase(), usd);
    }
  } catch {
    /* 价格缺失时该代币计入 unpriced */
  }
  return out;
}

function hexToAmount(hex: unknown, decimals: number): number {
  if (typeof hex !== "string" || !hex.startsWith("0x")) return 0;
  try {
    return Number(BigInt(hex)) / 10 ** decimals;
  } catch {
    return 0;
  }
}

function isStable(symbol: string) {
  const upper = symbol.toUpperCase();
  return STABLES.has(upper) || (upper.endsWith(".E") && STABLES.has(upper.slice(0, -2)));
}

/**
 * 直连读取一个钱包：Alchemy 链（原生 + 全代币，已知链全部查询）+ Zerion（长尾链与未发现链）。
 * `longtail` 为上一轮缓存的 Zerion 长尾结果（1 小时 TTL，由调用方轮换刷新）；
 * Zerion 本轮若被调用，未查询链上的代币直接并入总额（链发现自愈），已查询链仅用于隐含价格。
 */
export async function fetchDirectDetail(
  address: string,
  opts: {
    knownChains: string[];
    longtail?: { at: string; chains: Array<{ id: string; name: string; valueUsd: number }> } | null;
    allowZerion: boolean;
    deadlineMs?: number;
  }
): Promise<(DirectDetail & { longtailFetched?: Array<{ id: string; name: string; valueUsd: number }> }) | null> {
  const hasAlchemy = !!process.env.ALCHEMY_API_KEY;
  if (!hasAlchemy && !opts.allowZerion) return null;

  const queriedChains = new Set(opts.knownChains.filter((id) => ALCHEMY_CHAINS[id]));

  // ── Zerion 层：长尾链 + 链发现（未查询链上的代币直接并入）──────────
  let longtailFetched: Array<{ id: string; name: string; valueUsd: number }> | undefined;
  const longtailChains = new Map<string, number>();
  const impliedPrices = new Map<string, number>();
  const cached = opts.longtail;
  const cachedFresh = !!cached && Date.now() - new Date(cached.at).getTime() < LONGTAIL_TTL_MS;
  if (cachedFresh && cached) {
    for (const chain of cached.chains) longtailChains.set(chain.id, chain.valueUsd);
  } else if (opts.allowZerion) {
    const zerionResult = await fetchZerionTokens(address, { deadlineMs: opts.deadlineMs });
    if (zerionResult) {
      for (const token of zerionResult.tokens) {
        if (token.amount > 0) {
          impliedPrices.set(`${token.chain}:${token.symbol.toUpperCase()}`, token.valueUsd / token.amount);
        }
        if (queriedChains.has(token.chain)) continue; // 已查询链：仅用于隐含价格，避免双计
        // 未查询链（长尾或新发现）：直接并入
        longtailChains.set(token.chain, (longtailChains.get(token.chain) || 0) + token.valueUsd);
      }
      longtailFetched = [...longtailChains.entries()]
        .filter(([, valueUsd]) => valueUsd >= 0.01)
        .map(([id, valueUsd]) => ({ id, name: chainName(id), valueUsd: Math.round(valueUsd * 100) / 100 }));
    }
  }

  // ── Alchemy 层：原生 + 全部代币（余额 + 元数据），已知链全部查询 ────
  interface PendingToken {
    chain: string;
    net: string;
    platform: string;
    contract: string;
    symbol: string;
    amount: number;
  }
  const pending: PendingToken[] = [];
  const chainsToQuery = [...queriedChains];
  for (const chainId of chainsToQuery) {
    if (opts.deadlineMs != null && Date.now() >= opts.deadlineMs - 3000) break;
    const spec = ALCHEMY_CHAINS[chainId];
    const batch = await alchemyRpc(spec.net, [
      { method: "alchemy_getTokenBalances", params: [address] },
      { method: "eth_getBalance", params: [address, "latest"] },
    ]);
    if (!batch) continue;
    const tokenList =
      (batch[0] as { tokenBalances?: Array<{ contractAddress?: string; tokenBalance?: string }> } | null)
        ?.tokenBalances ?? [];
    const live = tokenList.filter(
      (item) =>
        item.contractAddress &&
        typeof item.tokenBalance === "string" &&
        item.tokenBalance.startsWith("0x") &&
        !/^0x0+$/.test(item.tokenBalance)
    );
    await tokenMetadataBatch(
      spec.net,
      live.map((item) => item.contractAddress as string)
    );
    for (const item of live) {
      const contract = item.contractAddress as string;
      const meta = metadataCache.get(`${spec.net}:${contract.toLowerCase()}`);
      if (!meta || !meta.symbol) continue;
      const amount = hexToAmount(item.tokenBalance, meta.decimals);
      if (amount > 0) {
        pending.push({
          chain: chainId, net: spec.net, platform: spec.coingeckoPlatform,
          contract, symbol: meta.symbol, amount,
        });
      }
    }
    const nativeAmount = hexToAmount(batch[1], 18);
    if (nativeAmount > 1e-8) {
      pending.push({
        chain: chainId, net: spec.net, platform: spec.coingeckoPlatform,
        contract: "", symbol: spec.nativeSymbol, amount: nativeAmount,
      });
    }
  }

  if (!pending.length && !longtailChains.size) return null;

  // ── 定价：稳定币 $1 → 原生币（币安）→ Zerion 隐含价 → CoinGecko ────
  const needCoingecko = new Map<string, Set<string>>();
  for (const token of pending) {
    if (isStable(token.symbol) || token.contract === "") continue;
    const key = `${token.net}:${token.contract.toLowerCase()}`;
    const cached = contractPriceCache.get(key);
    if (cached && Date.now() - cached.at < PRICE_TTL_MS) continue;
    if (impliedPrices.get(`${token.chain}:${token.symbol.toUpperCase()}`) != null) continue;
    if (!needCoingecko.has(token.platform)) needCoingecko.set(token.platform, new Set());
    needCoingecko.get(token.platform)!.add(token.contract);
  }

  const nativeUsd = new Map<string, number | null>();
  for (const ticker of ["ETHUSDT", "BNBUSDT", "POLUSDT"]) {
    nativeUsd.set(ticker, await tickerPrice(ticker));
  }

  const cgPrices = new Map<string, number>();
  for (const [platform, contracts] of needCoingecko) {
    const prices = await coingeckoContractPrices(platform, [...contracts].slice(0, 40));
    for (const [contract, usd] of prices) {
      cgPrices.set(`${platform}:${contract}`, usd);
      const net = Object.values(ALCHEMY_CHAINS).find((spec) => spec.coingeckoPlatform === platform)?.net;
      if (net) contractPriceCache.set(`${net}:${contract}`, { at: Date.now(), usd });
    }
  }

  const priceOf = (token: PendingToken): number | null => {
    const upper = token.symbol.toUpperCase();
    if (isStable(token.symbol)) return 1;
    const ticker = ALCHEMY_CHAINS[token.chain]?.binanceTicker;
    if (token.contract === "" || upper === "WETH" || upper === "WBNB") {
      return (ticker != null ? nativeUsd.get(ticker) : null) ?? null;
    }
    const implied = impliedPrices.get(`${token.chain}:${upper}`);
    if (implied != null && implied > 0) return implied;
    const cached = contractPriceCache.get(`${token.net}:${token.contract.toLowerCase()}`);
    if (cached && Date.now() - cached.at < PRICE_TTL_MS) return cached.usd;
    return cgPrices.get(`${token.platform}:${token.contract.toLowerCase()}`) ?? null;
  };

  let tokenUsd = 0;
  const chainValues = new Map<string, number>(longtailChains);
  let unpricedCount = 0;
  for (const token of pending) {
    const price = priceOf(token);
    if (price == null || price <= 0) {
      unpricedCount += 1;
      continue;
    }
    const value = token.amount * price;
    if (value < 0.01) continue;
    tokenUsd += value;
    chainValues.set(token.chain, (chainValues.get(token.chain) || 0) + value);
  }

  const total = tokenUsd + [...longtailChains.values()].reduce((sum, v) => sum + v, 0);
  const chains = [...chainValues.entries()]
    .map(([id, valueUsd]) => ({ id, name: chainName(id), valueUsd }))
    .filter((chain) => chain.valueUsd >= 0.01)
    .sort((left, right) => right.valueUsd - left.valueUsd);

  return {
    tokenUsd: Math.round(total * 100) / 100,
    chains,
    unpricedCount,
    longtailFetched,
  };
}
