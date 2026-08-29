import test from "node:test";
import assert from "node:assert/strict";
import { identityUrl, handle } from "../netlify/functions/identity.mjs";

const BASE = "https://id.hara-lang.org";

test("identityUrl only permits main or a 40-character commit", () => {
  assert.equal(
    identityUrl("main"),
    "https://raw.githubusercontent.com/hara-lang/hara-identity/main/identity.edn",
  );
  assert.equal(
    identityUrl("a".repeat(40)),
    `https://raw.githubusercontent.com/hara-lang/hara-identity/${"a".repeat(40)}/identity.edn`,
  );
  assert.throws(() => identityUrl("../../etc/passwd"));
  assert.throws(() => identityUrl("A".repeat(40)));
  assert.throws(() => identityUrl("abc123"));
  assert.throws(() => identityUrl(""));
});

test("discovery document is served with a one-hour cache", async () => {
  const res = await handle(new Request(`${BASE}/.well-known/hara-tap.edn`));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/edn; charset=utf-8");
  assert.equal(res.headers.get("cache-control"), "public, max-age=3600");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  const body = await res.text();
  assert.match(body, /:tap\/name "hara"/);
  assert.match(body, /:tap\/identity "https:\/\/id\.hara-lang\.org"/);
  assert.match(body, /:tap\/registry "https:\/\/packages\.hara-lang\.org"/);
});

test("identity main resolves to an exact revision before serving an immutable document", async () => {
  const commit = "c".repeat(40);
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    if (url.endsWith("/commits/main")) return new Response(JSON.stringify({ sha: commit }), { status: 200 });
    return new Response('{:identity/name "hara"}\n', { status: 200 });
  };
  const res = await handle(new Request(`${BASE}/v1/identity`), fetchImpl);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal(res.headers.get("x-hara-authority"), "git");
  assert.equal(res.headers.get("x-hara-identity-revision"), commit);
  assert.equal(res.headers.get("content-type"), "application/edn; charset=utf-8");
  assert.deepEqual(seen, [
    "https://api.github.com/repos/hara-lang/hara-identity/commits/main",
    `https://raw.githubusercontent.com/hara-lang/hara-identity/${commit}/identity.edn`,
  ]);
  assert.equal(await res.text(), '{:identity/name "hara"}\n');
});

test("commit refs are immutable and cache forever", async () => {
  const sha = "b".repeat(40);
  const fetchImpl = async () => new Response("{}\n", { status: 200 });
  const res = await handle(new Request(`${BASE}/v1/identity?ref=${sha}`), fetchImpl);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal(res.headers.get("x-hara-identity-revision"), sha);
});

test("identity signatures are served only from an exact revision", async () => {
  const sha = "d".repeat(40);
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    return new Response("a".repeat(128) + "\n", { status: 200 });
  };
  const res = await handle(new Request(`${BASE}/v1/identity-signature?ref=${sha}`), fetchImpl);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.equal(res.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal(res.headers.get("x-hara-identity-revision"), sha);
  assert.deepEqual(seen, [
    `https://raw.githubusercontent.com/hara-lang/hara-identity/${sha}/identity.edn.sig`,
  ]);
});

test("an invalid ref is a 400 EDN problem that is never stored", async () => {
  let fetched = false;
  const fetchImpl = async () => {
    fetched = true;
    return new Response("x");
  };
  const res = await handle(new Request(`${BASE}/v1/identity?ref=../../etc/passwd`), fetchImpl);
  assert.equal(res.status, 400);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("content-type"), "application/edn; charset=utf-8");
  assert.equal(fetched, false);
  assert.match(await res.text(), /:error\/code :invalid-request/);
});

test("an upstream failure is a 502 EDN problem", async () => {
  const fetchImpl = async () => new Response("nope", { status: 404 });
  const res = await handle(new Request(`${BASE}/v1/identity`), fetchImpl);
  assert.equal(res.status, 502);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.match(await res.text(), /:error\/code :upstream-unavailable/);
});

test("non-GET/HEAD methods are rejected as read-only", async () => {
  for (const method of ["POST", "PUT", "DELETE"]) {
    const res = await handle(new Request(`${BASE}/v1/identity`, { method }));
    assert.equal(res.status, 405);
    assert.match(await res.text(), /:error\/code :method-not-allowed/);
  }
});

test("anything else routed to the function is a 404 EDN problem", async () => {
  const res = await handle(new Request(`${BASE}/v1/nope`));
  assert.equal(res.status, 404);
  assert.match(await res.text(), /:error\/code :not-found/);
});
