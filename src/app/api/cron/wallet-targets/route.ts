import { NextRequest, NextResponse } from "next/server";
import { hasCronAuthorization } from "@/lib/cron-auth";
import { readStore } from "@/lib/store";

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
  const wallets = state.wallets.map((wallet) => ({
    id: wallet.id,
    address: wallet.address.toLowerCase(),
  }));

  return NextResponse.json({ ok: true, count: wallets.length, wallets });
}
