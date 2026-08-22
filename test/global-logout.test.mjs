import assert from "node:assert/strict";
import test from "node:test";
import { SESSION_COOKIE } from "../netlify/functions/auth-lib.mjs";
import { handle } from "../netlify/functions/global-logout.mjs";

test("clears Identity and chains production logout through Learn", async () => {
  const response = await handle(new Request(
    "https://id.hara-lang.org/logout/global?returnTo=https%3A%2F%2Fpackages.hara-lang.org%2F",
  ), { env: {} });
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get("location"));
  assert.equal(location.origin, "https://learn.hara-lang.org");
  assert.equal(location.pathname, "/api/auth/logout");
  assert.equal(location.searchParams.get("source"), "hara-identity");
  assert.equal(location.searchParams.get("returnTo"), "https://packages.hara-lang.org/");
  assert.match(response.headers.get("set-cookie"), new RegExp(`${SESSION_COOKIE}=;`));
  assert.doesNotMatch(response.headers.get("set-cookie"), /Domain=/i);
});

test("keeps testing and production logout environments isolated", async () => {
  const testing = await handle(new Request(
    "https://id.testing.hara-lang.org/logout/global?returnTo=https%3A%2F%2Flearn.testing.hara-lang.org%2Fme",
  ), { env: {} });
  assert.equal(new URL(testing.headers.get("location")).origin, "https://learn.testing.hara-lang.org");

  const crossEnvironment = await handle(new Request(
    "https://id.hara-lang.org/logout/global?returnTo=https%3A%2F%2Flearn.testing.hara-lang.org%2Fme",
  ), { env: {} });
  const location = new URL(crossEnvironment.headers.get("location"));
  assert.equal(location.origin, "https://learn.hara-lang.org");
  assert.equal(location.searchParams.get("returnTo"), "https://id.hara-lang.org/");
});

test("rejects non-GET global logout requests", async () => {
  const response = await handle(new Request("https://id.hara-lang.org/logout/global", { method: "POST" }));
  assert.equal(response.status, 405);
});
