import { timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { NextRequest } from "next/server";

const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const GITHUB_OIDC_AUDIENCE = "https://0xstudybank.vercel.app";
const GITHUB_REPOSITORY = "Ssw7777/asset-monitor";
const GITHUB_MAIN_REF = "refs/heads/main";
const GITHUB_REFRESH_WORKFLOW_REF =
  "Ssw7777/asset-monitor/.github/workflows/production-refresh.yml@refs/heads/main";

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
      audience: GITHUB_OIDC_AUDIENCE,
    });

    return (
      payload.repository === GITHUB_REPOSITORY &&
      payload.ref === GITHUB_MAIN_REF &&
      payload.workflow_ref === GITHUB_REFRESH_WORKFLOW_REF &&
      (payload.event_name === "schedule" || payload.event_name === "workflow_dispatch") &&
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
