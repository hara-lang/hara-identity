import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const config = await readFile(new URL("../netlify.toml", import.meta.url), "utf8");

test("the versioned Identity client is available to cross-origin-isolated consumers", () => {
  assert.match(
    config,
    /\[\[redirects\]\][\s\S]*?from = "\/v1\/identity-client\.js"[\s\S]*?to = "\/identity-client\.js"[\s\S]*?status = 200[\s\S]*?force = true/,
  );

  const versionedHeaders = config.match(
    /\[\[headers\]\]\s*\n\s*for = "\/v1\/identity-client\.js"[\s\S]*?(?=\n\[\[headers\]\]|$)/,
  )?.[0] || "";
  assert.match(versionedHeaders, /Cross-Origin-Resource-Policy = "cross-origin"/);
  assert.match(versionedHeaders, /X-Content-Type-Options = "nosniff"/);

  const sourceHeaders = config.match(
    /\[\[headers\]\]\s*\n\s*for = "\/identity-client\.js"[\s\S]*?(?=\n\[\[headers\]\]|$)/,
  )?.[0] || "";
  assert.match(sourceHeaders, /Cross-Origin-Resource-Policy = "cross-origin"/);
});
