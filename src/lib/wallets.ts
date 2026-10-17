import type { ChainType, Wallet } from "./types";

export const WALLET_LIMIT = 50;
const ABSTRACT_SUFFIX = "（Abstract）";

export function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

export function ensureAbstractName(name: string, chain: ChainType): string {
  const n = name.trim() || "未命名";
  if (chain !== "ABSTRACT") {
    return n.endsWith(ABSTRACT_SUFFIX) ? n.slice(0, -ABSTRACT_SUFFIX.length).trim() || n : n;
  }
  if (n.includes("（Abstract）") || n.includes("(Abstract)")) return n;
  return `${n}${ABSTRACT_SUFFIX}`;
}

export function isValidEthAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address.trim());
}

export function findDupeIndex(wallets: Wallet[], address: string, excludeId?: string): number {
  const addr = normalizeAddress(address);
  return wallets.findIndex(
    (w) => normalizeAddress(w.address) === addr && (!excludeId || w.id !== excludeId)
  );
}

export function parseBatchAddresses(text: string): string[] {
  const lines = text
    .split(/[\n,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const m = line.match(/(0x[a-fA-F0-9]{40})/i);
    if (!m) continue;
    const addr = normalizeAddress(m[1]);
    if (seen.has(addr)) continue;
    seen.add(addr);
    out.push(m[1]);
  }
  return out;
}

export function makeWallet(partial: {
  id?: string;
  name: string;
  address: string;
  chain: ChainType;
  balanceUsd?: number;
}): Wallet {
  const chain = partial.chain;
  return {
    id: partial.id || `w_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: ensureAbstractName(partial.name, chain),
    address: partial.address.trim(),
    chain,
    balanceUsd: Math.round((partial.balanceUsd || 0) * 100) / 100,
    lastUpdated: null,
    status: "baseline",
  };
}

/** Abstract 地址管理页这 10 个已提空地址：停更，只保留展示。 */
export const PAUSED_ABSTRACT_ADDRESSES = new Set([
  "0x97a1f45f3e64d99d2e222547e20f9fcc8f2d5ff0",
  "0x1897868924ba4722e9c01e9619aad55d83c17f34",
  "0x9f600c729e953536f90fbf5dd41891eee68e1de7",
  "0x5d79bc991884f2316c06631f9de704c441f57121",
  "0x3bfd51e42705873fbca47f22484820c9e09dcf61",
  "0x446018c09bd2a9c50cba161e90b1bca5433acdeb",
  "0xe8094c9380899205af6ac43181625cad21840c1e",
  "0xabd87fc5e600ca7205b95f6d9b26e7c974067caa",
  "0x41c0f5ca063da149c227c21d106a7838cbc74d19",
  "0x3a7a0477ad09d8abc78254bf1e53dcc7ed5f030d",
].map((a) => a.toLowerCase()));

export function isWalletRefreshEnabled(wallet: Pick<Wallet, "address" | "refreshPaused">): boolean {
  if (wallet.refreshPaused === true) return false;
  return !PAUSED_ABSTRACT_ADDRESSES.has(normalizeAddress(wallet.address));
}

/** One-shot Abstract dust rescans for paused wallets (junk-priced totals replaced). */
export const PAUSED_ABSTRACT_RESCANNED_USD: Record<string, number> = {
  "0x97a1f45f3e64d99d2e222547e20f9fcc8f2d5ff0": 0.02,
};

export function activeRefreshWallets<T extends Pick<Wallet, "address" | "refreshPaused">>(wallets: T[]): T[] {
  return wallets.filter(isWalletRefreshEnabled);
}
