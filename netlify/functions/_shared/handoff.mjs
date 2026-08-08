import { createHash, timingSafeEqual } from "node:crypto";
import {
  AuthError,
  SESSION_COOKIE,
  isAuthConfigured,
  jsonResponse,
  parseCookies,
  pkceChallenge,
  randomToken,
  readSessionSecret,
  redirectResponse,
  verifySession,
} from "../auth-lib.mjs";

export const HANDOFF_AUTHORIZE_PATH = "/v1/handoffs/authorize";
export const HANDOFF_TOKEN_PATH = "/v1/handoffs/token";
export const HANDOFF_DISCOVERY_PATH = "/.well-known/hara-handoff";
export const HANDOFF_TTL_SECONDS = 5 * 60;
export const WORLD_CLIENT_ID = "world";

const STATE_PATTERN = /^[A-Za-z0-9_-]{32,256}$/;
const PKCE_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;
const CODE_PATTERN = /^[A-Za-z0-9_-]{32,256}$/;

function envValue(env, name, fallback = "") {
  const injected = env?.[name];
  if (typeof injected === "string" && injected.trim()) return injected.trim();
  const runtime = globalThis.Netlify?.env?.get?.(name);
  return typeof runtime === "string" && runtime.trim() ? runtime.trim() : fallback;
}

function isLoopback(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function isTestingIdentity(url) {
  return url.hostname === "id.testing.hara-lang.org"
    || url.hostname.endsWith(".testing.hara-lang.org");
}

function safeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function codeKey(code) {
  return `code/${createHash("sha256").update(code).digest("hex")}`;
}

function worldRedirectUri(requestUrl, env) {
  const request = new URL(requestUrl);
  if (isLoopback(request.hostname)) {
    const configured = envValue(env, "HARA_WORLD_HANDOFF_REDIRECT_URI");
    if (configured) {
      const redirect = new URL(configured);
      if (!isLoopback(redirect.hostname) || redirect.pathname !== "/api/auth/callback") {
        throw new AuthError({
          status: 503,
          code: "HANDOFF_REDIRECT_INVALID",
          message: "The local World handoff callback is invalid.",
        });
      }
      return redirect.toString();
    }
    return "http://localhost:8888/api/auth/callback";
  }

  return isTestingIdentity(request)
    ? "https://world.testing.hara-lang.org/api/auth/callback"
    : "https://world.hara-lang.org/api/auth/callback";
}

export function readWorldHandoffClient(env = process.env, requestUrl = "https://id.hara-lang.org/") {
  const secret = envValue(env, "HARA_WORLD_HANDOFF_SECRET");
  if (secret.length < 32) {
    throw new AuthError({
      status: 503,
      code: "HANDOFF_NOT_CONFIGURED",
      message: "The Hara World identity handoff is not configured.",
    });
  }
  return {
    clientId: WORLD_CLIENT_ID,
    clientSecret: secret,
    redirectUri: worldRedirectUri(requestUrl, env),
  };
}

export function isHandoffConfigured(env = process.env, requestUrl = "https://id.hara-lang.org/") {
  if (!isAuthConfigured(env)) return false;
  try {
    readWorldHandoffClient(env, requestUrl);
    return true;
  } catch {
    return false;
  }
}

export function createMemoryHandoffStore() {
  const records = new Map();
  return {
    async put(key, value) {
      records.set(key, structuredClone(value));
    },
    async take(key) {
      const value = records.get(key) ?? null;
      records.delete(key);
      return value ? structuredClone(value) : null;
    },
    async purgeExpired(now = Date.now()) {
      let removed = 0;
      for (const [key, value] of records) {
        if (Date.parse(value.expiresAt) <= now) {
          records.delete(key);
          removed += 1;
        }
      }
      return removed;
    },
    async size() {
      return records.size;
    },
  };
}

let blobStorePromise;
async function createBlobHandoffStore() {
  const { getStore } = await import("@netlify/blobs");
  const store = getStore({ name: "hara-identity-handoffs", consistency: "strong" });
  return {
    async put(key, value) {
      await store.set(key, JSON.stringify(value), {
        metadata: { expiresAt: value.expiresAt },
      });
    },
    async take(key) {
      const value = await store.get(key, { type: "json" });
      if (value) await store.delete(key);
      return value;
    },
    async purgeExpired(now = Date.now()) {
      const { blobs } = await store.list({ prefix: "code/" });
      let removed = 0;
      for (const blob of blobs) {
        const metadata = await store.getMetadata(blob.key);
        const expiresAt = metadata?.metadata?.expiresAt;
        if (!expiresAt || Date.parse(expiresAt) <= now) {
          await store.delete(blob.key);
          removed += 1;
        }
      }
      return removed;
    },
  };
}

export async function defaultHandoffStore() {
  blobStorePromise ??= createBlobHandoffStore();
  return blobStorePromise;
}

function assertAuthorizeRequest(request, env) {
  const url = new URL(request.url);
  const client = readWorldHandoffClient(env, request.url);
  const clientId = url.searchParams.get("client_id");
  const redirectUri = url.searchParams.get("redirect_uri");
  const state = url.searchParams.get("state");
  const challenge = url.searchParams.get("code_challenge");
  const method = url.searchParams.get("code_challenge_method");

  if (clientId !== client.clientId) {
    throw new AuthError({ status: 400, code: "HANDOFF_CLIENT_INVALID", message: "Unknown Hara handoff client." });
  }
  if (redirectUri !== client.redirectUri) {
    throw new AuthError({ status: 400, code: "HANDOFF_REDIRECT_INVALID", message: "The handoff callback is not registered." });
  }
  if (!state || !STATE_PATTERN.test(state)) {
    throw new AuthError({ status: 400, code: "HANDOFF_STATE_INVALID", message: "The handoff state is missing or invalid." });
  }
  if (!challenge || !PKCE_PATTERN.test(challenge) || method !== "S256") {
    throw new AuthError({ status: 400, code: "HANDOFF_PKCE_INVALID", message: "The handoff must use S256 PKCE." });
  }

  return { client, state, challenge };
}

function centralProfile(request, env, now) {
  const cookies = parseCookies(request.headers.get("cookie") || "");
  return verifySession(cookies[SESSION_COOKIE], readSessionSecret(env), {
    issuer: new URL(request.url).origin,
    now,
  });
}

export async function authorizeHandoff(request, {
  env = process.env,
  now = Date.now(),
  store,
} = {}) {
  if (request.method !== "GET") {
    return jsonResponse({ error: { code: "METHOD_NOT_ALLOWED", message: "Only GET is supported." } }, {
      status: 405,
      headers: { Allow: "GET" },
    });
  }

  const { client, state, challenge } = assertAuthorizeRequest(request, env);
  const profile = centralProfile(request, env, now);
  if (!profile) {
    const signIn = new URL("/github/start", request.url);
    signIn.searchParams.set("returnTo", request.url);
    return redirectResponse(signIn.toString());
  }

  const activeStore = store ?? await defaultHandoffStore();
  const code = randomToken(32);
  const handoffId = randomToken(24);
  const issuedAt = new Date(now).toISOString();
  const expiresAt = new Date(now + HANDOFF_TTL_SECONDS * 1000).toISOString();
  await activeStore.put(codeKey(code), {
    id: handoffId,
    issuer: new URL(request.url).origin,
    clientId: client.clientId,
    redirectUri: client.redirectUri,
    codeChallenge: challenge,
    issuedAt,
    expiresAt,
    profile: {
      id: profile.id,
      login: profile.login,
      name: profile.name,
      avatarUrl: profile.avatarUrl,
      profileUrl: profile.profileUrl,
    },
  });

  const callback = new URL(client.redirectUri);
  callback.searchParams.set("code", code);
  callback.searchParams.set("state", state);
  return redirectResponse(callback.toString());
}

function parseBasicAuthorization(header) {
  if (typeof header !== "string" || !header.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 1) return null;
    return { clientId: decoded.slice(0, separator), clientSecret: decoded.slice(separator + 1) };
  } catch {
    return null;
  }
}

function tokenError(status, code, message, headers = {}) {
  return jsonResponse({ error: { code, message } }, { status, headers });
}

export async function exchangeHandoff(request, {
  env = process.env,
  now = Date.now(),
  store,
} = {}) {
  if (request.method !== "POST") {
    return tokenError(405, "METHOD_NOT_ALLOWED", "Only POST is supported.", { Allow: "POST" });
  }

  const client = readWorldHandoffClient(env, request.url);
  const authorization = parseBasicAuthorization(request.headers.get("authorization"));
  if (
    !authorization
    || authorization.clientId !== client.clientId
    || !safeEqual(authorization.clientSecret, client.clientSecret)
  ) {
    return tokenError(401, "HANDOFF_CLIENT_INVALID", "The handoff client could not be authenticated.", {
      "WWW-Authenticate": "Basic realm=\"hara-handoff\"",
    });
  }

  let form;
  try {
    form = new URLSearchParams(await request.text());
  } catch {
    return tokenError(400, "HANDOFF_REQUEST_INVALID", "The handoff token request could not be read.");
  }

  const grantType = form.get("grant_type");
  const code = form.get("code");
  const verifier = form.get("code_verifier");
  const redirectUri = form.get("redirect_uri");
  if (
    grantType !== "authorization_code"
    || !code
    || !CODE_PATTERN.test(code)
    || !verifier
    || !PKCE_PATTERN.test(verifier)
    || redirectUri !== client.redirectUri
  ) {
    return tokenError(400, "HANDOFF_REQUEST_INVALID", "The handoff token request is invalid.");
  }

  const activeStore = store ?? await defaultHandoffStore();
  const record = await activeStore.take(codeKey(code));
  if (!record) {
    return tokenError(400, "HANDOFF_CODE_INVALID", "The handoff code is invalid or has already been used.");
  }

  if (
    record.clientId !== client.clientId
    || record.redirectUri !== client.redirectUri
    || Date.parse(record.expiresAt) <= now
    || !safeEqual(pkceChallenge(verifier), record.codeChallenge)
  ) {
    return tokenError(400, "HANDOFF_CODE_INVALID", "The handoff code is invalid, expired, or could not be verified.");
  }

  return jsonResponse({
    tokenType: "Hara-Identity-Handoff",
    expiresIn: 60,
    handoff: {
      id: record.id,
      issuer: record.issuer,
      audience: record.clientId,
      subject: `github:${record.profile.id}`,
      issuedAt: record.issuedAt,
      expiresAt: new Date(now + 60_000).toISOString(),
      identity: {
        provider: "github",
        id: record.profile.id,
        login: record.profile.login,
        name: record.profile.name,
        avatarUrl: record.profile.avatarUrl,
        profileUrl: record.profile.profileUrl,
      },
    },
  });
}

export function handoffDiscovery(request, env = process.env) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return jsonResponse({ error: { code: "METHOD_NOT_ALLOWED", message: "Only GET and HEAD are supported." } }, {
      status: 405,
      method: request.method,
      headers: { Allow: "GET, HEAD" },
    });
  }
  const origin = new URL(request.url).origin;
  let redirectUri = null;
  try {
    redirectUri = worldRedirectUri(request.url, env);
  } catch {}
  return jsonResponse({
    issuer: origin,
    authorizationEndpoint: `${origin}${HANDOFF_AUTHORIZE_PATH}`,
    tokenEndpoint: `${origin}${HANDOFF_TOKEN_PATH}`,
    clients: redirectUri ? [{ id: WORLD_CLIENT_ID, redirectUri }] : [],
    codeChallengeMethodsSupported: ["S256"],
    configured: isHandoffConfigured(env, request.url),
  }, { method: request.method });
}

export function handoffProblem(error, method = "GET") {
  const problem = error instanceof AuthError
    ? error
    : new AuthError({ status: 500, code: "HANDOFF_INTERNAL_ERROR", message: "The identity handoff could not be completed.", cause: error });
  return jsonResponse({ error: { code: problem.code, message: problem.message } }, {
    status: problem.status,
    method,
  });
}
