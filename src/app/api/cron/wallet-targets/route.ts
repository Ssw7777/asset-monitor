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
  const successTime = (value: string | null | undefined) => {
    const parsed = value ? new Date(value).getTime() : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const wallets = [...state.wallets]
    .sort(
      (left, right) =>
        successTime(left.lastSuccess?.at) - successTime(right.lastSuccess?.at) ||
        left.address.localeCompare(right.address)
    )
    .map((wallet) => ({ id: wallet.id, address: wallet.address.toLowerCase() }));

  return NextResponse.json({ ok: true, count: wallets.length, wallets });
}
