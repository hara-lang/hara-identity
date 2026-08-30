import {
  createHash,
  createPrivateKey,
  createPublicKey,
  createSign,
  randomUUID,
  sign as signDetached,
  verify as verifyDetached,
} from "node:crypto";
import {
  AuthError,
  SESSION_COOKIE,
  jsonResponse,
  parseCookies,
  randomToken,
  readSessionSecret,
  redirectResponse,
  verifySession,
} from "./auth-lib.mjs";

const DEVICE_TTL_MS = 10 * 60 * 1000;
const AUTHORIZATION_TTL_MS = 5 * 60 * 1000;
const HEX_32 = /^[0-9a-f]{64}$/;
const HEX_64 = /^[0-9a-f]{128}$/;
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const COORDINATE = /^hara:[a-z][a-z0-9.-]{0,62}\/[a-z][a-z0-9._-]{0,62}$/;
const MODE = new Set(["grant", "authorize"]);

export const config = {
  path: ["/v1/publisher/*", "/publish/device"],
  rateLimit: {
    windowLimit: 120,
    windowSize: 60,
    aggregateBy: ["ip", "domain"],
  },
};

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function deviceKey(id) {
  return `device/${id}`;
}

function codeKey(code) {
  return `code/${hash(code)}`;
}

function envValue(env, name) {
  const value = env?.[name] ?? globalThis.Netlify?.env?.get?.(name);
  return typeof value === "string" ? value.trim() : "";
}

function problem(status, code, message, headers = {}) {
  return jsonResponse({ error: { code, message } }, { status, headers });
}

function safeJson(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return value;
}

async function requestJson(request) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > 64 * 1024) throw new TypeError("Request body is too large.");
  let value;
  try {
    value = await request.json();
  } catch {
    throw new TypeError("Request body must be JSON.");
  }
  value = safeJson(value);
  if (!value) throw new TypeError("Request body must be a JSON object.");
  return value;
}

function bearer(request) {
  const value = request.headers.get("authorization") ?? "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}

function profileFor(request, env, now) {
  const token = parseCookies(request.headers.get("cookie") ?? "")[SESSION_COOKIE];
  return verifySession(token, readSessionSecret(env), {
    issuer: new URL(request.url).origin,
    now,
  });
}

function rawEd25519PublicKey(hex) {
  if (!HEX_32.test(hex)) throw new TypeError("Publisher public key must be 32-byte lowercase hexadecimal.");
  return createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(hex, "hex")]),
    format: "der",
    type: "spki",
  });
}

function proofMessage(record) {
  return `hara-publisher-device/1\n${record.id}\n${record.challenge}\n${record.mode}\n`;
}

function canonicalAuthorization(payload) {
  return JSON.stringify({
    authorization: "hara-publisher/1",
    keyId: payload.keyId,
    githubSubject: payload.githubSubject,
    coordinate: payload.coordinate,
    intentSha256: payload.intentSha256,
    identityRevision: payload.identityRevision,
    nonce: payload.nonce,
    expiresAt: payload.expiresAt,
  });
}

function authorization(record, profile, env, now) {
  const privateKeyPem = envValue(env, "HARA_PUBLISH_AUTHORIZATION_PRIVATE_KEY");
  if (!privateKeyPem) {
    throw new AuthError({
      status: 503,
      code: "PUBLISH_AUTHORIZATION_NOT_CONFIGURED",
      message: "Publisher authorization signing is not configured.",
    });
  }
  const payload = {
    keyId: record.keyId,
    githubSubject: profile.id,
    coordinate: record.coordinate,
    intentSha256: `sha256:${hash(record.intent)}`,
    identityRevision: record.identityRevision || "unresolved",
    nonce: randomToken(24),
    expiresAt: new Date(now + AUTHORIZATION_TTL_MS).toISOString(),
  };
  const canonical = canonicalAuthorization(payload);
  const signature = signDetached(null, Buffer.from(canonical), createPrivateKey(privateKeyPem.replaceAll("\\n", "\n"))).toString("hex");
  return { payload, signature };
}

function isPersonalCoordinate(coordinate, login) {
  return coordinate.startsWith(`hara:${login.toLowerCase()}/`);
}

function grantTitle(record) {
  return `Publisher grant: ${record.keyId} → ${record.coordinate}`;
}

function grantBody(record, profile, reviewRequired) {
  return [
    "<!-- hara-publisher-grant/1 -->",
    "## Publisher key grant",
    "",
    `- GitHub subject: \`${profile.id}\` (${profile.login})`,
    `- Key ID: \`${record.keyId}\``,
    `- Public key: \`${record.publicKey}\``,
    `- Requested coordinate: \`${record.coordinate}\``,
    `- Review: ${reviewRequired ? "required (protected namespace)" : "automatic personal namespace; root-policy signature still required"}`,
    `- Device request: \`${record.id}\``,
  ].join("\n");
}

function appJwt(env, now) {
  const appId = envValue(env, "HARA_ID_GRANT_APP_ID");
  const privateKey = envValue(env, "HARA_ID_GRANT_APP_PRIVATE_KEY");
  if (!appId || !privateKey) throw new AuthError({ status: 503, code: "GRANT_BROKER_NOT_CONFIGURED", message: "The identity grant broker is not configured." });
  const issuedAt = Math.floor(now / 1000) - 30;
  const input = `${base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64Url(JSON.stringify({ iat: issuedAt, exp: issuedAt + 9 * 60, iss: appId }))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(input);
  signer.end();
  return `${input}.${signer.sign(privateKey.replaceAll("\\n", "\n")).toString("base64url")}`;
}

async function issueInstallationToken(env, fetchImpl, now) {
  const installation = envValue(env, "HARA_ID_GRANT_APP_INSTALLATION_ID");
  if (!installation) throw new AuthError({ status: 503, code: "GRANT_BROKER_NOT_CONFIGURED", message: "The identity grant broker is not configured." });
  const response = await fetchImpl(`https://api.github.com/app/installations/${encodeURIComponent(installation)}/access_tokens`, {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${appJwt(env, now)}`,
      "user-agent": "hara-identity-publisher",
    },
  });
  const value = response.ok ? await response.json() : null;
  if (typeof value?.token !== "string") throw new AuthError({ status: 502, code: "GRANT_BROKER_UNAVAILABLE", message: "GitHub could not authorize the identity grant broker." });
  return value.token;
}

async function createGitHubGrantIssue(record, profile, reviewRequired, { env, fetchImpl, now }) {
  const repository = envValue(env, "HARA_ID_GRANT_REPOSITORY") || "hara-lang/hara-identity";
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new AuthError({ status: 503, code: "GRANT_BROKER_NOT_CONFIGURED", message: "The identity grant repository is invalid." });
  const token = await issueInstallationToken(env, fetchImpl, now);
  const response = await fetchImpl(`https://api.github.com/repos/${repository}/issues`, {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "hara-identity-publisher",
    },
    body: JSON.stringify({ title: grantTitle(record), body: grantBody(record, profile, reviewRequired), labels: ["publisher-grant"] }),
  });
  const value = response.ok ? await response.json() : null;
  if (typeof value?.html_url !== "string") throw new AuthError({ status: 502, code: "GRANT_BROKER_UNAVAILABLE", message: "GitHub could not create the publisher grant review." });
  return value.html_url;
}

export function createMemoryPublisherStore() {
  const values = new Map();
  return {
    async get(key) { return structuredClone(values.get(key) ?? null); },
    async put(key, value) { values.set(key, structuredClone(value)); },
    async delete(key) { values.delete(key); },
  };
}

let storePromise;
async function defaultStore() {
  storePromise ??= import("@netlify/blobs").then(({ getStore }) => {
    const store = getStore({ name: "hara-publisher-devices", consistency: "strong" });
    return {
      async get(key) { return await store.get(key, { type: "json" }); },
      async put(key, value) { await store.set(key, JSON.stringify(value), { metadata: { expiresAt: value.expiresAt } }); },
      async delete(key) { await store.delete(key); },
    };
  });
  return storePromise;
}

function active(record, now) {
  return record && Date.parse(record.expiresAt) > now ? record : null;
}

export async function startDevice({ mode = "grant" } = {}, { store = null, now = Date.now() } = {}) {
  if (!MODE.has(mode)) throw new TypeError("Publisher device mode is invalid.");
  const activeStore = store ?? await defaultStore();
  const id = randomUUID();
  const secret = randomToken(32);
  const code = randomToken(18);
  const record = {
    id,
    mode,
    secretHash: hash(secret),
    verificationCodeHash: hash(code),
    challenge: randomToken(32),
    status: "pending-proof",
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + DEVICE_TTL_MS).toISOString(),
  };
  await activeStore.put(deviceKey(id), record);
  await activeStore.put(codeKey(code), { id, expiresAt: record.expiresAt });
  return { id, secret, code, challenge: record.challenge, expiresAt: record.expiresAt };
}

export async function submitProof(id, secret, body, { store = null, now = Date.now() } = {}) {
  const activeStore = store ?? await defaultStore();
  const record = active(await activeStore.get(deviceKey(id)), now);
  if (!record || hash(secret) !== record.secretHash) throw new AuthError({ status: 404, code: "DEVICE_NOT_FOUND", message: "Publisher device request is invalid or expired." });
  if (record.status !== "pending-proof") throw new AuthError({ status: 409, code: "DEVICE_STATE_INVALID", message: "Publisher device proof has already been submitted." });
  const { keyId, publicKey, proof, coordinate, intent, identityRevision = "" } = body;
  if (!KEY_ID.test(keyId ?? "") || !HEX_32.test(publicKey ?? "") || !HEX_64.test(proof ?? "") || !COORDINATE.test(coordinate ?? "") || typeof intent !== "string" || !intent.trim() || typeof identityRevision !== "string") {
    throw new TypeError("Publisher device proof is malformed.");
  }
  if (!verifyDetached(null, Buffer.from(proofMessage(record)), rawEd25519PublicKey(publicKey), Buffer.from(proof, "hex"))) {
    throw new AuthError({ status: 403, code: "PUBLISHER_KEY_PROOF_INVALID", message: "The publisher key did not prove possession of this device challenge." });
  }
  Object.assign(record, { keyId, publicKey, coordinate, intent, identityRevision, status: "pending-confirmation" });
  await activeStore.put(deviceKey(id), record);
  return { status: record.status, expiresAt: record.expiresAt };
}

export async function confirmDevice(id, code, request, { env = process.env, store = null, fetchImpl = fetch, createIssue = null, now = Date.now() } = {}) {
  const activeStore = store ?? await defaultStore();
  const record = active(await activeStore.get(deviceKey(id)), now);
  if (!record || hash(code) !== record.verificationCodeHash) throw new AuthError({ status: 404, code: "DEVICE_NOT_FOUND", message: "Publisher device request is invalid or expired." });
  if (record.status !== "pending-confirmation") throw new AuthError({ status: 409, code: "DEVICE_STATE_INVALID", message: "Publisher device request cannot be confirmed." });
  const profile = profileFor(request, env, now);
  if (!profile) return null;
  if (record.mode === "authorize") {
    record.status = "authorized";
    record.authorization = authorization(record, profile, env, now);
  } else {
    const reviewRequired = !isPersonalCoordinate(record.coordinate, profile.login);
    const issue = createIssue ?? createGitHubGrantIssue;
    record.status = "grant-pending";
    record.reviewRequired = reviewRequired;
    record.reviewUrl = await issue(record, profile, reviewRequired, { env, fetchImpl, now });
  }
  record.githubSubject = profile.id;
  record.githubLogin = profile.login;
  await activeStore.put(deviceKey(id), record);
  return { status: record.status, reviewRequired: record.reviewRequired ?? false, reviewUrl: record.reviewUrl ?? null };
}

export async function deviceStatus(id, secret, { store = null, now = Date.now() } = {}) {
  const activeStore = store ?? await defaultStore();
  const record = active(await activeStore.get(deviceKey(id)), now);
  if (!record || hash(secret) !== record.secretHash) throw new AuthError({ status: 404, code: "DEVICE_NOT_FOUND", message: "Publisher device request is invalid or expired." });
  return {
    status: record.status,
    expiresAt: record.expiresAt,
    ...(record.reviewUrl ? { reviewUrl: record.reviewUrl, reviewRequired: record.reviewRequired } : {}),
    ...(record.authorization ? { authorization: record.authorization } : {}),
  };
}

function devicePage(id, code, status) {
  const title = status === "grant-pending" ? "Publisher grant requested" : "Confirm publisher device";
  return new Response(`<!doctype html><title>${title}</title><main><h1>${title}</h1><p>Confirm this request in the Hara Identity browser session.</p><form method="post" action="/v1/publisher/devices/${encodeURIComponent(id)}/confirm"><input type="hidden" name="code" value="${code}"><button type="submit">Confirm publisher key</button></form></main>`, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" },
  });
}

export async function handle(request, options = {}) {
  const url = new URL(request.url);
  const now = options.now ?? Date.now();
  try {
    if (url.pathname === "/v1/publisher/devices" && request.method === "POST") {
      const body = await requestJson(request);
      const device = await startDevice(body, options);
      return jsonResponse({ deviceId: device.id, deviceSecret: device.secret, verificationCode: device.code, challenge: device.challenge, verificationUri: `${url.origin}/publish/device?code=${encodeURIComponent(device.code)}`, expiresAt: device.expiresAt, interval: 2 }, { status: 201 });
    }
    if (url.pathname === "/publish/device" && request.method === "GET") {
      const code = url.searchParams.get("code") ?? "";
      const activeStore = options.store ?? await defaultStore();
      const reference = active(await activeStore.get(codeKey(code)), now);
      const record = reference && active(await activeStore.get(deviceKey(reference.id)), now);
      if (!record) return problem(404, "DEVICE_NOT_FOUND", "Publisher device request is invalid or expired.");
      const profile = profileFor(request, options.env ?? process.env, now);
      if (!profile) {
        const signIn = new URL("/github/start", url);
        signIn.searchParams.set("returnTo", url.toString());
        return redirectResponse(signIn.toString());
      }
      return devicePage(record.id, code, record.status);
    }
    const match = /^\/v1\/publisher\/devices\/([0-9a-f-]{36})(?:\/(proof|confirm))?$/.exec(url.pathname);
    if (!match) return problem(404, "NOT_FOUND", "Unknown publisher endpoint.");
    const [, id, action] = match;
    if (!action && request.method === "GET") return jsonResponse(await deviceStatus(id, bearer(request), { ...options, now }));
    if (action === "proof" && request.method === "POST") return jsonResponse(await submitProof(id, bearer(request), await requestJson(request), { ...options, now }));
    if (action === "confirm" && request.method === "POST") {
      let code;
      if ((request.headers.get("content-type") ?? "").startsWith("application/json")) code = (await requestJson(request)).code;
      else code = (await request.formData()).get("code");
      const result = await confirmDevice(id, String(code ?? ""), request, { ...options, now });
      if (result === null) {
        const signIn = new URL("/github/start", url);
        signIn.searchParams.set("returnTo", new URL(`/publish/device?code=${encodeURIComponent(String(code ?? ""))}`, url).toString());
        return redirectResponse(signIn.toString());
      }
      return jsonResponse(result);
    }
    return problem(405, "METHOD_NOT_ALLOWED", "Method is not supported for this publisher endpoint.");
  } catch (error) {
    if (error instanceof AuthError) return problem(error.status, error.code, error.message);
    return problem(400, "PUBLISHER_REQUEST_INVALID", error?.message || "Publisher request is invalid.");
  }
}

export default async (request) => handle(request);
