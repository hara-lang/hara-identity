import {
  clearSessionCookie,
  redirectResponse,
  safeReturnTo,
} from "./auth-lib.mjs";

const FIRST_PARTY_RELYING_ORIGINS = Object.freeze({
  production: Object.freeze([
    "https://learn.hara-lang.org",
    "https://docs.hara-lang.org",
    "https://playground.hara-lang.org",
  ]),
  testing: Object.freeze([
    "https://learn.testing.hara-lang.org",
    "https://docs.testing.hara-lang.org",
    "https://playground.testing.hara-lang.org",
  ]),
});

function isTestingIdentity(requestUrl) {
  const request = new URL(requestUrl);
  return request.hostname === "id.testing.hara-lang.org"
    || request.hostname.endsWith(".testing.hara-lang.org");
}

function learnOrigin(requestUrl) {
  return isTestingIdentity(requestUrl)
    ? "https://learn.testing.hara-lang.org"
    : "https://learn.hara-lang.org";
}

function effectiveEnv(env, requestUrl) {
  const configured = env?.HARA_AUTH_ALLOWED_ORIGINS || env?.AUTH_ALLOWED_ORIGINS || "";
  const origins = isTestingIdentity(requestUrl)
    ? FIRST_PARTY_RELYING_ORIGINS.testing
    : FIRST_PARTY_RELYING_ORIGINS.production;
  return {
    ...env,
    HARA_AUTH_ALLOWED_ORIGINS: [configured, ...origins].filter(Boolean).join(","),
  };
}

export async function handle(request, { env = process.env } = {}) {
  if (request.method !== "GET") {
    return new Response(`${JSON.stringify({ error: { code: "METHOD_NOT_ALLOWED", message: "Only GET is supported." } })}\n`, {
      status: 405,
      headers: { Allow: "GET", "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" },
    });
  }
  const url = new URL(request.url);
  const returnTo = safeReturnTo(url.searchParams.get("returnTo") ?? "/", request.url, effectiveEnv(env, request.url));
  const logout = new URL("/api/auth/logout", learnOrigin(request.url));
  logout.searchParams.set("source", "hara-identity");
  logout.searchParams.set("returnTo", returnTo);
  return redirectResponse(logout.toString(), {
    cookies: [clearSessionCookie(request.url)],
  });
}

export default async (request) => handle(request);

export const config = {
  path: "/logout/global",
  rateLimit: {
    windowLimit: 60,
    windowSize: 60,
    aggregateBy: ["ip", "domain"],
  },
};
