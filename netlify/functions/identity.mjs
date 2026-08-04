// Read-only identity API for id.hara-lang.org. Git is the authority: this
// function mirrors the signed policy document from raw.githubusercontent.com
// and never holds signing material. Mirrors the Cloudflare worker router in
// platform/cloudflare/src/router.ts.

const COMMIT = /^[0-9a-f]{40}$/;
const IDENTITY_REPOSITORY = "hara-lang/hara-identity";

const DISCOVERY =
  '{:tap/name "hara" :tap/identity "https://id.hara-lang.org" :tap/registry "https://packages.hara-lang.org"}\n';

export const config = {
  path: ["/.well-known/hara-tap.edn", "/v1/identity"],
};

export function identityUrl(ref) {
  if (ref !== "main" && !COMMIT.test(ref)) {
    throw new Error("ref must be main or a 40-character commit");
  }
  // raw.githubusercontent.com is CDN-fronted; the api.github.com contents
  // endpoint rate-limits shared egress IPs and 502s in practice.
  return `https://raw.githubusercontent.com/${IDENTITY_REPOSITORY}/${ref}/identity.edn`;
}

function edn(body, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/edn; charset=utf-8");
  headers.set("x-content-type-options", "nosniff");
  return new Response(body, { ...init, headers });
}

function problem(status, code, message) {
  return edn(`{:error/code :${code} :error/message ${JSON.stringify(message)}}\n`, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function discovery() {
  return edn(DISCOVERY, {
    headers: { "cache-control": "public, max-age=3600" },
  });
}

async function identityDocument(url, fetchImpl) {
  const ref = url.searchParams.get("ref") ?? "main";
  let upstream;
  try {
    upstream = identityUrl(ref);
  } catch (error) {
    return problem(400, "invalid-request", error.message);
  }
  const response = await fetchImpl(upstream, {
    headers: { "user-agent": "hara-identity-netlify" },
  });
  if (!response.ok) {
    console.error(JSON.stringify({ event: "git-read-failed", ref, status: response.status }));
    return problem(502, "upstream-unavailable", "authoritative Git document unavailable");
  }
  const body = await response.text();
  return edn(body, {
    headers: {
      "cache-control":
        ref === "main" ? "public, max-age=60" : "public, max-age=31536000, immutable",
      "x-hara-authority": "git",
    },
  });
}

export async function handle(req, fetchImpl = fetch) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return problem(405, "method-not-allowed", "public service endpoints are read-only");
  }
  const url = new URL(req.url);
  if (url.pathname === "/.well-known/hara-tap.edn") return discovery();
  if (url.pathname === "/v1/identity") return identityDocument(url, fetchImpl);
  return problem(404, "not-found", "unknown Hara platform endpoint");
}

export default async (req, context) => handle(req);
