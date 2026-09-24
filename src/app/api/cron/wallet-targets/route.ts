import { NextRequest, NextResponse } from "next/server";
import { hasCronAuthorization } from "@/lib/cron-auth";
import { readStore } from "@/lib/store";
import { needsProtocolRefresh } from "@/lib/scheduler-freshness";

export const preferredRegion = ["hkg1"];
export const dynamic = "force-dynamic";

/**
 * Private scheduler manifest. Addresses are returned only to an authenticated
 * GitHub-hosted runner and are never embedded in the public workflow source.
 */
export async function GET(req: NextRequest) {
  if (!(await hasCronAuthorization(req))) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const state = await readStore();
  // Keep the persisted order stable. Five independent GitHub runners fetch this
  // manifest at slightly different instants; a freshness sort could reshuffle after
  // the first write and make runners duplicate or skip an address.
  const now = Date.now();
  const retryBefore = now - 8 * 60 * 1000;
  // App audits consume a limited authenticated quota. Keep that separate from
  // public protocol positions, which must follow the ten-minute wallet cadence.
  const detailRefreshBefore = now - 5.5 * 60 * 60 * 1000;
  const appRefreshIndexes = new Set(
    state.wallets
    .map((wallet, index) => {
      const rawAt = state.protocolCache?.[wallet.address.toLowerCase()]?.appAt;
      const parsedAt = rawAt ? new Date(rawAt).getTime() : Number.NaN;
      const validAt = Number.isFinite(parsedAt) && parsedAt <= now + 60_000 ? parsedAt : 0;
      return { index, at: validAt };
    })
    .filter((entry) => entry.at < detailRefreshBefore)
      .sort((left, right) => left.at - right.at || left.index - right.index)
      .slice(0, 10)
      .map((entry) => entry.index)
  );
  const protocolRefreshIndexes = new Set(
    state.wallets
      .map((wallet, index) => {
        const rawAt = state.protocolCache?.[wallet.address.toLowerCase()]?.at;
        return { index, due: needsProtocolRefresh(rawAt, now) };
      })
      .filter((entry) => entry.due)
      .map((entry) => entry.index)
  );
  const wallets = state.wallets.map((wallet, index) => {
    const lastSuccessMs = wallet.lastSuccess?.at
      ? new Date(wallet.lastSuccess.at).getTime()
      : Number.NaN;
    return {
      id: wallet.id,
      address: wallet.address.toLowerCase(),
      needsRetry:
        !Number.isFinite(lastSuccessMs) ||
        lastSuccessMs > now + 60_000 ||
        lastSuccessMs < retryBefore || protocolRefreshIndexes.has(index),
      needsAppRefresh: appRefreshIndexes.has(index),
      needsProtocolRefresh: protocolRefreshIndexes.has(index),
    };
  });

  return NextResponse.json({ ok: true, count: wallets.length, wallets });
}
