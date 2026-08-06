import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const client = await readFile(new URL("../site/identity-client.js", import.meta.url), "utf8");
const page = await readFile(new URL("../site/index.html", import.meta.url), "utf8");

test("hosts one shared account control on the identity origin", () => {
  assert.match(page, /data-hara-identity/);
  assert.match(page, /src="\/identity-client\.js"/);
  assert.match(client, /\/github\/start/);
  assert.match(client, /\/session/);
  assert.match(client, /\/logout/);
  assert.match(client, /credentials:\s*"include"/);
  assert.match(client, /hara-identity-auto/);
});

test("the client displays the stable GitHub identity without handling provider tokens", () => {
  assert.match(client, /profile\.id/);
  assert.match(client, /profile\.login/);
  assert.match(client, /profile\.avatarUrl/);
  assert.doesNotMatch(client, /access_token|client_secret|HARA_GITHUB_OAUTH_CLIENT_SECRET/);
});
