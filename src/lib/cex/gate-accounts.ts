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
  /** Preferred env names (documented). Legacy aliases still accepted. */
  keyEnv: string;
  secretEnv: string;
  legacyKeyEnv: string;
  legacySecretEnv: string;
  missingError: string;
  /** Compact form of the temporary manual row this account replaces. */
  stubKey: string;
}> = [
  {
    id: "gate_mom",
    label: "Gate B",
    keyEnv: "GATE_B_KEY",
    secretEnv: "GATE_B_SECRET",
    legacyKeyEnv: "GATE_MOM_KEY",
    legacySecretEnv: "GATE_MOM_SECRET",
    missingError: "Gate B API key/secret not configured",
    stubKey: "gatebgho",
  },
  {
    id: "gate_brother",
    label: "Gate C",
    keyEnv: "GATE_C_KEY",
    secretEnv: "GATE_C_SECRET",
    legacyKeyEnv: "GATE_BROTHER_KEY",
    legacySecretEnv: "GATE_BROTHER_SECRET",
    missingError: "Gate C API key/secret not configured",
    stubKey: "gatecgho",
  },
];

function envValue(name: string): string | undefined {
  const raw = process.env[name];
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed ? trimmed : undefined;
}

function accountCredentials(item: (typeof OPTIONAL_ACCOUNTS)[number]) {
  const apiKey = envValue(item.keyEnv) || envValue(item.legacyKeyEnv);
  const secret = envValue(item.secretEnv) || envValue(item.legacySecretEnv);
  // Prefer documenting the modern env names in warnings.
  const usingLegacy = !envValue(item.keyEnv) && !envValue(item.secretEnv) && !!(envValue(item.legacyKeyEnv) || envValue(item.legacySecretEnv));
  const keyName = usingLegacy ? item.legacyKeyEnv : item.keyEnv;
  const secretName = usingLegacy ? item.legacySecretEnv : item.secretEnv;
  return { apiKey, secret, keyName, secretName };
}

/**
 * Primary Gate stays on GATE_API_KEY / GATE_API_SECRET (or encrypted keys).
 * Optional Gate B / Gate C are included only when both of their env vars are set.
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
    const { apiKey, secret, keyName, secretName } = accountCredentials(item);
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
      console.warn(`[gate] skipping ${item.label}: set both ${keyName} and ${secretName}, or neither`);
    }
  }

  return accounts;
}

export function compactManualName(name: string): string {
  return name.replace(/\s+/g, "").toLowerCase();
}

/**
 * Drop temporary manual rows once the matching Gate account has published
 * a live total. Failed or unconfigured accounts leave their stub in place.
 * Matched names (whitespace ignored): 「Gate B GHO」「Gate C GHO」.
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
