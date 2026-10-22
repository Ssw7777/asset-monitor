/**
 * Read-only check before deploy.
 * Prints each configured wallet's Rabby total next to the filtered Binance total
 * and the tokens that were left out. Does not write the store.
 *
 *   node --import tsx scripts/probe-wallet-totals.mjs
 *
 * Reads data/store.json, or STORE_PATH. When TURSO_DATABASE_URL is set, reads
 * the live row and does not insert one if it is missing.
 */
import fs from "node:fs";
import path from "node:path";
import { activeRefreshWallets } from "../src/lib/wallets.ts";
import {
  fetchBnWalletValuation,
  fetchWrappedNativePrices,
  nativePricesFromTokenCache,
  repeatedRoundKeys,
  valueBnWalletTokens,
} from "../src/lib/onchain/bn-wallet-balance.ts";
import { fetchRabbyTotalBalance } from "../src/lib/onchain/debank.ts";

async function loadState() {
  if (process.env.TURSO_DATABASE_URL) {
    const { readLiveStore } = await import("../src/lib/store.ts");
    return readLiveStore();
  }
  const file = process.env.STORE_PATH || path.join(process.cwd(), "data", "store.json");
  if (!fs.existsSync(file)) {
    console.error("No wallet store to read. Set STORE_PATH or TURSO_DATABASE_URL.");
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function money(value) {
  return Number.isFinite(value) ? value.toFixed(2) : "—";
}

const state = await loadState();
const wallets = activeRefreshWallets(state.wallets ?? []);
if (!wallets.length) {
  console.error("No active wallets in the store.");
  process.exit(1);
}

const nativePrices = nativePricesFromTokenCache(Object.values(state.tokenCache ?? {}));
const marketPrices = await fetchWrappedNativePrices();
const fetched = [];
for (const wallet of wallets) {
  process.stderr.write(`reading ${wallet.name}\n`);
  const valuation = await fetchBnWalletValuation(wallet.address, { nativePrices, marketPrices });
  const rabby = await fetchRabbyTotalBalance(wallet.address);
  fetched.push({ wallet, valuation, rabby });
}

const repeated = repeatedRoundKeys(
  fetched.map((row) => ({
    wallet: row.wallet.address.toLowerCase(),
    rows: row.valuation?.roundHoldings ?? [],
  }))
);

const lines = [];
let rabbySum = 0;
let binanceSum = 0;
for (const row of fetched) {
  const address = row.wallet.address.toLowerCase();
  const held = state.chainCache?.[address]?.rabbyHeld;
  const valued = row.valuation
    ? valueBnWalletTokens(row.valuation.rawRows, {
        nativePrices,
        marketPrices,
        repeatedRounds: repeated,
        rabbyHeld: held,
      })
    : null;
  const rabbyUsd = row.rabby?.totalUsd ?? null;
  const binanceUsd = valued?.totalUsd ?? null;
  if (rabbyUsd != null) rabbySum += rabbyUsd;
  if (binanceUsd != null) binanceSum += binanceUsd;
  const excluded = (valued?.excluded ?? [])
    .filter((token) => token.valueUsd >= 1)
    .map((token) => `${token.symbol} ${token.valueUsd.toFixed(0)} ${token.reason}`)
    .join(", ");
  lines.push({
    name: row.wallet.name,
    prefix: address.slice(0, 8),
    rabby: rabbyUsd,
    binance: binanceUsd,
    delta: rabbyUsd != null && binanceUsd != null ? binanceUsd - rabbyUsd : null,
    excluded: excluded || "—",
  });
}

const nameWidth = Math.max(8, ...lines.map((line) => line.name.length));
console.log(
  `${"wallet".padEnd(nameWidth)}  prefix    rabby        binance      delta    excluded`
);
for (const line of lines) {
  console.log(
    `${line.name.padEnd(nameWidth)}  ${line.prefix}  ${money(line.rabby).padStart(11)}  ${money(line.binance).padStart(11)}  ${money(line.delta).padStart(8)}  ${line.excluded}`
  );
}
console.log(
  `${"sum".padEnd(nameWidth)}  ${"".padEnd(8)}  ${money(rabbySum).padStart(11)}  ${money(binanceSum).padStart(11)}  ${money(binanceSum - rabbySum).padStart(8)}`
);
