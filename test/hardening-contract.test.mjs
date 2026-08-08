import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("throttles OAuth, handoff, and global logout surfaces", async () => {
  const [auth, handoff, logout] = await Promise.all([
    read("netlify/functions/auth.mjs"),
    read("netlify/functions/handoff.mjs"),
    read("netlify/functions/global-logout.mjs"),
  ]);
  for (const source of [auth, handoff, logout]) assert.match(source, /rateLimit/);
});

test("cleans expired handoffs hourly and sends the account control through front-channel logout", async () => {
  const [cleanup, client, script] = await Promise.all([
    read("netlify/functions/handoff-cleanup.mjs"),
    read("site/identity-client.js"),
    read(".github/scripts/verify-world-handoff.sh"),
  ]);
  assert.match(cleanup, /@hourly/);
  assert.match(client, /\/logout\/global/);
  assert.match(client, /location\.assign/);
  assert.match(script, /hara_world_session=;/);
});
