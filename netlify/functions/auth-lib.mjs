import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export const OAUTH_STATE_COOKIE = "hara_id_oauth_state";
export const OAUTH_VERIFIER_COOKIE = "hara_id_oauth_verifier";
export const OAUTH_RETURN_COOKIE = "hara_id_oauth_return";
export const SESSION_COOKIE = "hara_identity_session";

export const OAUTH_COOKIE_TTL_SECONDS = 10 * 60;
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";
const LOGIN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const COOKIE_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

const PRODUCTION_ORIGINS = Object.freeze([
  "https://hara-lang.org",
  "https://www.hara-lang.org",
  "https://specs.hara-lang.org",
  "https://packages.hara-lang.org",
  "https://id.hara-lang.org",
]);

const TESTING_ORIGINS = Object.freeze([
  "https://www.testing.hara-lang.org",
  "https://specs.testing.hara-lang.org",
  "https://packages.testing.hara-lang.org",
  "https://id.testing.hara-lang.org",
]);

export class AuthError extends Error {
  constructor({
    status = 400,
    code = "AUTH_ERROR",
    message = "Authentication could not be completed.",
    cause,
  } = {}) {
    super(message, { cause });
    this.name = "AuthError";
    this.status = status;
    this.code = code;
  }
}

function base64UrlEncode(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return buffer.toString("base64url");
}

function base64UrlDecode(value) {
  return Buffer.from(value, "base64url");
}

function safeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function valueFrom(env, ...keys) {
  for (const key of keys) {
    const value = env?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function requestIsSecure(requestUrl) {
  try {
    return new URL(requestUrl).protocol === "https:";
  } catch {
    return true;
  }
}

function parseOrigin(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function randomToken(bytes = 32) {
  return base64UrlEncode(randomBytes(bytes));
}

export function pkceChallenge(verifier) {
  return base64UrlEncode(createHash("sha256").update(verifier).digest());
}

export function allowedOrigins(env = process.env, requestUrl = "https://id.hara-lang.org/") {
  const request = new URL(requestUrl);
  const isTesting = request.hostname === "id.testing.hara-lang.org"
    || request.hostname.endsWith(".testing.hara-lang.org");
  const origins = new Set(isTesting ? TESTING_ORIGINS : PRODUCTION_ORIGINS);

  if (request.hostname === "localhost" || request.hostname === "127.0.0.1" || request.hostname === "[::1]") {
    origins.add(request.origin);
  }

  const configured = valueFrom(env, "HARA_AUTH_ALLOWED_ORIGINS", "AUTH_ALLOWED_ORIGINS");
  for (const entry of configured.split(/[\s,]+/)) {
    const origin = parseOrigin(entry);
    if (origin) origins.add(origin);
  }

  return origins;
}

export function isAllowedOrigin(origin, env = process.env, requestUrl) {
  const normalized = parseOrigin(origin);
  return Boolean(normalized && allowedOrigins(env, requestUrl).has(normalized));
}

export function safeReturnTo(value, requestUrl, env = process.env) {
  const request = new URL(requestUrl);
  const fallback = new URL("/", request.origin).toString();
  if (typeof value !== "string" || !value.trim() || /[\r\n\0]/.test(value) || value.includes("\\")) {
    return fallback;
  }

  let destination;
  try {
    destination = new URL(value.trim(), request.origin);
  } catch {
    return fallback;
  }

  if (
    !/^https?:$/.test(destination.protocol)
    || destination.username
    || destination.password
    || !allowedOrigins(env, requestUrl).has(destination.origin)
  ) {
    return fallback;
  }

  return destination.toString();
}

export function parseCookies(header = "") {
  const cookies = {};
  for (const segment of String(header).split(";")) {
    const separator = segment.indexOf("=");
    if (separator < 0) continue;
    const name = segment.slice(0, separator).trim();
    if (!name) continue;
    const rawValue = segment.slice(separator + 1).trim();
    try {
      cookies[name] = decodeURIComponent(rawValue);
    } catch {
      cookies[name] = rawValue;
    }
  }
  return cookies;
}

export function serializeCookie(name, value, {
  path = "/",
  maxAge,
  httpOnly = true,
  secure = true,
  sameSite = "Lax",
} = {}) {
  if (!COOKIE_NAME_PATTERN.test(name)) {
    throw new TypeError(`Invalid cookie name: ${name}`);
  }

  const parts = [`${name}=${encodeURIComponent(String(value))}`, `Path=${path}`];
  if (Number.isFinite(maxAge)) parts.push(`Max-Age=${Math.trunc(maxAge)}`);
  if (httpOnly) parts.push("HttpOnly");
  if (secure) parts.push("Secure");
  if (sameSite) parts.push(`SameSite=${sameSite}`);
  return parts.join("; ");
}

export function clearCookie(name, {
  path = "/",
  secure = true,
  httpOnly = true,
  sameSite = "Lax",
} = {}) {
  return serializeCookie(name, "", {
    path,
    maxAge: 0,
    secure,
    httpOnly,
    sameSite,
  });
}

export function isAuthConfigured(env = process.env) {
  return Boolean(
    valueFrom(env, "HARA_GITHUB_OAUTH_CLIENT_ID", "GITHUB_OAUTH_CLIENT_ID")
    && valueFrom(env, "HARA_GITHUB_OAUTH_CLIENT_SECRET", "GITHUB_OAUTH_CLIENT_SECRET")
    && valueFrom(env, "HARA_AUTH_SESSION_SECRET", "AUTH_SESSION_SECRET").length >= 32
  );
}

export function readSessionSecret(env = process.env) {
  const sessionSecret = valueFrom(env, "HARA_AUTH_SESSION_SECRET", "AUTH_SESSION_SECRET");
  if (sessionSecret.length < 32) {
    throw new AuthError({
      status: 503,
      code: "AUTH_NOT_CONFIGURED",
      message: "GitHub sign-in is not configured on this deployment.",
    });
  }
  return sessionSecret;
}

export function readOAuthConfig(env = process.env, requestUrl) {
  const clientId = valueFrom(env, "HARA_GITHUB_OAUTH_CLIENT_ID", "GITHUB_OAUTH_CLIENT_ID");
  const clientSecret = valueFrom(env, "HARA_GITHUB_OAUTH_CLIENT_SECRET", "GITHUB_OAUTH_CLIENT_SECRET");
  const sessionSecret = readSessionSecret(env);
  const scope = valueFrom(env, "HARA_GITHUB_OAUTH_SCOPE", "GITHUB_OAUTH_SCOPE");
  const redirectUri = valueFrom(env, "HARA_GITHUB_OAUTH_REDIRECT_URI", "GITHUB_OAUTH_REDIRECT_URI")
    || new URL("/auth/github/callback", requestUrl).toString();

  if (!clientId || !clientSecret) {
    throw new AuthError({
      status: 503,
      code: "AUTH_NOT_CONFIGURED",
      message: "GitHub sign-in is not configured on this deployment.",
    });
  }

  let parsedRedirect;
  try {
    parsedRedirect = new URL(redirectUri);
  } catch {
    throw new AuthError({
      status: 503,
      code: "AUTH_REDIRECT_INVALID",
      message: "The configured GitHub OAuth callback URL is invalid.",
    });
  }

  const redirectHostAllowed = parsedRedirect.hostname.startsWith("id.")
    || parsedRedirect.hostname === "localhost"
    || parsedRedirect.hostname === "127.0.0.1"
    || parsedRedirect.hostname === "[::1]";

  if (
    !/^https?:$/.test(parsedRedirect.protocol)
    || parsedRedirect.username
    || parsedRedirect.password
    || parsedRedirect.pathname !== "/auth/github/callback"
    || !allowedOrigins(env, requestUrl).has(parsedRedirect.origin)
    || !redirectHostAllowed
  ) {
    throw new AuthError({
      status: 503,
      code: "AUTH_REDIRECT_INVALID",
      message: "The GitHub OAuth callback must be the allowlisted Hara identity callback.",
    });
  }

  return {
    clientId,
    clientSecret,
    sessionSecret,
    scope,
    redirectUri: parsedRedirect.toString(),
  };
}

export function createOAuthAttempt(returnTo, requestUrl, env = process.env) {
  const verifier = randomToken(48);
  return {
    state: randomToken(32),
    verifier,
    challenge: pkceChallenge(verifier),
    returnTo: safeReturnTo(returnTo, requestUrl, env),
  };
}

export function buildGitHubAuthorizeUrl({ clientId, redirectUri, state, challenge, scope = "" }) {
  const authorizeUrl = new URL(GITHUB_AUTHORIZE_URL);
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", challenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  if (scope) authorizeUrl.searchParams.set("scope", scope);
  return authorizeUrl.toString();
}

export function oauthAttemptCookies(attempt, requestUrl) {
  const options = {
    path: "/auth/github/callback",
    maxAge: OAUTH_COOKIE_TTL_SECONDS,
    secure: requestIsSecure(requestUrl),
    httpOnly: true,
    sameSite: "Lax",
  };

  return [
    serializeCookie(OAUTH_STATE_COOKIE, attempt.state, options),
    serializeCookie(OAUTH_VERIFIER_COOKIE, attempt.verifier, options),
    serializeCookie(OAUTH_RETURN_COOKIE, attempt.returnTo, options),
  ];
}

export function clearOAuthCookies(requestUrl) {
  const options = {
    path: "/auth/github/callback",
    secure: requestIsSecure(requestUrl),
    httpOnly: true,
    sameSite: "Lax",
  };
  return [
    clearCookie(OAUTH_STATE_COOKIE, options),
    clearCookie(OAUTH_VERIFIER_COOKIE, options),
    clearCookie(OAUTH_RETURN_COOKIE, options),
  ];
}

export function assertOAuthCallback({ requestUrl, cookieHeader, env = process.env }) {
  const callbackUrl = new URL(requestUrl);
  const providerError = callbackUrl.searchParams.get("error");
  if (providerError) {
    throw new AuthError({
      status: 401,
      code: "GITHUB_OAUTH_DENIED",
      message: callbackUrl.searchParams.get("error_description") || "GitHub sign-in was cancelled.",
    });
  }

  const code = callbackUrl.searchParams.get("code");
  const state = callbackUrl.searchParams.get("state");
  const cookies = parseCookies(cookieHeader);
  const expectedState = cookies[OAUTH_STATE_COOKIE];
  const verifier = cookies[OAUTH_VERIFIER_COOKIE];

  if (!code || !state || !expectedState || !safeEqual(state, expectedState)) {
    throw new AuthError({
      status: 400,
      code: "OAUTH_STATE_INVALID",
      message: "The GitHub sign-in request could not be verified. Please start again.",
    });
  }
  if (!verifier || verifier.length < 43) {
    throw new AuthError({
      status: 400,
      code: "OAUTH_PKCE_INVALID",
      message: "The GitHub sign-in verifier is missing or expired. Please start again.",
    });
  }

  return {
    code,
    verifier,
    returnTo: safeReturnTo(cookies[OAUTH_RETURN_COOKIE], requestUrl, env),
  };
}

export async function exchangeGitHubCode({
  clientId,
  clientSecret,
  code,
  redirectUri,
  verifier,
}, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(GITHUB_TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "hara-id",
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      }).toString(),
    });
  } catch (cause) {
    throw new AuthError({
      status: 502,
      code: "GITHUB_TOKEN_UNAVAILABLE",
      message: "GitHub could not be reached to complete sign-in.",
      cause,
    });
  }

  let payload = {};
  try {
    payload = await response.json();
  } catch {}

  if (!response.ok || typeof payload.access_token !== "string" || !payload.access_token) {
    throw new AuthError({
      status: 502,
      code: "GITHUB_TOKEN_REJECTED",
      message: "GitHub did not accept the sign-in callback. Please start again.",
    });
  }

  return payload.access_token;
}

export async function fetchGitHubUser(accessToken, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(GITHUB_USER_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": "hara-id",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
  } catch (cause) {
    throw new AuthError({
      status: 502,
      code: "GITHUB_USER_UNAVAILABLE",
      message: "GitHub could not be reached to identify the signed-in user.",
      cause,
    });
  }

  let payload = {};
  try {
    payload = await response.json();
  } catch {}

  if (
    !response.ok
    || !Number.isSafeInteger(payload.id)
    || typeof payload.login !== "string"
    || !LOGIN_PATTERN.test(payload.login)
  ) {
    throw new AuthError({
      status: 502,
      code: "GITHUB_USER_INVALID",
      message: "GitHub returned an invalid user identity.",
    });
  }

  return {
    id: String(payload.id),
    login: payload.login,
    name: typeof payload.name === "string" && payload.name.trim() ? payload.name.trim() : null,
    avatarUrl: `https://avatars.githubusercontent.com/u/${payload.id}?v=4`,
    profileUrl: `https://github.com/${payload.login}`,
  };
}

export function signSession(user, secret, {
  issuer = "https://id.hara-lang.org",
  now = Date.now(),
  ttlSeconds = SESSION_TTL_SECONDS,
} = {}) {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new AuthError({
      status: 503,
      code: "AUTH_NOT_CONFIGURED",
      message: "GitHub sign-in is not configured on this deployment.",
    });
  }
  if (
    typeof user?.id !== "string"
    || !/^\d+$/.test(user.id)
    || typeof user?.login !== "string"
    || !LOGIN_PATTERN.test(user.login)
  ) {
    throw new TypeError("A valid GitHub user is required to create a session.");
  }

  const issuedAt = Math.floor(now / 1000);
  const payload = {
    v: 1,
    iss: new URL(issuer).origin,
    provider: "github",
    sub: user.id,
    login: user.login,
    name: typeof user.name === "string" && user.name.trim() ? user.name.trim() : null,
    iat: issuedAt,
    exp: issuedAt + Math.max(60, Math.trunc(ttlSeconds)),
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = base64UrlEncode(createHmac("sha256", secret).update(encodedPayload).digest());
  return `${encodedPayload}.${signature}`;
}

export function verifySession(token, secret, {
  issuer = "https://id.hara-lang.org",
  now = Date.now(),
} = {}) {
  if (typeof token !== "string" || typeof secret !== "string" || secret.length < 32) return null;
  const separator = token.indexOf(".");
  if (separator <= 0 || token.indexOf(".", separator + 1) !== -1) return null;

  const encodedPayload = token.slice(0, separator);
  const suppliedSignature = token.slice(separator + 1);
  const expectedSignature = base64UrlEncode(createHmac("sha256", secret).update(encodedPayload).digest());
  if (!safeEqual(suppliedSignature, expectedSignature)) return null;

  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload).toString("utf8"));
  } catch {
    return null;
  }

  const nowSeconds = Math.floor(now / 1000);
  if (
    payload?.v !== 1
    || payload.iss !== new URL(issuer).origin
    || payload.provider !== "github"
    || typeof payload.sub !== "string"
    || !/^\d+$/.test(payload.sub)
    || typeof payload.login !== "string"
    || !LOGIN_PATTERN.test(payload.login)
    || !Number.isSafeInteger(payload.iat)
    || !Number.isSafeInteger(payload.exp)
    || payload.iat > nowSeconds + 60
    || payload.exp <= nowSeconds
  ) {
    return null;
  }

  return {
    id: payload.sub,
    provider: "github",
    login: payload.login,
    name: typeof payload.name === "string" ? payload.name : null,
    avatarUrl: `https://avatars.githubusercontent.com/u/${payload.sub}?v=4`,
    profileUrl: `https://github.com/${payload.login}`,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
  };
}

export function sessionCookie(token, requestUrl) {
  return serializeCookie(SESSION_COOKIE, token, {
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
    secure: requestIsSecure(requestUrl),
    httpOnly: true,
    sameSite: "Lax",
  });
}

export function clearSessionCookie(requestUrl) {
  return clearCookie(SESSION_COOKIE, {
    path: "/",
    secure: requestIsSecure(requestUrl),
    httpOnly: true,
    sameSite: "Lax",
  });
}

export function corsHeaders(request, env = process.env, methods = ["GET", "HEAD", "OPTIONS"]) {
  const origin = request.headers.get("origin");
  const headers = new Headers({ Vary: "Origin" });
  if (!origin) return headers;
  if (!isAllowedOrigin(origin, env, request.url)) {
    throw new AuthError({
      status: 403,
      code: "ORIGIN_NOT_ALLOWED",
      message: "This origin is not permitted to use the Hara identity session.",
    });
  }
  headers.set("Access-Control-Allow-Origin", new URL(origin).origin);
  headers.set("Access-Control-Allow-Credentials", "true");
  headers.set("Access-Control-Allow-Methods", methods.join(", "));
  headers.set("Access-Control-Allow-Headers", "Accept, Content-Type, X-Hara-Request");
  headers.set("Access-Control-Max-Age", "600");
  return headers;
}

export function appendCookies(headers, cookies = []) {
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return headers;
}

export function responseHeaders(initial = {}) {
  return new Headers({
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    ...initial,
  });
}

export function jsonResponse(payload, {
  status = 200,
  method = "GET",
  headers = {},
} = {}) {
  const response = responseHeaders({
    "Content-Type": "application/json; charset=utf-8",
  });
  new Headers(headers).forEach((value, key) => response.set(key, value));
  return new Response(method === "HEAD" ? null : `${JSON.stringify(payload)}\n`, {
    status,
    headers: response,
  });
}

export function redirectResponse(location, {
  status = 302,
  cookies = [],
} = {}) {
  const headers = appendCookies(responseHeaders({ Location: location }), cookies);
  return new Response(null, { status, headers });
}

export function methodNotAllowed(method, allowed, headers = {}) {
  return jsonResponse({
    error: {
      code: "METHOD_NOT_ALLOWED",
      message: `${method} is not supported for this endpoint.`,
    },
  }, {
    status: 405,
    headers: { ...Object.fromEntries(new Headers(headers)), Allow: allowed.join(", ") },
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function authErrorResponse(error, returnTo = "/") {
  const problem = error instanceof AuthError
    ? error
    : new AuthError({
      status: 500,
      code: "AUTH_INTERNAL_ERROR",
      message: "GitHub sign-in could not be completed.",
      cause: error,
    });
  const title = problem.status >= 500 ? "Sign-in unavailable" : "Sign-in stopped";
  const body = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)} · Hara Identity</title>
  <style>
    :root { color-scheme: dark light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    body { min-height:100vh; display:grid; place-items:center; margin:0; background:#080a0d; color:#f2f4f7; }
    main { width:min(620px,calc(100% - 40px)); }
    p { color:#a8adb6; line-height:1.65; }
    code { color:#cbd4e1; }
    a { display:inline-flex; margin-top:1rem; padding:.7rem 1rem; color:#f2f4f7; border:1px solid #343a43; border-radius:999px; text-decoration:none; }
  </style>
</head>
<body>
  <main>
    <p>HARA / GITHUB IDENTITY</p>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(problem.message)}</p>
    <p><code>${escapeHtml(problem.code)}</code></p>
    <a href="${escapeHtml(returnTo)}">Return to Hara</a>
  </main>
</body>
</html>`;

  return new Response(body, {
    status: problem.status,
    headers: responseHeaders({
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
      "X-Frame-Options": "DENY",
    }),
  });
}
