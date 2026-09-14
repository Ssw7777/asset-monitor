import type { TokenLine } from "../types";

export type TokenSource = "debank" | "zerion" | "rabby-public" | "none";

export interface ProviderToken extends TokenLine {
  chain: string;
}

export interface ProviderResult {
  tokens: ProviderToken[];
  unpricedCount: number;
  unpricedByChain: Record<string, number>;
  coveredChains: string[];
}

const STABLE_SYMBOLS = new Set([
  "USDT", "USDC", "USDG", "USDE", "USD1", "USDT0", "USD0", "DAI", "FDUSD", "TUSD",
  "BUSD", "USDD", "PYUSD", "GHO", "USDS", "SUSDE", "SUSDS", "FRAX", "LUSD", "USDX",
  "USDP", "USDR", "USDF", "USDY", "SUSD", "CRVUSD",
]);

const MIN_VALUE_USD = 0.01;

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function tokenKind(symbol: string, isCore: boolean): TokenLine["kind"] {
  const upper = symbol.toUpperCase();
  if (STABLE_SYMBOLS.has(upper)) return "stable";
  if (upper.endsWith(".E") && STABLE_SYMBOLS.has(upper.slice(0, -2))) return "stable";
  return isCore ? "native" : "spot";
}

/**
 * 各家数据源的链 id 不统一（ethereum / eth / eth-mainnet …）。
 * 统一映射到本项目的 DeBank 链 id，避免同一个链被拆成两张卡片。
 */
const CHAIN_ALIASES: Record<string, string> = {
  ethereum: "eth",
  mainnet: "eth",
  "eth-mainnet": "eth",
  eth: "eth",
  "binance-smart-chain": "bsc",
  "bsc-mainnet": "bsc",
  bnb: "bsc",
  bsc: "bsc",
  polygon: "matic",
  "polygon-mainnet": "matic",
  matic: "matic",
  arbitrum: "arb",
  "arbitrum-mainnet": "arb",
  arb: "arb",
  "optimism-mainnet": "op",
  optimism: "op",
  op: "op",
  "base-mainnet": "base",
  base: "base",
  "avalanche-mainnet": "avax",
  avalanche: "avax",
  avax: "avax",
  "zksync-era": "era",
  "zksync": "era",
  era: "era",
  scroll: "scrl",
  scrl: "scrl",
  linea: "linea",
  abstract: "abs",
  abs: "abs",
  "x-layer": "xlayer",
  xlayer: "xlayer",
  okbc: "xlayer",
  okbchain: "xlayer",
  "okex-chain": "xlayer",
  "x-layer-mainnet": "xlayer",
  blast: "blast",
  celo: "celo",
  gnosis: "xdai",
  "gnosis-chain": "xdai",
  gnosischain: "xdai",
  xdai: "xdai",
  mantle: "mnt",
  mnt: "mnt",
  berachain: "bera",
  bera: "bera",
  ronin: "ron",
  ron: "ron",
  ink: "ink",
  zora: "zora",
  mode: "mode",
  taiko: "taiko",
  world: "world",
  "world-chain": "world",
  unichain: "uni",
  uni: "uni",
  monad: "monad",
  megaeth: "megaeth",
  apechain: "ape",
  ape: "ape",
  rootstock: "rsk",
  rsk: "rsk",
  opbnb: "opbnb",
  core: "core",
  merlin: "merlin",
  gravity: "gravity",
  plume: "plume",
  hyperevm: "hyper",
  hyper: "hyper",
  sonic: "sonic",
  fraxtal: "frax",
  "robinhood-chain": "hood",
  robinhood: "hood",
  hood: "hood",
  katana: "katana",
  bob: "bob",
  plasma: "plasma",
  stable: "stable",
  sei: "sei",
  kava: "kava",
  "kava-mainnet": "kava",
  kaia: "klay",
  klaytn: "klay",
  klay: "klay",
  manta: "manta",
  metis: "metis",
  flare: "flr",
  flr: "flr",
  fuse: "fuse",
  bittorrent: "btt",
  "cronos-mainnet": "cro",
  cronos: "cro",
  cro: "cro",
  solana: "solana",
};

export function normalizeChainId(raw: string): string {
  const key = String(raw || "").trim().toLowerCase();
  if (!key) return "unknown";
  return CHAIN_ALIASES[key] || key;
}

/** 当前生效的代币数据源（在环境变量里按优先级选择）。 */
export function activeTokenSource(): TokenSource {
  if (process.env.DEBANK_ACCESS_KEY) return "debank";
  if (process.env.ZERION_API_KEY) return "zerion";
  return "rabby-public";
}

function collect(rows: Array<Omit<ProviderToken, "kind" | "isCore"> & { isCore?: boolean }>) {
  const tokens: ProviderToken[] = [];
  const unpricedByChain: Record<string, number> = {};
  let unpricedCount = 0;
  for (const row of rows) {
    const symbol = String(row.symbol || "").trim();
    if (!symbol) continue;
    const amount = number(row.amount);
    if (!amount || Math.abs(amount) < 1e-9) continue;
    const valueUsd = Math.abs(number(row.valueUsd));
    if (valueUsd < MIN_VALUE_USD) {
      unpricedCount += 1;
      unpricedByChain[row.chain] = (unpricedByChain[row.chain] || 0) + 1;
      continue;
    }
    tokens.push({
      symbol,
      amount,
      valueUsd,
      tokenId: String(row.tokenId || symbol),
      kind: tokenKind(symbol, row.isCore === true),
      isCore: row.isCore === true,
      logoUrl: row.logoUrl,
      chain: row.chain,
    });
  }
  tokens.sort((left, right) => right.valueUsd - left.valueUsd);
  return { tokens, unpricedCount, unpricedByChain, coveredChains: [] as string[] };
}

/**
 * Zerion 免费版：一个请求就能拿到该地址在所有链上的代币仓位，含价格与图标。
 * 官方文档：https://developers.zerion.io — 用 Basic 认证，key 作为用户名。
 */
export async function fetchZerionTokens(
  address: string,
  opts: { deadlineMs?: number } = {}
): Promise<ProviderResult | null> {
  const key = process.env.ZERION_API_KEY;
  if (!key) return null;
  const remainingMs = opts.deadlineMs == null ? 20_000 : opts.deadlineMs - Date.now();
  if (remainingMs < 750) return null;
  try {
    const response = await fetch(
      `https://api.zerion.io/v1/wallets/${address}/positions/?currency=usd&filter[positions]=only_simple&page[size]=100`,
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
        id?: string;
        attributes?: {
          quantity?: { float?: number };
          value?: number;
          price?: number;
          fungible_info?: { symbol?: string; name?: string; icon?: { url?: string } };
        };
        relationships?: { chain?: { data?: { id?: string } } };
      }>;
    };
    if (!Array.isArray(body.data)) return null;
    const rows = body.data
      .map((item) => {
        const attributes = item.attributes || {};
        const symbol = String(attributes.fungible_info?.symbol || "");
        const amount = number(attributes.quantity?.float);
        const price = number(attributes.price);
        const valueUsd = number(attributes.value) || Math.abs(amount * price);
        return {
          symbol,
          amount,
          valueUsd,
          tokenId: String(item.id || symbol),
          logoUrl: attributes.fungible_info?.icon?.url,
          chain: normalizeChainId(String(item.relationships?.chain?.data?.id || "unknown")),
        };
      })
      .filter((row) => row.symbol);
    const result = collect(rows);
    result.coveredChains = ["*"];
    return result;
  } catch {
    return null;
  }
}
