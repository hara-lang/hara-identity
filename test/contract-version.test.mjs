import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { handle } from "../netlify/functions/auth.mjs";

const ENV = {
  HARA_GITHUB_OAUTH_CLIENT_ID: "client-id",
  HARA_GITHUB_OAUTH_CLIENT_SECRET: "client-secret",
  HARA_AUTH_SESSION_SECRET: "s".repeat(64),
};

test("publishes a versioned discovery contract and stable client endpoints", async () => {
  const response = await handle(new Request("https://id.hara-lang.org/.well-known/hara-session"), {
    env: ENV,
  });
  assert.equal(response.status, 200);
  const discovery = await response.json();
  assert.equal(discovery.contractVersion, 1);
  assert.equal(discovery.clientVersion, 1);
  assert.equal(discovery.issuer, "https://id.hara-lang.org");
  assert.equal(discovery.clientEndpoint, "https://id.hara-lang.org/v1/identity-client.js");
  assert.equal(discovery.legacyClientEndpoint, "https://id.hara-lang.org/identity-client.js");
  assert.ok(discovery.allowedOrigins.includes("https://www.hara-lang.org"));
  assert.ok(discovery.allowedOrigins.includes("https://specs.hara-lang.org"));
  assert.ok(discovery.allowedOrigins.includes("https://packages.hara-lang.org"));
  assert.ok(discovery.allowedOrigins.includes("https://id.hara-lang.org"));
  assert.ok(discovery.allowedOrigins.includes("https://world.hara-lang.org"));
});

test("keeps testing and production contracts isolated", async () => {
  const response = await handle(new Request("https://id.testing.hara-lang.org/.well-known/hara-session"), {
    env: ENV,
  });
  const discovery = await response.json();
  assert.equal(discovery.issuer, "https://id.testing.hara-lang.org");
  assert.equal(discovery.clientEndpoint, "https://id.testing.hara-lang.org/v1/identity-client.js");
  assert.ok(discovery.allowedOrigins.includes("https://www.testing.hara-lang.org"));
  assert.ok(discovery.allowedOrigins.includes("https://specs.testing.hara-lang.org"));
  assert.ok(discovery.allowedOrigins.includes("https://packages.testing.hara-lang.org"));
  assert.ok(discovery.allowedOrigins.includes("https://id.testing.hara-lang.org"));
  assert.ok(discovery.allowedOrigins.includes("https://world.testing.hara-lang.org"));
  assert.equal(discovery.allowedOrigins.includes("https://www.hara-lang.org"), false);
});

test("publishes and verifies both identity client URLs", async () => {
  const netlify = await readFile(new URL("../netlify.toml", import.meta.url), "utf8");
  const verifier = await readFile(new URL("../.github/scripts/verify-identity-consumer.sh", import.meta.url), "utf8");
  assert.match(netlify, /from = "\/v1\/identity-client\.js"/);
  assert.match(netlify, /to = "\/identity-client\.js"/);
  assert.match(netlify, /for = "\/v1\/identity-client\.js"/);
  assert.match(verifier, /\.contractVersion == 1/);
  assert.match(verifier, /\.clientVersion == 1/);
  assert.match(verifier, /v1\/identity-client\.js/);
  assert.match(verifier, /verify-identity-service\.sh/);
});
