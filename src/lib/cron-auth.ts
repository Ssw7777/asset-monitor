import { timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { NextRequest } from "next/server";

const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const GITHUB_OIDC_AUDIENCES = [
  "https://0xstudybank-six.vercel.app",
  "https://0xstudybank.vercel.app",
] as const;
const GITHUB_OIDC_AUDIENCE = GITHUB_OIDC_AUDIENCES[0];
const GITHUB_MAIN_REF = "refs/heads/main";
const TRUSTED_GITHUB_WORKFLOWS = [
  {
    repository: "Ssw7777/asset-monitor",
    repositoryId: "1359556821",
    visibility: "private",
    workflowRef: "Ssw7777/asset-monitor/.github/workflows/production-refresh.yml@refs/heads/main",
    allowedEvents: ["workflow_dispatch"],
  },
  {
    repository: "Ssw7777/0xstudybank-scheduler",
    repositoryId: "1368972947",
    visibility: "public",
    workflowRef:
      "Ssw7777/0xstudybank-scheduler/.github/workflows/production-refresh.yml@refs/heads/main",
    allowedEvents: ["schedule", "workflow_dispatch"],
  },
] as const;

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

  try {
    const { payload } = await jwtVerify(token, githubJwks, {
      issuer: GITHUB_OIDC_ISSUER,
      audience: [...GITHUB_OIDC_AUDIENCES],
      algorithms: ["RS256"],
    });

    const trustedWorkflow = TRUSTED_GITHUB_WORKFLOWS.find(
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
 * Authorizes either the existing shared CRON_SECRET or the short-lived OIDC token
 * issued by GitHub specifically to this repository's production refresh workflow.
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
