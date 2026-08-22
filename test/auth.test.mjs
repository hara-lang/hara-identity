import assert from "node:assert/strict";
import test from "node:test";
import {
  OAUTH_RETURN_COOKIE,
  OAUTH_STATE_COOKIE,
  OAUTH_VERIFIER_COOKIE,
  SESSION_COOKIE,
  allowedOrigins,
  buildGitHubAuthorizeUrl,
  createOAuthAttempt,
  parseCookies,
  safeReturnTo,
  sessionCookie,
  signSession,
  verifySession,
} from "../netlify/functions/auth-lib.mjs";
import { handle } from "../netlify/functions/auth.mjs";

const SECRET = "s".repeat(64);
const ENV = {
  HARA_GITHUB_OAUTH_CLIENT_ID: "client-id",
  HARA_GITHUB_OAUTH_CLIENT_SECRET: "client-secret",
  HARA_AUTH_SESSION_SECRET: SECRET,
};

function cookieHeaderFromSetCookie(value) {
  const names = [OAUTH_STATE_COOKIE, OAUTH_VERIFIER_COOKIE, OAUTH_RETURN_COOKIE, SESSION_COOKIE];
  return names.flatMap((name) => {
    const match = value.match(new RegExp(`(?:^|,\\s*)(${name}=[^;]*)`));
    return match ? [match[1]] : [];
  }).join("; ");
}

test("uses exact production and testing origin allowlists", () => {
  const production = allowedOrigins({}, "https://id.hara-lang.org/session");
  assert.ok(production.has("https://www.hara-lang.org"));
  assert.ok(production.has("https://build.hara-lang.org"));
  assert.ok(production.has("https://packages.hara-lang.org"));
  assert.equal(production.has("https://www.testing.hara-lang.org"), false);

  const testing = allowedOrigins({}, "https://id.testing.hara-lang.org/session");
  assert.ok(testing.has("https://www.testing.hara-lang.org"));
  assert.equal(testing.has("https://www.hara-lang.org"), false);
});

test("only returns to exact Hara origins", () => {
  const request = "https://id.hara-lang.org/github/start";
  assert.equal(
    safeReturnTo("https://build.hara-lang.org/registry?q=hal#top", request, {}),
    "https://build.hara-lang.org/registry?q=hal#top",
  );
  assert.equal(safeReturnTo("https://evil.example/", request, {}), "https://id.hara-lang.org/");
  assert.equal(safeReturnTo("//evil.example/", request, {}), "https://id.hara-lang.org/");
  assert.equal(safeReturnTo("https://build.hara-lang.org.evil.example/", request, {}), "https://id.hara-lang.org/");
});

test("creates S256 PKCE authorization attempts", () => {
  const attempt = createOAuthAttempt("https://www.hara-lang.org/docs", "https://id.hara-lang.org/github/start", {});
  assert.ok(attempt.state.length >= 40);
  assert.ok(attempt.verifier.length >= 43);
  assert.ok(attempt.challenge.length >= 43);
  assert.notEqual(attempt.verifier, attempt.challenge);
  const url = new URL(buildGitHubAuthorizeUrl({
    clientId: "abc",
    redirectUri: "https://id.hara-lang.org/auth/github/callback",
    state: attempt.state,
    challenge: attempt.challenge,
  }));
  assert.equal(url.origin, "https://github.com");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("state"), attempt.state);
});

test("signs one host-only identity session accepted by every relying site", () => {
  const user = { id: "1455572", login: "hoebat", name: "Hoebat" };
  const token = signSession(user, SECRET, { issuer: "https://id.hara-lang.org", now: 1_700_000_000_000 });
  const profile = verifySession(token, SECRET, { issuer: "https://id.hara-lang.org", now: 1_700_000_001_000 });
  assert.deepEqual(profile, {
    id: "1455572",
    provider: "github",
    login: "hoebat",
    name: "Hoebat",
    avatarUrl: "https://avatars.githubusercontent.com/u/1455572?v=4",
    profileUrl: "https://github.com/hoebat",
    expiresAt: "2023-11-21T22:13:20.000Z",
  });
  assert.equal(verifySession(token, SECRET, { issuer: "https://id.testing.hara-lang.org", now: 1_700_000_001_000 }), null);
  const cookie = sessionCookie(token, "https://id.hara-lang.org/");
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.doesNotMatch(cookie, /Domain=/i);
});

test("starts OAuth centrally and binds the original site return URL", async () => {
  const response = await handle(new Request(
    "https://id.hara-lang.org/github/start?returnTo=https%3A%2F%2Fpackages.hara-lang.org%2F",
  ), { env: ENV });
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get("location"));
  assert.equal(location.origin, "https://github.com");
  assert.equal(location.searchParams.get("redirect_uri"), "https://id.hara-lang.org/auth/github/callback");
  assert.equal(location.searchParams.get("code_challenge_method"), "S256");
  const cookies = response.headers.get("set-cookie");
  assert.match(cookies, new RegExp(OAUTH_STATE_COOKIE));
  assert.match(cookies, new RegExp(OAUTH_VERIFIER_COOKIE));
  assert.match(cookies, new RegExp(OAUTH_RETURN_COOKIE));
  assert.doesNotMatch(cookies, /Domain=/i);
});

test("completes GitHub OAuth without retaining the provider token", async () => {
  const start = await handle(new Request(
    "https://id.hara-lang.org/github/start?returnTo=https%3A%2F%2Fbuild.hara-lang.org%2Fregistry",
  ), { env: ENV });
  const startCookies = cookieHeaderFromSetCookie(start.headers.get("set-cookie"));
  const parsed = parseCookies(startCookies);
  assert.ok(parsed[OAUTH_STATE_COOKIE]);
  assert.ok(parsed[OAUTH_VERIFIER_COOKIE]);

  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url: String(url), init });
    if (String(url).includes("access_token")) {
      return Response.json({ access_token: "temporary-provider-token" });
    }
    return Response.json({ id: 1455572, login: "hoebat", name: "Hoebat" });
  };
  const callback = await handle(new Request(
    `https://id.hara-lang.org/auth/github/callback?code=abc&state=${encodeURIComponent(parsed[OAUTH_STATE_COOKIE])}`,
    { headers: { Cookie: startCookies } },
  ), { env: ENV, fetchImpl, now: 1_700_000_000_000 });

  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get("location"), "https://build.hara-lang.org/registry");
  const setCookie = callback.headers.get("set-cookie");
  assert.match(setCookie, new RegExp(SESSION_COOKIE));
  assert.doesNotMatch(setCookie, /temporary-provider-token/);
  assert.equal(seen.length, 2);
  assert.match(seen[1].init.headers.Authorization, /temporary-provider-token/);
});

test("shares session state through credentialed exact-origin CORS", async () => {
  const token = signSession({ id: "1455572", login: "hoebat", name: null }, SECRET, {
    issuer: "https://id.hara-lang.org",
  });
  const response = await handle(new Request("https://id.hara-lang.org/session", {
    headers: {
      Origin: "https://www.hara-lang.org",
      Cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    },
  }), { env: ENV });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "https://www.hara-lang.org");
  assert.equal(response.headers.get("access-control-allow-credentials"), "true");
  const body = await response.json();
  assert.equal(body.authenticated, true);
  assert.equal(body.profile.id, "1455572");
  assert.equal(body.profile.login, "hoebat");
  assert.deepEqual(body.user, body.profile);
  assert.deepEqual(body.identity, { provider: "github", subject: "1455572", login: "hoebat" });
});

test("does not expose a session to an untrusted origin", async () => {
  const response = await handle(new Request("https://id.hara-lang.org/session", {
    headers: { Origin: "https://evil.example" },
  }), { env: ENV });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.match(await response.text(), /ORIGIN_NOT_ALLOWED/);
});

test("signs out centrally and clears the host-only cookie", async () => {
  const response = await handle(new Request("https://id.hara-lang.org/logout", {
    method: "POST",
    headers: {
      Origin: "https://packages.hara-lang.org",
      "X-Hara-Request": "sign-out",
    },
  }), { env: ENV });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "https://packages.hara-lang.org");
  assert.match(response.headers.get("set-cookie"), new RegExp(`${SESSION_COOKIE}=;`));
  assert.doesNotMatch(response.headers.get("set-cookie"), /Domain=/i);
});

test("reports an unconfigured deployment without failing session discovery", async () => {
  const response = await handle(new Request("https://id.hara-lang.org/session", {
    headers: { Origin: "https://build.hara-lang.org" },
  }), { env: {} });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    authenticated: false,
    configured: false,
    issuer: "hara-id",
    profile: null,
    user: null,
    identity: null,
  });
});
