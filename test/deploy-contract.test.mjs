import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { once } from "node:events";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  ".github",
  "scripts",
  "verify-identity-service.sh",
);

function json(response, status, payload, headers = {}) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    ...headers,
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

function runVerifier(env) {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", [SCRIPT], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

test("deployment probe verifies the live identity boundary and fails closed", async (t) => {
  let configured = true;
  const returnOrigin = "http://127.0.0.1:9876";
  let origin;

  const server = createServer((request, response) => {
    const url = new URL(request.url, origin);

    if (request.method === "GET" && url.pathname === "/.well-known/hara-session") {
      return json(response, 200, {
        issuer: origin,
        provider: "github",
        authorizationEndpoint: `${origin}/github/start`,
        callbackEndpoint: `${origin}/auth/github/callback`,
        sessionEndpoint: `${origin}/session`,
        logoutEndpoint: `${origin}/logout`,
        allowedOrigins: [returnOrigin],
        configured,
      });
    }

    if (request.method === "GET" && url.pathname === "/session") {
      const requestOrigin = request.headers.origin;
      if (requestOrigin === "https://untrusted.example") {
        return json(response, 403, {
          error: { code: "ORIGIN_NOT_ALLOWED", message: "Not allowed." },
        });
      }
      return json(response, 200, {
        authenticated: false,
        configured,
        issuer: "hara-id",
        profile: null,
        user: null,
        identity: null,
      }, {
        "access-control-allow-origin": requestOrigin,
        "access-control-allow-credentials": "true",
      });
    }

    if (request.method === "GET" && url.pathname === "/github/start") {
      const authorize = new URL("https://github.com/login/oauth/authorize");
      authorize.searchParams.set("client_id", "test-client");
      authorize.searchParams.set("redirect_uri", `${origin}/auth/github/callback`);
      authorize.searchParams.set("state", "test-state");
      authorize.searchParams.set("code_challenge", "test-challenge");
      authorize.searchParams.set("code_challenge_method", "S256");
      response.writeHead(302, {
        location: authorize.toString(),
        "set-cookie": [
          "hara_id_oauth_state=test-state; Path=/auth/github/callback; HttpOnly; SameSite=Lax",
          "hara_id_oauth_verifier=test-verifier; Path=/auth/github/callback; HttpOnly; SameSite=Lax",
          "hara_id_oauth_return=test-return; Path=/auth/github/callback; HttpOnly; SameSite=Lax",
        ],
      });
      return response.end();
    }

    if (request.method === "GET" && url.pathname === "/identity-client.js") {
      response.writeHead(200, { "content-type": "application/javascript" });
      return response.end("globalThis.HaraIdentity = {};\n");
    }

    if (request.method === "POST" && url.pathname === "/logout") {
      response.writeHead(204, {
        "access-control-allow-origin": request.headers.origin,
        "access-control-allow-credentials": "true",
        "set-cookie": "hara_identity_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax",
      });
      return response.end();
    }

    response.writeHead(404);
    return response.end();
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const address = server.address();
  origin = `http://127.0.0.1:${address.port}`;

  const ready = await runVerifier({
    HARA_IDENTITY_ORIGIN: origin,
    HARA_IDENTITY_EXPECTED_RETURN_ORIGIN: returnOrigin,
  });
  assert.equal(ready.code, 0, ready.stderr);
  assert.match(ready.stdout, /Verified GitHub OAuth readiness/);

  configured = false;
  const unconfigured = await runVerifier({
    HARA_IDENTITY_ORIGIN: origin,
    HARA_IDENTITY_EXPECTED_RETURN_ORIGIN: returnOrigin,
  });
  assert.notEqual(unconfigured.code, 0);
  assert.match(unconfigured.stderr, /not production-ready/);
  assert.match(unconfigured.stderr, /"configured":false/);
});
