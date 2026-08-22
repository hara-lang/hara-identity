import assert from "node:assert/strict";
import test from "node:test";
import { handle as handleIdentity } from "../netlify/functions/auth.mjs";
import { handle as handleGlobalLogout } from "../netlify/functions/global-logout.mjs";

const productionOrigins = [
  "https://docs.hara-lang.org",
  "https://playground.hara-lang.org",
  "https://learn.hara-lang.org",
];
const testingOrigins = [
  "https://docs.testing.hara-lang.org",
  "https://playground.testing.hara-lang.org",
  "https://learn.testing.hara-lang.org",
];

test("publishes Docs and Playground in the exact production and testing allowlists", async () => {
  const production = await handleIdentity(new Request("https://id.hara-lang.org/.well-known/hara-session"), { env: {} });
  const productionBody = await production.json();
  for (const origin of productionOrigins) assert.ok(productionBody.allowedOrigins.includes(origin), `missing ${origin}`);
  for (const origin of testingOrigins) assert.equal(productionBody.allowedOrigins.includes(origin), false, `production leaked ${origin}`);

  const testing = await handleIdentity(new Request("https://id.testing.hara-lang.org/.well-known/hara-session"), { env: {} });
  const testingBody = await testing.json();
  for (const origin of testingOrigins) assert.ok(testingBody.allowedOrigins.includes(origin), `missing ${origin}`);
  for (const origin of productionOrigins) assert.equal(testingBody.allowedOrigins.includes(origin), false, `testing leaked ${origin}`);
});

test("allows credentialed session reads from Docs and Playground only in the matching environment", async () => {
  for (const origin of ["https://docs.hara-lang.org", "https://playground.hara-lang.org"]) {
    const response = await handleIdentity(new Request("https://id.hara-lang.org/session", { headers: { Origin: origin } }), { env: {} });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), origin);
    assert.equal(response.headers.get("access-control-allow-credentials"), "true");
  }

  const rejected = await handleIdentity(new Request("https://id.hara-lang.org/session", {
    headers: { Origin: "https://playground.testing.hara-lang.org" },
  }), { env: {} });
  assert.equal(rejected.status, 403);
});

test("preserves exact Docs and Playground return URLs through global logout", async () => {
  for (const returnTo of [
    "https://docs.hara-lang.org/reference/",
    "https://playground.hara-lang.org/?project=hara-lang/hara",
  ]) {
    const request = new Request(`https://id.hara-lang.org/logout/global?returnTo=${encodeURIComponent(returnTo)}`);
    const response = await handleGlobalLogout(request, { env: {} });
    assert.equal(response.status, 302);
    const location = new URL(response.headers.get("location"));
    assert.equal(location.origin, "https://learn.hara-lang.org");
    assert.equal(location.pathname, "/api/auth/logout");
    assert.equal(location.searchParams.get("returnTo"), returnTo);
  }
});
