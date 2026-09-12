export type ChainType = "EVM" | "ABSTRACT";

export type TokenKind = "stable" | "native" | "spot";

/** A single on-chain token line shown under a chain (stablecoin / native / spot). */
export interface TokenLine {
  symbol: string;
  amount: number;
  valueUsd: number;
  /** DeBank token id, e.g. `eth` or `0x…` */
  tokenId: string;
  kind: TokenKind;
  isCore: boolean;
  /** 代币图标（DeBank CDN），拿不到时前端回退为字母图标 */
  logoUrl?: string;
}

export interface TokenWalletShare {
  walletId: string;
  walletName: string;
  address: string;
  amount: number;
  valueUsd: number;
}

/** 跨钱包聚合后的代币行：DeBank 钱包页那种“代币 / 价格 / 数量 / 价值”表格的数据源。 */
export interface TokenHolding {
  id: string;
  symbol: string;
  chain: string;
  chainName: string;
  amount: number;
  price: number;
  valueUsd: number;
  kind: TokenKind;
  logoUrl?: string;
  walletCount: number;
  wallets: TokenWalletShare[];
}

export interface ManualAsset {
  id: string;
  name: string;
  amountUsd: number;
  updatedAt: string;
}

export interface Wallet {
  id: string;
  name: string;
  address: string;
  chain: ChainType;
  balanceUsd: number;
  lastUpdated: string | null;
  /** ok = live; cached = kept last good / TTL; error = refresh failed; baseline = seed only (pre-refresh) */
  status: "ok" | "cached" | "stale" | "error" | "baseline";
  /** Audit fields — optional so existing persisted wallets keep working. */
  createdAt?: string | null;
  updatedAt?: string | null;
  /** Last successful refresh: timestamp + balance at that moment. */
  lastSuccess?: { at: string; balanceUsd: number } | null;
}

export interface ExchangeBalance {
  exchange: "okx" | "binance" | "gate";
  balanceUsd: number;
  lastUpdated: string | null;
  status: "ok" | "missing_keys" | "missing_passphrase" | "error" | "baseline";
  error?: string;
}

export interface SnapshotPoint {
  ts: string;
  totalUsd: number;
  onchain?: number;
  cex?: number;
  manual?: number;
  exchanges?: Record<string, number>;
  wallets?: Record<string, number>;
  /** 手动资产按条目名称记录，便于解释变化来源。 */
  manualItems?: Record<string, number>;
  /** DApp/协议净值快照，仅用于解释变化来源，绝不累加进总额。 */
  dapps?: Record<string, number>;
  /** 本轮是否有地址沿用上次成功数据（部分成功）。 */
  partial?: boolean;
  /** true 表示这是首次部署写入的演示基线快照，等待真实刷新数据替换。 */
  seeded?: boolean;
}

export type FlowDirection = "in" | "out" | "transfer";
export type FlowEntityType = "wallet" | "exchange" | "manual";

/** A durable balance-change alert captured when a snapshot is written. */
export interface FlowEvent {
  id: string;
  ts: string;
  direction: FlowDirection;
  amountUsd: number;
  before: number;
  after: number;
  changePct: number | null;
  entityType: FlowEntityType;
  entityKey: string;
  entityLabel: string;
  entityAddress: string | null;
  from: string;
  to: string;
  matched: boolean;
  counterparty: string | null;
  status: "live" | "cached" | "partial";
}

export interface ChainWalletShare {
  walletId: string;
  walletName: string;
  address: string;
  valueUsd: number;
}

export interface ChainAllocation {
  id: string;
  name: string;
  /** DeBank 链图标，链卡片与筛选条直接用官方图标 */
  logoUrl?: string;
  valueUsd: number;
  walletUsd: number;
  dappUsd: number;
  walletCount: number;
  wallets: ChainWalletShare[];
  /** 钱包内未进入协议的稳定币（USDT/USDC/USDG/USDe/USD1…） */
  stablecoins?: TokenLine[];
  /** 钱包内主链币与非稳定币现货 */
  spot?: TokenLine[];
  stableUsd?: number;
  spotUsd?: number;
  nativeUsd?: number;
  /** 估值为 0 或无法识别的代币数量，不计入总额 */
  unpricedCount?: number;
  /** 该链是否真正取到了代币明细（无 AccessKey 时只覆盖少数链） */
  tokenDetailAvailable?: boolean;
}

export interface DappTokenPosition {
  symbol: string;
  amount: number;
  valueUsd: number;
  role: "asset" | "debt" | "reward";
}

export interface DappWalletShare {
  walletId: string;
  walletName: string;
  address: string;
  assetUsd: number;
  debtUsd: number;
  netUsd: number;
  tokens: DappTokenPosition[];
}

export interface DappChainAllocation {
  id: string;
  name: string;
  assetUsd: number;
  debtUsd: number;
  netUsd: number;
  wallets: DappWalletShare[];
}

export interface DappAllocation {
  id: string;
  name: string;
  siteUrl: string;
  /** DeBank 协议图标（官方 CDN 地址，直接复用 DeBank 的图） */
  logoUrl?: string;
  assetUsd: number;
  debtUsd: number;
  netUsd: number;
  chains: DappChainAllocation[];
  wallets: DappWalletShare[];
}

export interface OnchainBreakdown {
  generatedAt: string;
  walletCount: number;
  successfulWallets: number;
  chains: ChainAllocation[];
  dapps: DappAllocation[];
  /** 全部钱包的代币聚合（按价值降序），代币表格与链筛选的数据源。 */
  tokens: TokenHolding[];
  /** 已取到明细的钱包代币合计，用于和链总额做“覆盖率”说明 */
  tokensTotalUsd: number;
  /** 当前生效的代币数据源（debank / zerion / rabby-public） */
  tokenSource?: "debank" | "zerion" | "rabby-public" | "none";
  /** true 表示部分地址沿用上次成功数据（限流或失败） */
  partial?: boolean;
  /** 本轮沿用缓存/上次成功数据的地址数量 */
  cachedWallets?: number;
  /** 公共接口被限流时的冷却截止时间（ISO），到期后自动恢复完整明细 */
  rateLimitedUntil?: string | null;
}

/** Encrypted AES-256-GCM payload for optional CEX key material — never returned to client */
export interface EncryptedSecretsBlob {
  ciphertext: string;
  iv: string;
  tag: string;
  updatedAt: string;
}

/** 某个地址的代币明细缓存（服务端持久化，避免每次冷启动都去消耗 API 额度）。 */
export interface WalletTokenCacheEntry {
  at: string;
  tokens: Array<TokenLine & { chain: string }>;
  unpricedCount: number;
  unpricedByChain: Record<string, number>;
  coveredChains: string[];
}

/** 某个地址的 DeFi 协议明细缓存（服务端持久化，避免 Vercel 冷启动后丢失多钱包仓位）。 */
export interface WalletProtocolCacheEntry {
  at: string;
  protocols: Record<string, unknown>[];
}

export interface PortfolioState {
  manual: ManualAsset[];
  wallets: Wallet[];
  exchanges: ExchangeBalance[];
  snapshots: SnapshotPoint[];
  /** Long-lived flow alerts. These survive the seven-day snapshot rotation. */
  flowEvents?: FlowEvent[];
  onchainCacheUsd: number;
  lastRefresh: string | null;
  /** 最近一次「全量刷新」（链上 + DApp + 代币）的时间，用于自动判断该跑 fast 还是 full */
  lastFullRefreshAt?: string | null;
  usdCnyRate: number;
  onchainBreakdown?: OnchainBreakdown | null;
  /** 逐地址的代币明细缓存（服务端专用，不下发浏览器） */
  tokenCache?: Record<string, WalletTokenCacheEntry>;
  /** 逐地址的协议明细缓存（服务端专用，不下发浏览器） */
  protocolCache?: Record<string, WalletProtocolCacheEntry>;
  /** Optional encrypted CEX keys at rest (server-only) */
  encryptedSecrets?: EncryptedSecretsBlob | null;
}

export interface CexKeyMaterial {
  okx?: { apiKey?: string; apiSecret?: string; passphrase?: string; simulated?: boolean };
  binance?: { apiKey?: string; apiSecret?: string };
  gate?: { apiKey?: string; apiSecret?: string };
}
