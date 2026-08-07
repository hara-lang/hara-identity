import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { config, handle } from "../netlify/functions/auth.mjs";

const ENV = {
  HARA_GITHUB_OAUTH_CLIENT_ID: "client-id",
  HARA_GITHUB_OAUTH_CLIENT_SECRET: "client-secret",
  HARA_AUTH_SESSION_SECRET: "s".repeat(64),
};

test("publishes contract v1 without regressing current hardening", async () => {
  const response = await handle(new Request("https://id.hara-lang.org/.well-known/hara-session"), {
    env: ENV,
  });
  assert.equal(response.status, 200);
  const discovery = await response.json();
  assert.equal(discovery.contractVersion, 1);
  assert.equal(discovery.clientVersion, 1);
  assert.equal(discovery.clientEndpoint, "https://id.hara-lang.org/v1/identity-client.js");
  assert.equal(discovery.legacyClientEndpoint, "https://id.hara-lang.org/identity-client.js");
  assert.equal(discovery.globalLogoutEndpoint, "https://id.hara-lang.org/logout/global");
  assert.ok(discovery.allowedOrigins.includes("https://www.hara-lang.org"));
  assert.ok(discovery.allowedOrigins.includes("https://specs.hara-lang.org"));
  assert.ok(discovery.allowedOrigins.includes("https://packages.hara-lang.org"));
  assert.ok(discovery.allowedOrigins.includes("https://id.hara-lang.org"));
  assert.ok(discovery.allowedOrigins.includes("https://world.hara-lang.org"));
  assert.deepEqual(config.rateLimit, {
    windowLimit: 240,
    windowSize: 60,
    aggregateBy: ["ip", "domain"],
  });
});

test("keeps testing and production contracts isolated", async () => {
  const response = await handle(new Request("https://id.testing.hara-lang.org/.well-known/hara-session"), {
    env: ENV,
  });
  const discovery = await response.json();
  assert.equal(discovery.issuer, "https://id.testing.hara-lang.org");
  assert.equal(discovery.clientEndpoint, "https://id.testing.hara-lang.org/v1/identity-client.js");
  for (const origin of [
    "https://www.testing.hara-lang.org",
    "https://specs.testing.hara-lang.org",
    "https://packages.testing.hara-lang.org",
    "https://id.testing.hara-lang.org",
    "https://world.testing.hara-lang.org",
  ]) assert.ok(discovery.allowedOrigins.includes(origin), origin);
  assert.equal(discovery.allowedOrigins.includes("https://www.hara-lang.org"), false);
});

test("publishes and verifies both client URLs", async () => {
  const netlify = await readFile(new URL("../netlify.toml", import.meta.url), "utf8");
  const verifier = await readFile(new URL("../.github/scripts/verify-identity-consumer.sh", import.meta.url), "utf8");
  const workflow = await readFile(new URL("../.github/workflows/pages.yml", import.meta.url), "utf8");
  assert.match(netlify, /from = "\/v1\/identity-client\.js"/);
  assert.match(netlify, /to = "\/identity-client\.js"/);
  assert.match(netlify, /for = "\/v1\/identity-client\.js"/);
  assert.match(verifier, /\.contractVersion == 1/);
  assert.match(verifier, /\.clientVersion == 1/);
  assert.match(verifier, /\.globalLogoutEndpoint/);
  assert.match(verifier, /verify-identity-service\.sh/);
  assert.match(workflow, /www\.testing\.hara-lang\.org[\s\S]*specs\.testing\.hara-lang\.org[\s\S]*packages\.testing\.hara-lang\.org[\s\S]*id\.testing\.hara-lang\.org[\s\S]*world\.testing\.hara-lang\.org/);
  assert.match(workflow, /www\.hara-lang\.org[\s\S]*specs\.hara-lang\.org[\s\S]*packages\.hara-lang\.org[\s\S]*id\.hara-lang\.org[\s\S]*world\.hara-lang\.org/);
  assert.match(workflow, /verify-world-handoff\.sh/);
});
