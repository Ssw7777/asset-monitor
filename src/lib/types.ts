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
  /** ok = live; cached = kept last good / TTL; error = refresh failed; baseline = seed only (pre-refresh) */
  status: "ok" | "cached" | "stale" | "error" | "baseline";
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
}

/** Encrypted AES-256-GCM payload for optional CEX key material — never returned to client */
export interface EncryptedSecretsBlob {
  ciphertext: string;
  iv: string;
  tag: string;
  updatedAt: string;
}

export interface PortfolioState {
  manual: ManualAsset[];
  wallets: Wallet[];
  exchanges: ExchangeBalance[];
  snapshots: SnapshotPoint[];
  onchainCacheUsd: number;
  lastRefresh: string | null;
  usdCnyRate: number;
  /** Optional encrypted CEX keys at rest (server-only) */
  encryptedSecrets?: EncryptedSecretsBlob | null;
}

export interface CexKeyMaterial {
  okx?: { apiKey?: string; apiSecret?: string; passphrase?: string; simulated?: boolean };
  binance?: { apiKey?: string; apiSecret?: string };
  gate?: { apiKey?: string; apiSecret?: string };
}
