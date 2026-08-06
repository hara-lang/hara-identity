import assert from "node:assert/strict";
import test from "node:test";
import { handle } from "../netlify/functions/auth.mjs";

const ENV = {
  HARA_GITHUB_OAUTH_CLIENT_ID: "client-id",
  HARA_GITHUB_OAUTH_CLIENT_SECRET: "client-secret",
  HARA_AUTH_SESSION_SECRET: "s".repeat(64),
};

async function discovery(origin) {
  const response = await handle(new Request(`${origin}/.well-known/hara-session`), { env: ENV });
  assert.equal(response.status, 200);
  return response.json();
}

test("World is an exact first-party origin in the matching environment", async () => {
  const production = await discovery("https://id.hara-lang.org");
  assert.ok(production.allowedOrigins.includes("https://world.hara-lang.org"));
  assert.equal(production.allowedOrigins.includes("https://world.testing.hara-lang.org"), false);

  const testing = await discovery("https://id.testing.hara-lang.org");
  assert.ok(testing.allowedOrigins.includes("https://world.testing.hara-lang.org"));
  assert.equal(testing.allowedOrigins.includes("https://world.hara-lang.org"), false);
});

test("World can read the central session only from its exact matching origin", async () => {
  const production = await handle(new Request("https://id.hara-lang.org/session", {
    headers: { Origin: "https://world.hara-lang.org" },
  }), { env: ENV });
  assert.equal(production.status, 200);
  assert.equal(production.headers.get("access-control-allow-origin"), "https://world.hara-lang.org");
  assert.equal(production.headers.get("access-control-allow-credentials"), "true");

  const productionRejectsTesting = await handle(new Request("https://id.hara-lang.org/session", {
    headers: { Origin: "https://world.testing.hara-lang.org" },
  }), { env: ENV });
  assert.equal(productionRejectsTesting.status, 403);
  assert.equal(productionRejectsTesting.headers.has("access-control-allow-origin"), false);

  const testing = await handle(new Request("https://id.testing.hara-lang.org/session", {
    headers: { Origin: "https://world.testing.hara-lang.org" },
  }), { env: ENV });
  assert.equal(testing.status, 200);
  assert.equal(testing.headers.get("access-control-allow-origin"), "https://world.testing.hara-lang.org");

  const testingRejectsProduction = await handle(new Request("https://id.testing.hara-lang.org/session", {
    headers: { Origin: "https://world.hara-lang.org" },
  }), { env: ENV });
  assert.equal(testingRejectsProduction.status, 403);
  assert.equal(testingRejectsProduction.headers.has("access-control-allow-origin"), false);
});

test("OAuth may return to the exact World page without broadening the cookie", async () => {
  const returnTo = "https://world.hara-lang.org/me?from=identity#account";
  const response = await handle(new Request(
    `https://id.hara-lang.org/github/start?returnTo=${encodeURIComponent(returnTo)}`,
  ), { env: ENV });

  assert.equal(response.status, 302);
  assert.equal(new URL(response.headers.get("location")).origin, "https://github.com");

  const cookies = response.headers.get("set-cookie");
  assert.match(cookies, /hara_id_oauth_return=https%3A%2F%2Fworld\.hara-lang\.org%2Fme%3Ffrom%3Didentity%23account/);
  assert.doesNotMatch(cookies, /Domain=/i);
});
