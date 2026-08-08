import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [page, pageStyles, tokens, theme, themeScript, shell, toggle, source] = await Promise.all([
  read("../site/index.html"),
  read("../site/page.css"),
  read("../site/vendor/visual-language/tokens.css"),
  read("../site/vendor/visual-language/theme.css"),
  read("../site/vendor/visual-language/theme.js"),
  read("../site/public-shell.css"),
  read("../site/theme-toggle.js"),
  read("../site/vendor/visual-language/SOURCE.md"),
]);

test("identity consumes the public visual-language layer instead of editor tokens", () => {
  assert.match(page, /vendor\/visual-language\/theme\.css/);
  assert.match(page, /public-shell\.css/);
  assert.match(page, /vendor\/visual-language\/hara-logo\.svg/);
  assert.doesNotMatch(page, /vendor\/hara-ui\/tokens\.css/);
  assert.match(source, /hara-lang\/visual-language/);
  assert.match(source, /v1\.0\.0/);
});

test("identity uses frost, graphite and one public signal colour", () => {
  assert.match(tokens, /--hara-signal: #2f7cff/);
  assert.match(tokens, /--hara-void: #050608/);
  assert.match(tokens, /--hara-frost: #f4f6f8/);
  assert.match(pageStyles, /var\(--hara-signal\)/);
  assert.match(pageStyles, /var\(--hara-surface-solid\)/);
  assert.doesNotMatch(pageStyles, /#41f5e4|#ff2e88|#9c7bff|--hara-spectrum|--hara-cyan|--hara-magenta|--hara-violet|--hara-glow/);
});

test("theme and accessibility behaviour stay shared with the Hara domain", () => {
  assert.match(theme, /@import "\.\/tokens\.css"/);
  assert.match(theme, /:focus-visible/);
  assert.match(theme, /prefers-reduced-motion/);
  assert.match(themeScript, /Domain=hara-lang\.org/);
  assert.match(themeScript, /system", "light", "dark/);
  assert.match(toggle, /cycleTheme/);
  assert.match(shell, /data-hara-theme-label/);
  assert.match(page, /aria-label="Change colour theme"/);
});

test("the visual migration preserves identity and trust coordinates", () => {
  assert.match(page, /src="\/identity-client\.js"/);
  assert.match(page, /data-hara-identity/);
  assert.match(page, /\/\.well-known\/hara-session/);
  assert.match(page, /href="\/session"/);
  assert.match(page, /href="\/v1\/identity"/);
  assert.match(page, /\/\.well-known\/hara-tap\.edn/);
  assert.match(page, /638ad43d5840a7013e5462d0a52da429774257b8ec0a0794e6818aaa0aa835a2/);
});
