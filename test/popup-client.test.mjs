import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const client = await readFile(new URL("../site/identity-client.js", import.meta.url), "utf8");

test("supports an opt-in popup without exposing the parent to GitHub", () => {
  assert.match(client, /meta\[name="hara-identity-mode"\]/);
  assert.match(client, /identityMode === "popup"/);
  assert.match(client, /window\.open\("", `hara_identity_/);
  const openerReset = client.indexOf("popup.opener = null");
  const popupNavigation = client.indexOf("popup.location.replace");
  assert.ok(openerReset >= 0 && popupNavigation > openerReset);
  assert.match(client, /Opening GitHub sign-in/);
});

test("returns popup completion to the relying origin and refreshes the parent session", () => {
  assert.match(client, /hara_identity_popup/);
  assert.match(client, /BroadcastChannel/);
  assert.match(client, /localStorage\.setItem/);
  assert.match(client, /popup\.closed/);
  assert.match(client, /await refresh\(\)/);
  assert.match(client, /window\.close\(\)/);
  assert.match(client, /history\.replaceState/);
});

test("keeps full-page sign-in as the blocked-popup and no-JavaScript fallback", () => {
  assert.match(client, /account\.href = signInUrl\(\)/);
  assert.match(client, /if \(!popup\)[\s\S]*location\.assign\(signInUrl\(\)\)/);
  assert.match(client, /!popupEnabled[\s\S]*location\.assign\(signInUrl\(\)\)/);
  assert.match(client, /unmodifiedPrimaryClick/);
});

test("uses global logout when advertised and the legacy POST endpoint otherwise", () => {
  assert.match(client, /globalLogoutEndpoint/);
  assert.match(client, /endpoint\.pathname !== "\/logout\/global"/);
  assert.match(client, /fetch\(new URL\("\/logout", identityOrigin\)/);
  assert.match(client, /method: "POST"/);
});

test("the popup protocol carries no provider token or client secret", () => {
  assert.doesNotMatch(client, /access_token|client_secret|HARA_GITHUB_OAUTH_CLIENT_SECRET/);
  assert.match(client, /crypto\.getRandomValues/);
  assert.match(client, /\^\[a-f0-9\]\{48\}\$/);
});
