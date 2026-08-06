import {
  SESSION_COOKIE,
  AuthError,
  allowedOrigins,
  appendCookies,
  assertOAuthCallback,
  authErrorResponse,
  buildGitHubAuthorizeUrl,
  clearOAuthCookies,
  clearSessionCookie,
  corsHeaders,
  createOAuthAttempt,
  exchangeGitHubCode,
  fetchGitHubUser,
  isAuthConfigured,
  jsonResponse,
  methodNotAllowed,
  oauthAttemptCookies,
  parseCookies,
  readOAuthConfig,
  readSessionSecret,
  redirectResponse,
  responseHeaders,
  safeReturnTo,
  sessionCookie,
  signSession,
  verifySession,
} from "./auth-lib.mjs";

const START_PATHS = new Set(["/github/start", "/auth/github"]);
const CALLBACK_PATH = "/auth/github/callback";
const SESSION_PATHS = new Set(["/session", "/api/v1/session", "/api/auth/session"]);
const LOGOUT_PATHS = new Set(["/logout", "/api/v1/logout", "/auth/logout"]);
const DISCOVERY_PATH = "/.well-known/hara-session";
const WORLD_ORIGINS = Object.freeze({
  production: "https://world.hara-lang.org",
  testing: "https://world.testing.hara-lang.org",
});

export const config = {
  path: [
    "/github/start",
    "/auth/github",
    "/auth/github/callback",
    "/session",
    "/api/v1/session",
    "/api/auth/session",
    "/logout",
    "/api/v1/logout",
    "/auth/logout",
    "/.well-known/hara-session",
  ],
};

function envWithFirstPartyWorldOrigin(env, requestUrl) {
  const request = new URL(requestUrl);
  const isTesting = request.hostname === "id.testing.hara-lang.org"
    || request.hostname.endsWith(".testing.hara-lang.org");
  const configured = env?.HARA_AUTH_ALLOWED_ORIGINS
    || env?.AUTH_ALLOWED_ORIGINS
    || "";
  const worldOrigin = isTesting ? WORLD_ORIGINS.testing : WORLD_ORIGINS.production;
  return {
    ...env,
    HARA_AUTH_ALLOWED_ORIGINS: [configured, worldOrigin].filter(Boolean).join(","),
  };
}

function profilePayload(profile) {
  return profile ? {
    id: profile.id,
    provider: "github",
    login: profile.login,
    name: profile.name,
    avatarUrl: profile.avatarUrl,
    profileUrl: profile.profileUrl,
    expiresAt: profile.expiresAt,
  } : null;
}

function sessionPayload(profile, configured) {
  const publicProfile = profilePayload(profile);
  return {
    authenticated: Boolean(publicProfile),
    configured,
    issuer: "hara-id",
    profile: publicProfile,
    user: publicProfile,
    identity: publicProfile ? {
      provider: "github",
      subject: publicProfile.id,
      login: publicProfile.login,
    } : null,
  };
}

function withCors(request, env, methods) {
  return corsHeaders(request, env, methods);
}

function handleDiscovery(request, env) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return methodNotAllowed(request.method, ["GET", "HEAD"]);
  }
  const origin = new URL(request.url).origin;
  return jsonResponse({
    issuer: origin,
    provider: "github",
    authorizationEndpoint: `${origin}/github/start`,
    callbackEndpoint: `${origin}/auth/github/callback`,
    sessionEndpoint: `${origin}/session`,
    logoutEndpoint: `${origin}/logout`,
    allowedOrigins: [...allowedOrigins(env, request.url)].sort(),
    configured: isAuthConfigured(env),
  }, { method: request.method });
}

function handleStart(request, env) {
  if (request.method !== "GET") {
    return methodNotAllowed(request.method, ["GET"]);
  }
  const url = new URL(request.url);
  const oauth = readOAuthConfig(env, request.url);
  const attempt = createOAuthAttempt(
    url.searchParams.get("returnTo") ?? url.searchParams.get("return_to") ?? "/",
    request.url,
    env,
  );
  const location = buildGitHubAuthorizeUrl({
    clientId: oauth.clientId,
    redirectUri: oauth.redirectUri,
    state: attempt.state,
    challenge: attempt.challenge,
    scope: oauth.scope,
  });
  return redirectResponse(location, {
    cookies: oauthAttemptCookies(attempt, request.url),
  });
}

async function handleCallback(request, env, fetchImpl, now) {
  if (request.method !== "GET") {
    return methodNotAllowed(request.method, ["GET"]);
  }

  const oauth = readOAuthConfig(env, request.url);
  const callback = assertOAuthCallback({
    requestUrl: request.url,
    cookieHeader: request.headers.get("cookie") || "",
    env,
  });
  const accessToken = await exchangeGitHubCode({
    clientId: oauth.clientId,
    clientSecret: oauth.clientSecret,
    code: callback.code,
    redirectUri: oauth.redirectUri,
    verifier: callback.verifier,
  }, fetchImpl);
  const user = await fetchGitHubUser(accessToken, fetchImpl);
  const token = signSession(user, oauth.sessionSecret, {
    issuer: new URL(request.url).origin,
    now,
  });
  return redirectResponse(callback.returnTo, {
    status: 302,
    cookies: [
      ...clearOAuthCookies(request.url),
      sessionCookie(token, request.url),
    ],
  });
}

function handleSession(request, env, now) {
  const methods = ["GET", "HEAD", "OPTIONS"];
  let cors;
  try {
    cors = withCors(request, env, methods);
  } catch (error) {
    return jsonResponse({ error: { code: error.code, message: error.message } }, { status: error.status });
  }
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "GET" && request.method !== "HEAD") {
    return methodNotAllowed(request.method, ["GET", "HEAD", "OPTIONS"], cors);
  }

  const configured = isAuthConfigured(env);
  let profile = null;
  if (configured) {
    const cookies = parseCookies(request.headers.get("cookie") || "");
    profile = verifySession(cookies[SESSION_COOKIE], readSessionSecret(env), {
      issuer: new URL(request.url).origin,
      now,
    });
  }

  return jsonResponse(sessionPayload(profile, configured), {
    method: request.method,
    headers: cors,
  });
}

function handleLogout(request, env) {
  const methods = ["POST", "OPTIONS"];
  let cors;
  try {
    cors = withCors(request, env, methods);
  } catch (error) {
    return jsonResponse({ error: { code: error.code, message: error.message } }, { status: error.status });
  }
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") {
    return methodNotAllowed(request.method, ["POST", "OPTIONS"], cors);
  }

  const headers = responseHeaders();
  cors.forEach((value, key) => headers.set(key, value));
  appendCookies(headers, [clearSessionCookie(request.url)]);
  return new Response(null, { status: 204, headers });
}

export async function handle(request, {
  env = process.env,
  fetchImpl = fetch,
  now = Date.now(),
} = {}) {
  const url = new URL(request.url);
  const effectiveEnv = envWithFirstPartyWorldOrigin(env, request.url);
  try {
    if (url.pathname === DISCOVERY_PATH) return handleDiscovery(request, effectiveEnv);
    if (START_PATHS.has(url.pathname)) return handleStart(request, effectiveEnv);
    if (url.pathname === CALLBACK_PATH) return await handleCallback(request, effectiveEnv, fetchImpl, now);
    if (SESSION_PATHS.has(url.pathname)) return handleSession(request, effectiveEnv, now);
    if (LOGOUT_PATHS.has(url.pathname)) return handleLogout(request, effectiveEnv);
    return jsonResponse({ error: { code: "NOT_FOUND", message: "Unknown identity endpoint." } }, { status: 404 });
  } catch (error) {
    if (SESSION_PATHS.has(url.pathname) || LOGOUT_PATHS.has(url.pathname)) {
      const problem = error instanceof AuthError ? error : new AuthError({ status: 500, code: "AUTH_INTERNAL_ERROR" });
      return jsonResponse({ error: { code: problem.code, message: problem.message } }, { status: problem.status });
    }
    const returnTo = safeReturnTo(url.searchParams.get("returnTo") ?? "/", request.url, effectiveEnv);
    const response = authErrorResponse(error, returnTo);
    if (url.pathname === CALLBACK_PATH) appendCookies(response.headers, clearOAuthCookies(request.url));
    return response;
  }
}

export default async (request) => handle(request);
