import assert from "node:assert/strict";
import test from "node:test";
import { signSession, SESSION_COOKIE, pkceChallenge, randomToken } from "../netlify/functions/auth-lib.mjs";
import { createMemoryHandoffStore } from "../netlify/functions/_shared/handoff.mjs";
import { handle } from "../netlify/functions/handoff.mjs";

const SECRET = "s".repeat(64);
const HANDOFF_SECRET = "w".repeat(64);
const ENV = {
  HARA_GITHUB_OAUTH_CLIENT_ID: "github-client",
  HARA_GITHUB_OAUTH_CLIENT_SECRET: "github-secret",
  HARA_AUTH_SESSION_SECRET: SECRET,
  HARA_LEARN_HANDOFF_SECRET: HANDOFF_SECRET,
};
const NOW = Date.parse("2026-08-07T00:00:00Z");

function authorizeUrl({ state=randomToken(32), verifier=randomToken(48), redirect="https://learn.hara-lang.org/api/auth/callback" }={}) {
  const url = new URL("https://id.hara-lang.org/v1/handoffs/authorize");
  url.searchParams.set("client_id", "learn");
  url.searchParams.set("redirect_uri", redirect);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", pkceChallenge(verifier));
  url.searchParams.set("code_challenge_method", "S256");
  return { url, state, verifier };
}

function centralCookie() {
  const token = signSession({ id: "6685337", login: "zcaudate", name: "Chris" }, SECRET, {
    issuer: "https://id.hara-lang.org",
    now: NOW,
  });
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}`;
}

function basic() {
  return `Basic ${Buffer.from(`learn:${HANDOFF_SECRET}`).toString("base64")}`;
}

test("publishes a fail-closed handoff discovery document", async () => {
  const response = await handle(new Request("https://id.hara-lang.org/.well-known/hara-handoff"), { env: ENV });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.configured, true);
  assert.equal(body.authorizationEndpoint, "https://id.hara-lang.org/v1/handoffs/authorize");
  assert.equal(body.clients[0].redirectUri, "https://learn.hara-lang.org/api/auth/callback");
});

test("requires the central session before issuing a Learn code", async () => {
  const { url } = authorizeUrl();
  const response = await handle(new Request(url), { env: ENV, now: NOW, store: createMemoryHandoffStore() });
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get("location"));
  assert.equal(location.pathname, "/github/start");
  assert.equal(location.searchParams.get("returnTo"), url.toString());
});

test("issues a PKCE-bound code and exchanges it once server-to-server", async () => {
  const store = createMemoryHandoffStore();
  const { url, state, verifier } = authorizeUrl();
  const authorize = await handle(new Request(url, { headers: { Cookie: centralCookie() } }), { env: ENV, now: NOW, store });
  assert.equal(authorize.status, 302);
  const callback = new URL(authorize.headers.get("location"));
  assert.equal(callback.origin, "https://learn.hara-lang.org");
  assert.equal(callback.searchParams.get("state"), state);
  const code = callback.searchParams.get("code");
  assert.ok(code);

  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    redirect_uri: "https://learn.hara-lang.org/api/auth/callback",
  });
  const request = () => new Request("https://id.hara-lang.org/v1/handoffs/token", {
    method: "POST",
    headers: { Authorization: basic(), "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  const exchanged = await handle(request(), { env: ENV, now: NOW + 1000, store });
  assert.equal(exchanged.status, 200);
  const body = await exchanged.json();
  assert.equal(body.handoff.audience, "learn");
  assert.equal(body.handoff.subject, "github:6685337");
  assert.equal(body.handoff.identity.login, "zcaudate");
  assert.doesNotMatch(JSON.stringify(body), /github-secret|access_token/);

  const replay = await handle(request(), { env: ENV, now: NOW + 2000, store });
  assert.equal(replay.status, 400);
  assert.equal((await replay.json()).error.code, "HANDOFF_CODE_INVALID");
});

test("rejects cross-environment callbacks and incorrect client credentials", async () => {
  const bad = authorizeUrl({ redirect: "https://learn.testing.hara-lang.org/api/auth/callback" });
  const authorize = await handle(new Request(bad.url, { headers: { Cookie: centralCookie() } }), { env: ENV, now: NOW, store: createMemoryHandoffStore() });
  assert.equal(authorize.status, 400);
  assert.equal((await authorize.json()).error.code, "HANDOFF_REDIRECT_INVALID");

  const response = await handle(new Request("https://id.hara-lang.org/v1/handoffs/token", {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from("learn:wrong").toString("base64")}` },
    body: new URLSearchParams(),
  }), { env: ENV, now: NOW, store: createMemoryHandoffStore() });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("www-authenticate"), "Basic realm=\"hara-handoff\"");
});
