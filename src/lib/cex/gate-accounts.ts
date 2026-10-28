import { resolveCexKeys } from "../crypto";
import type { EncryptedSecretsBlob } from "../types";

export type GateAccountId = "gate" | "gate_mom" | "gate_brother";

export interface ResolvedGateAccount {
  id: GateAccountId;
  label: string;
  apiKey?: string;
  secret?: string;
  missingError: string;
}

const OPTIONAL_ACCOUNTS: Array<{
  id: Exclude<GateAccountId, "gate">;
  label: string;
  keyEnv: "GATE_MOM_KEY" | "GATE_BROTHER_KEY";
  secretEnv: "GATE_MOM_SECRET" | "GATE_BROTHER_SECRET";
  missingError: string;
  /** Compact form of the temporary manual row this account replaces. */
  stubKey: string;
}> = [
  {
    id: "gate_mom",
    label: "Gate妈妈",
    keyEnv: "GATE_MOM_KEY",
    secretEnv: "GATE_MOM_SECRET",
    missingError: "Gate妈妈 API key/secret not configured",
    stubKey: "妈妈gategho理财",
  },
  {
    id: "gate_brother",
    label: "Gate哥哥",
    keyEnv: "GATE_BROTHER_KEY",
    secretEnv: "GATE_BROTHER_SECRET",
    missingError: "Gate哥哥 API key/secret not configured",
    stubKey: "哥哥gategho理财",
  },
];

function envValue(name: string): string | undefined {
  const raw = process.env[name];
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Personal Gate stays on GATE_API_KEY / GATE_API_SECRET (or encrypted keys).
 * Mom and brother are included only when both of their env vars are set.
 * A missing pair is skipped. A half-set pair is skipped and warned, never thrown.
 */
export function resolveGateAccounts(blob?: EncryptedSecretsBlob | null): ResolvedGateAccount[] {
  const personal = resolveCexKeys(blob ?? null).gate;
  const accounts: ResolvedGateAccount[] = [
    {
      id: "gate",
      label: "Gate",
      apiKey: personal.apiKey?.trim() || undefined,
      secret: personal.secret?.trim() || undefined,
      missingError: "Gate API key/secret not configured",
    },
  ];

  for (const item of OPTIONAL_ACCOUNTS) {
    const apiKey = envValue(item.keyEnv);
    const secret = envValue(item.secretEnv);
    if (apiKey && secret) {
      accounts.push({
        id: item.id,
        label: item.label,
        apiKey,
        secret,
        missingError: item.missingError,
      });
      continue;
    }
    if (apiKey || secret) {
      console.warn(`[gate] skipping ${item.label}: set both ${item.keyEnv} and ${item.secretEnv}, or neither`);
    }
  }

  return accounts;
}

export function compactManualName(name: string): string {
  return name.replace(/\s+/g, "").toLowerCase();
}

/**
 * Drop the temporary manual rows once the matching Gate account has published
 * a live total. Failed or unconfigured accounts leave their stub in place so
 * the headline total does not lose that money.
 *
 * Matched names (whitespace ignored): 「妈妈 Gate GHO理财」「哥哥 Gate GHO理财」.
 */
export function retirePublishedGateStubs<T extends { name: string }>(
  manual: T[],
  accounts: Array<{ id: string; status: string }>
): { manual: T[]; removed: string[] } {
  const keys = new Set<string>();
  for (const account of accounts) {
    if (account.status !== "ok") continue;
    const spec = OPTIONAL_ACCOUNTS.find((item) => item.id === account.id);
    if (spec) keys.add(spec.stubKey);
  }
  if (!keys.size) return { manual, removed: [] };

  const removed: string[] = [];
  const next = manual.filter((item) => {
    const name = String(item.name || "");
    if (!keys.has(compactManualName(name))) return true;
    removed.push(name);
    return false;
  });
  return { manual: next, removed };
}
