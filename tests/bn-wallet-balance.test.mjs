import { test } from "node:test";
import assert from "node:assert/strict";
import {
  acceptNativePrice,
  applyBnWalletTokens,
  chooseWalletTotal,
  expandNativePrices,
  extractBnRawTokens,
  fetchBnWalletValuation,
  rabbyTotalDiscrepancy,
  valueBnWalletTokens,
  BN_TOTAL_STALE_FALLBACK_MS,
} from "../src/lib/onchain/bn-wallet-balance.ts";
import { bnWeb3Read } from "../src/lib/onchain/bn-web3.ts";

const credentials = { key: "test-key", secret: "test-secret" };
const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const FAKE_HOOD_USDG = "0xbf6295d125b61178ab182bb63875b7fc2d607a70";

function row(partial) {
  return {
    chainId: "eth",
    bnChainId: "1",
    contract: "",
    symbol: "ETH",
    name: "Ethereum",
    amount: 1,
    amountExact: "1",
    price: 1,
    verified: true,
    risk: false,
    liquidity: null,
    ...partial,
  };
}

test("parser reads per-chain tokenAssets and flat balance rows", () => {
  const fromBuckets = extractBnRawTokens({
    code: "0",
    data: [
      {
        binanceChainId: "1",
        tokenAssets: [
          {
            chainIndex: "1",
            tokenContractAddress: USDC,
            symbol: "USDC",
            balance: "25",
            tokenPrice: "1",
            isRiskToken: false,
          },
        ],
      },
    ],
  });
  assert.equal(fromBuckets.length, 1);
  assert.equal(fromBuckets[0].chainId, "eth");
  assert.equal(fromBuckets[0].amount, 25);

  const flat = extractBnRawTokens({
    code: "0",
    data: [
      {
        symbol: "BNB",
        address: "",
        binanceChainId: "56",
        balance: "0.5",
        price: "600",
        isRiskToken: false,
      },
    ],
  });
  assert.equal(flat.length, 1);
  assert.equal(flat[0].chainId, "bsc");
  assert.equal(flat[0].symbol, "BNB");
  assert.equal(flat[0].contract, "");
});

test("filters drop spam, risk, unverified, illiquid, fake, and absurd outliers", () => {
  const valued = valueBnWalletTokens([
    row({ amount: 2, price: 1 }),
    row({
      contract: USDC,
      symbol: "USDC",
      name: "USD Coin",
      amount: 100,
      amountExact: "100",
      price: 1,
      verified: true,
    }),
    row({
      contract: "0x" + "11".repeat(20),
      symbol: "CLAIM",
      name: "Visit claim-airdrop.com now",
      amount: 1000,
      price: 50,
      verified: false,
      risk: true,
    }),
    row({
      contract: "0x" + "55".repeat(20),
      symbol: "RXTOKEN",
      name: "Flagged asset",
      amount: 5,
      price: 10,
      verified: true,
      risk: true,
    }),
    row({
      contract: "0x" + "22".repeat(20),
      symbol: "OBSCURE",
      name: "Project token",
      amount: 10,
      price: 20,
      verified: false,
      liquidity: 100_000,
    }),
    row({
      contract: FAKE_HOOD_USDG,
      chainId: "hood",
      bnChainId: "4663",
      symbol: "USDG",
      name: "United States Global Dollar",
      amount: 10,
      price: 1,
      verified: true,
    }),
    row({
      contract: "0x" + "33".repeat(20),
      symbol: "DUSTLP",
      name: "Thin pool",
      amount: 100,
      price: 2,
      verified: null,
      liquidity: 10,
    }),
    row({
      contract: "0x" + "44".repeat(20),
      symbol: "JUNKVAL",
      name: "Absurd valuation",
      amount: 1,
      price: 80_000,
      verified: null,
      liquidity: null,
    }),
  ], { nativePrices: { eth: 3500 } });

  const symbols = valued.tokens.map((token) => token.symbol).sort();
  assert.deepEqual(symbols, ["ETH", "USDC"]);
  assert.equal(valued.dropped.risk, 1);
  assert.equal(valued.dropped.junk >= 1, true);
  assert.equal(valued.dropped.unverified, 1);
  assert.equal(valued.dropped.fake, 1);
  assert.equal(valued.dropped.illiquid, 1);
  assert.equal(valued.dropped.absurd, 1);
  assert.equal(valued.totalUsd, 7100);
  assert.equal(valued.tokens.find((token) => token.symbol === "ETH").valuationPrice, 3500);
  assert.equal(valued.tokens.find((token) => token.symbol === "ETH").priceSource, "coinstats");
});

test("native price comes from wrapped gas token when CoinStats is absent, never from Binance native price", () => {
  assert.equal(acceptNativePrice("eth", "ETH", 1), false);
  const valued = valueBnWalletTokens([
    row({ amount: 1.5, amountExact: "1.5", price: 1 }),
    row({
      contract: WETH,
      symbol: "WETH",
      name: "Wrapped Ether",
      amount: 0.2,
      amountExact: "0.2",
      price: 3500,
      verified: true,
    }),
  ]);
  const eth = valued.tokens.find((token) => token.symbol === "ETH");
  assert.equal(eth.valuationPrice, 3500);
  assert.equal(eth.valueUsd, 5250);
  assert.equal(valued.incompleteNative, false);
  assert.equal(valued.totalUsd, 5950);
});

test("missing native price does not publish a total that ignores the gas coin", () => {
  const valued = valueBnWalletTokens([
    row({ amount: 1, price: 0.01 }),
    row({
      contract: USDC,
      symbol: "USDC",
      name: "USD Coin",
      amount: 10,
      amountExact: "10",
      price: 1,
      verified: true,
    }),
  ]);
  assert.equal(valued.incompleteNative, true);
  assert.equal(valued.tokens.some((token) => token.symbol === "ETH"), false);
});

test("expandNativePrices copies an ETH quote onto every ETH chain", () => {
  const prices = expandNativePrices({ eth: 3600 });
  assert.equal(prices.arb, 3600);
  assert.equal(prices.base, 3600);
  assert.equal(prices.bsc, undefined);
});

test("reconcile flags only gaps above max($150, 3%) and Rabby never wins over Binance", () => {
  assert.equal(rabbyTotalDiscrepancy(10000, 10200), null);
  const flagged = rabbyTotalDiscrepancy(10000, 10400);
  assert.ok(flagged);
  assert.equal(flagged.threshold, 312);
  assert.equal(rabbyTotalDiscrepancy(100, 400).threshold, 150);

  const now = Date.now();
  const fresh = chooseWalletTotal({
    nowMs: now,
    previousUsd: 1000,
    previousAtMs: now - 60_000,
    previousSource: "bn-web3",
    binanceUsd: 1100,
    rabbyUsd: 9000,
  });
  assert.equal(fresh.source, "bn-web3");
  assert.equal(fresh.usd, 1100);

  const keep = chooseWalletTotal({
    nowMs: now,
    previousUsd: 1000,
    previousAtMs: now - 60_000,
    previousSource: "bn-web3",
    binanceUsd: null,
    rabbyUsd: 5000,
  });
  assert.equal(keep.source, "last-good");
  assert.equal(keep.usd, 1000);

  const fallback = chooseWalletTotal({
    nowMs: now,
    previousUsd: 1000,
    previousAtMs: now - BN_TOTAL_STALE_FALLBACK_MS - 1,
    previousSource: "bn-web3",
    binanceUsd: null,
    rabbyUsd: 1100,
  });
  assert.equal(fallback.source, "rabby");
  assert.equal(fallback.usd, 1100);

  const back = chooseWalletTotal({
    nowMs: now,
    previousUsd: 1100,
    previousAtMs: now - 60_000,
    previousSource: "public",
    binanceUsd: 1050,
    rabbyUsd: 1100,
  });
  assert.equal(back.source, "bn-web3");
  assert.equal(back.usd, 1050);

  const explicitZero = chooseWalletTotal({
    nowMs: now,
    previousUsd: 0,
    previousAtMs: now - 60_000,
    previousSource: "bn-web3",
    binanceUsd: null,
    rabbyUsd: 400,
  });
  assert.equal(explicitZero.source, "last-good");
  assert.equal(explicitZero.usd, 0);
});

test("token cache drops phishing rows on covered chains and keeps RPC quantities", () => {
  const previous = {
    at: "2020-01-01T00:00:00.000Z",
    tokens: [
      {
        chain: "eth",
        symbol: "CLAIM",
        name: "visit airdrop",
        amount: 10,
        valueUsd: 500,
        tokenId: "0x" + "ab".repeat(20),
        kind: "spot",
        isCore: false,
      },
      {
        chain: "eth",
        symbol: "USDC",
        amount: 3,
        amountExact: "3.5",
        valueUsd: 3,
        tokenId: USDC,
        contractAddress: USDC,
        kind: "stable",
        isCore: true,
        quantitySource: "rpc",
        quantityBlock: "0x10",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    unpricedCount: 0,
    unpricedByChain: {},
    coveredChains: ["eth"],
  };
  const next = applyBnWalletTokens(
    previous,
    [
      {
        chain: "eth",
        symbol: "USDC",
        amount: 4,
        amountExact: "4",
        valueUsd: 4,
        valuationPrice: 1,
        tokenId: USDC,
        contractAddress: USDC,
        kind: "stable",
        isCore: true,
      },
    ],
    ["eth"],
    "2026-10-22T00:00:00.000Z"
  );
  assert.equal(next.tokens.length, 1);
  assert.equal(next.tokens[0].symbol, "USDC");
  assert.equal(next.tokens[0].amountExact, "3.5");
  assert.equal(next.tokens[0].quantitySource, "rpc");
  assert.equal(next.tokens[0].valueUsd, 3.5);
  assert.equal(next.source, "bn-web3");
});

test("balance endpoint is read-only and paginates until a short page", async () => {
  let calls = 0;
  const request = async (url) => {
    calls += 1;
    const page = new URL(url).searchParams.get("page");
    assert.match(String(url), /\/api\/v1\/dex\/balance\/all-token-balances-by-address/);
    assert.match(String(url), /excludeRiskToken=true/);
    const tokens =
      page === "1"
        ? Array.from({ length: 100 }, (_, index) => ({
            chainIndex: "1",
            tokenContractAddress: `0x${index.toString(16).padStart(40, "0")}`,
            symbol: `T${index}`,
            balance: "1",
            tokenPrice: "1",
            isRiskToken: false,
            isVerified: true,
          }))
        : [
            {
              chainIndex: "1",
              tokenContractAddress: USDC,
              symbol: "USDC",
              balance: "5",
              tokenPrice: "1",
              isRiskToken: false,
              isVerified: true,
            },
          ];
    return new Response(JSON.stringify({ code: "0", data: [{ tokenAssets: tokens }] }), { status: 200 });
  };
  const valued = await fetchBnWalletValuation("0x" + "ab".repeat(20), {
    credentials,
    request,
    chainIds: ["1"],
    nativePrices: { eth: 3500 },
  });
  assert.equal(calls, 2);
  assert.equal(valued.tokens.some((token) => token.symbol === "USDC"), true);
  assert.equal(valued.incompleteNative, false);

  await assert.rejects(
    () => bnWeb3Read("/api/v1/dex/trade/build", undefined, { credentials, request }),
    /non_read/
  );
});
