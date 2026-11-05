import { timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { NextRequest } from "next/server";

const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const GITHUB_MAIN_REF = "refs/heads/main";

/** Optional OIDC audiences from env (comma-separated). Empty = CRON_SECRET only. */
function oidcAudiences(): string[] {
  const raw = process.env.CRON_OIDC_AUDIENCES || "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

type TrustedWorkflow = {
  repository: string;
  repositoryId: string;
  visibility: string;
  workflowRef: string;
  allowedEvents: string[];
};

/** Optional trusted workflow JSON array in CRON_OIDC_TRUSTED_WORKFLOWS. */
function trustedWorkflows(): TrustedWorkflow[] {
  const raw = process.env.CRON_OIDC_TRUSTED_WORKFLOWS || "";
  if (!raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    console.warn("[cron-auth] CRON_OIDC_TRUSTED_WORKFLOWS is not valid JSON; ignoring");
    return [];
  }
}

const githubJwks = createRemoteJWKSet(
  new URL(`${GITHUB_OIDC_ISSUER}/.well-known/jwks`),
  {
    cooldownDuration: 5 * 60 * 1000,
    timeoutDuration: 10 * 1000,
  }
);

function bearerToken(req: NextRequest) {
  const authorization = req.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

function secretsMatch(left: string, right: string) {
  if (!left || !right) return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

async function isTrustedGithubWorkflowToken(token: string) {
  if (!token) return false;
  const audiences = oidcAudiences();
  const workflows = trustedWorkflows();
  if (!audiences.length || !workflows.length) return false;

  try {
    const { payload } = await jwtVerify(token, githubJwks, {
      issuer: GITHUB_OIDC_ISSUER,
      audience: audiences,
      algorithms: ["RS256"],
    });

    const trustedWorkflow = workflows.find(
      (candidate) =>
        payload.repository === candidate.repository &&
        payload.repository_id === candidate.repositoryId &&
        payload.workflow_ref === candidate.workflowRef &&
        payload.repository_visibility === candidate.visibility
    );

    return (
      !!trustedWorkflow &&
      payload.ref === GITHUB_MAIN_REF &&
      trustedWorkflow.allowedEvents.some((event) => payload.event_name === event) &&
      payload.runner_environment === "github-hosted"
    );
  } catch {
    return false;
  }
}

/**
 * Authorizes either the shared CRON_SECRET or an optional short-lived GitHub
 * OIDC token (configured via CRON_OIDC_AUDIENCES + CRON_OIDC_TRUSTED_WORKFLOWS).
 */
export async function hasCronAuthorization(req: NextRequest) {
  const token = bearerToken(req);
  const configuredSecret = process.env.CRON_SECRET || "";
  const querySecret = new URL(req.url).searchParams.get("token") || "";

  if (
    configuredSecret &&
    (secretsMatch(token, configuredSecret) || secretsMatch(querySecret, configuredSecret))
  ) {
    return true;
  }

  return isTrustedGithubWorkflowToken(token);
}
