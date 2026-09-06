import type { ManualAsset, Wallet } from "./types";

export const BASELINE = {
  totalUsd: 74841.14,
  onchainUsd: 22101.84,
  cexUsd: 48726.3,
  manualUsd: 4013,
  okx: 1646.73,
  binance: 5071.73,
  gate: 42007.84,
  evmUsd: 15492.21,
  abstractUsd: 6609.63,
} as const;

export const SEED_MANUAL: ManualAsset[] = [
  { id: "m1", name: "LDM OKX账户", amountUsd: 1003, updatedAt: new Date().toISOString() },
  { id: "m2", name: "Maq OKX账户", amountUsd: 1009, updatedAt: new Date().toISOString() },
  { id: "m3", name: "哥哥 OKX账户 1000", amountUsd: 1000, updatedAt: new Date().toISOString() },
  { id: "m4", name: "个人护照 OKX账户 1001", amountUsd: 1001, updatedAt: new Date().toISOString() },
];

const EVM: Array<[string, string, number]> = [
  ["Linea", "0x3952fe0f1d38c8378fc3c35a1a44f69f6e0fc1dd", 13630.23],
  ["Trust", "0x3217871b96dd022200340c194face4ab239705a0", 420.1],
  ["Xter1", "0xadfe712f748daade34c116858ae6bdaca08fad22", 310.5],
  ["Xter2", "0x2505159f9b1b5f629e9b0eeb39ba94c0c1e2624b", 280.4],
  ["Xter3", "0x52710c3a7c16adf8c44b25ce4dbc6da5306be035", 195.2],
  ["Xter4", "0xf0b1eb704c696c72e23c09d3274a88100c7b914c", 175.8],
  ["Xter5", "0x5bbf0aeb025f286a6dde9e94b082395b2d442c4c", 160.3],
  ["Xter6", "0x45362b2f258e1b82b9cd319b63e1870be69ba7d5", 142.6],
  ["Gas分发", "0x4ac59c5b4f56167eb896c821fb85136848652852", 98.5],
  ["SafePal", "0xda30d7d870119da7ac793016de8e62d647ed10df", 78.58],
];

const ABSTRACT: Array<[string, string, number]> = [
  ["Linea（Abstract）", "0x3a7a0477ad09d8abc78254bf1e53dcc7ed5f030d", 400],
  ["Trust（Abstract）", "0x9f600c729e953536f90fbf5dd41891eee68e1de7", 3586.06],
  ["Xter1（Abstract）", "0x1897868924ba4722e9c01e9619aad55d83c17f34", 350],
  ["Xter2（Abstract）", "0x41c0f5ca063da149c227c21d106a7838cbc74d19", 152.82],
  ["Xter3（Abstract）", "0x5d79bc991884f2316c06631f9de704c441f57121", 280],
  ["Xter4（Abstract）", "0xabd87fc5e600ca7205b95f6d9b26e7c974067caa", 675.11],
  ["Xter5（Abstract）", "0x97a1f45f3e64d99d2e222547e20f9fcc8f2d5ff0", 220],
  ["Xter6（Abstract）", "0x446018c09bd2a9c50cba161e90b1bca5433acdeb", 180],
  ["Gas分发（Abstract）", "0xe8094c9380899205af6ac43181625cad21840c1e", 116.18],
  ["SafePal（Abstract）", "0x3bfd51e42705873fbca47f22484820c9e09dcf61", 649.46],
];

export function seedWallets(): Wallet[] {
  const now = new Date().toISOString();
  const evm = EVM.map(([name, address, balanceUsd], i) => ({
    id: `e${i + 1}`,
    name,
    address,
    chain: "EVM" as const,
    balanceUsd,
    lastUpdated: now,
    status: "baseline" as const,
  }));
  const abs = ABSTRACT.map(([name, address, balanceUsd], i) => ({
    id: `a${i + 1}`,
    name,
    address,
    chain: "ABSTRACT" as const,
    balanceUsd,
    lastUpdated: now,
    status: "baseline" as const,
  }));
  return [...evm, ...abs];
}
