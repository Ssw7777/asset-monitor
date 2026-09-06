export type ChainType = "EVM" | "ABSTRACT";

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
  status: "ok" | "stale" | "error" | "baseline";
}

export interface ExchangeBalance {
  exchange: "okx" | "binance" | "gate";
  balanceUsd: number;
  lastUpdated: string | null;
  status: "ok" | "missing_keys" | "error" | "baseline";
  error?: string;
}

export interface SnapshotPoint {
  ts: string;
  totalUsd: number;
}

export interface PortfolioState {
  manual: ManualAsset[];
  wallets: Wallet[];
  exchanges: ExchangeBalance[];
  snapshots: SnapshotPoint[];
  onchainCacheUsd: number;
  lastRefresh: string | null;
  usdCnyRate: number;
}
