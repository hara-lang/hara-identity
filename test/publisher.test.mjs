import assert from "node:assert/strict";
import { generateKeyPairSync, sign, verify } from "node:crypto";
import test from "node:test";
import { signSession } from "../netlify/functions/auth-lib.mjs";
import {
  confirmDevice,
  createMemoryPublisherStore,
  deviceStatus,
  handle,
  startDevice,
  submitProof,
} from "../netlify/functions/publisher.mjs";

const SESSION_SECRET = "s".repeat(32);
const NOW = 1_700_000_000_000;

function keys() {
  const publisher = generateKeyPairSync("ed25519");
  const authorization = generateKeyPairSync("ed25519");
  const raw = publisher.publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
  return { publisher, authorization, raw };
}

function env(authorization) {
  return {
    HARA_AUTH_SESSION_SECRET: SESSION_SECRET,
    HARA_PUBLISH_AUTHORIZATION_PRIVATE_KEY: authorization.privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
  };
}

function browserRequest(user = { id: "1455572", login: "hoebat", name: "Hoebat" }) {
  const session = signSession(user, SESSION_SECRET, { issuer: "https://id.hara-lang.org", now: NOW });
  return new Request("https://id.hara-lang.org/v1/publisher/devices/example/confirm", {
    method: "POST",
    headers: { cookie: `hara_identity_session=${session}` },
  });
}

async function proof(store, device, publisher, publicKey, mode = "grant") {
  const message = `hara-publisher-device/1\n${device.id}\n${device.challenge}\n${mode}\n`;
  return submitProof(device.id, device.secret, {
    keyId: "hoebat-2026-01",
    publicKey,
    proof: sign(null, Buffer.from(message), publisher.privateKey).toString("hex"),
    coordinate: "hara:hara-native/smoke-answer",
    intent: "{:intent/format \"0.0.0-alpha\"}",
    identityRevision: "revision-1",
  }, { store, now: NOW });
}

test("a protected key request proves possession and creates one review request", async () => {
  const store = createMemoryPublisherStore();
  const { publisher, authorization, raw } = keys();
  const device = await startDevice({ mode: "grant" }, { store, now: NOW });
  await proof(store, device, publisher, raw);
  const confirmed = await confirmDevice(device.id, device.code, browserRequest(), {
    store,
    env: env(authorization),
    now: NOW,
    createIssue: async () => "https://github.com/hara-lang/hara-identity/issues/42",
  });
  assert.deepEqual(confirmed, {
    status: "grant-pending",
    reviewRequired: true,
    reviewUrl: "https://github.com/hara-lang/hara-identity/issues/42",
  });
  assert.deepEqual(await deviceStatus(device.id, device.secret, { store, now: NOW }), {
    status: "grant-pending",
    expiresAt: new Date(NOW + 10 * 60 * 1000).toISOString(),
    reviewUrl: "https://github.com/hara-lang/hara-identity/issues/42",
    reviewRequired: true,
  });
});

test("a device request rejects a signature from a different publisher key", async () => {
  const store = createMemoryPublisherStore();
  const first = keys();
  const second = keys();
  const device = await startDevice({ mode: "grant" }, { store, now: NOW });
  const message = `hara-publisher-device/1\n${device.id}\n${device.challenge}\ngrant\n`;
  await assert.rejects(
    submitProof(device.id, device.secret, {
      keyId: "hoebat-2026-01",
      publicKey: first.raw,
      proof: sign(null, Buffer.from(message), second.publisher.privateKey).toString("hex"),
      coordinate: "hara:hara-native/smoke-answer",
      intent: "intent",
    }, { store, now: NOW }),
    /did not prove possession/,
  );
});

test("authorization mode returns an intent-bound service signature after GitHub confirmation", async () => {
  const store = createMemoryPublisherStore();
  const { publisher, authorization, raw } = keys();
  const device = await startDevice({ mode: "authorize" }, { store, now: NOW });
  await proof(store, device, publisher, raw, "authorize");
  await confirmDevice(device.id, device.code, browserRequest(), { store, env: env(authorization), now: NOW });
  const status = await deviceStatus(device.id, device.secret, { store, now: NOW });
  assert.equal(status.status, "authorized");
  assert.equal(status.authorization.payload.keyId, "hoebat-2026-01");
  assert.equal(status.authorization.payload.githubSubject, "1455572");
  const payload = status.authorization.payload;
  const canonical = JSON.stringify({
    authorization: "hara-publisher/1",
    keyId: payload.keyId,
    githubSubject: payload.githubSubject,
    coordinate: payload.coordinate,
    intentSha256: payload.intentSha256,
    identityRevision: payload.identityRevision,
    nonce: payload.nonce,
    expiresAt: payload.expiresAt,
  });
  assert.equal(verify(null, Buffer.from(canonical), authorization.publicKey, Buffer.from(status.authorization.signature, "hex")), true);
});

test("HTTP device endpoints keep the polling secret out of the browser URL", async () => {
  const store = createMemoryPublisherStore();
  const created = await handle(new Request("https://id.hara-lang.org/v1/publisher/devices", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "grant" }),
  }), { store, now: NOW });
  assert.equal(created.status, 201);
  const body = await created.json();
  assert.match(body.verificationUri, /\/publish\/device\?code=/);
  assert.doesNotMatch(body.verificationUri, new RegExp(body.deviceSecret));
  const status = await handle(new Request(`https://id.hara-lang.org/v1/publisher/devices/${body.deviceId}`, {
    headers: { authorization: `Bearer ${body.deviceSecret}` },
  }), { store, now: NOW });
  assert.deepEqual(await status.json(), {
    status: "pending-proof",
    expiresAt: new Date(NOW + 10 * 60 * 1000).toISOString(),
  });
});
