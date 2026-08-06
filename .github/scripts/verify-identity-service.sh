#!/usr/bin/env bash

set -euo pipefail

: "${HARA_IDENTITY_ORIGIN:?HARA_IDENTITY_ORIGIN is required}"
: "${HARA_IDENTITY_EXPECTED_RETURN_ORIGIN:?HARA_IDENTITY_EXPECTED_RETURN_ORIGIN is required}"

origin="${HARA_IDENTITY_ORIGIN%/}"
return_origin="${HARA_IDENTITY_EXPECTED_RETURN_ORIGIN%/}"
return_to="${return_origin}/"

case "$origin" in
  https://*|http://localhost:*|http://127.0.0.1:*) ;;
  *)
    echo "HARA_IDENTITY_ORIGIN must be HTTPS, except for a local test server." >&2
    exit 1
    ;;
esac

case "$return_origin" in
  https://*|http://localhost:*|http://127.0.0.1:*) ;;
  *)
    echo "HARA_IDENTITY_EXPECTED_RETURN_ORIGIN must be an absolute origin." >&2
    exit 1
    ;;
esac

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

header_value() {
  local name="$1"
  local file="$2"
  awk -v target="${name,,}" '
    BEGIN { IGNORECASE = 1 }
    {
      key = $1
      sub(/:$/, "", key)
      if (tolower(key) == target) {
        $1 = ""
        sub(/^[[:space:]]+/, "")
        sub(/\r$/, "")
        print
        exit
      }
    }
  ' "$file"
}

assert_header_equals() {
  local file="$1"
  local name="$2"
  local expected="$3"
  local actual
  actual="$(header_value "$name" "$file")"
  if [[ "$actual" != "$expected" ]]; then
    echo "Expected ${name}: ${expected}, got: ${actual:-<missing>}" >&2
    exit 1
  fi
}

request_with_retry() {
  local url="$1"
  local body="$2"
  local headers="$3"
  local status_file="$4"
  local attempt status

  for attempt in {1..20}; do
    status="$(curl --silent --show-error \
      --connect-timeout 10 \
      --max-time 20 \
      --dump-header "$headers" \
      --output "$body" \
      --write-out '%{http_code}' \
      "$url" || true)"
    printf '%s' "$status" >"$status_file"
    if [[ "$status" == "200" ]]; then
      return 0
    fi
    if [[ "$attempt" -lt 20 ]]; then
      echo "Waiting for ${url} to become available (${status:-network error})."
      sleep 5
    fi
  done

  echo "${url} did not return HTTP 200." >&2
  cat "$body" >&2 || true
  return 1
}

discovery_body="$tmpdir/discovery.json"
discovery_headers="$tmpdir/discovery.headers"
discovery_status="$tmpdir/discovery.status"
request_with_retry \
  "$origin/.well-known/hara-session" \
  "$discovery_body" \
  "$discovery_headers" \
  "$discovery_status"

if ! jq -e \
  --arg origin "$origin" \
  --arg returnOrigin "$return_origin" '
    .issuer == $origin
    and .provider == "github"
    and .authorizationEndpoint == ($origin + "/github/start")
    and .callbackEndpoint == ($origin + "/auth/github/callback")
    and .sessionEndpoint == ($origin + "/session")
    and .logoutEndpoint == ($origin + "/logout")
    and .configured == true
    and (.allowedOrigins | index($returnOrigin) != null)
  ' "$discovery_body" >/dev/null; then
  echo "Identity discovery is present but not production-ready at ${origin}." >&2
  echo "Expected configured=true, the exact issuer/endpoints, and ${return_origin} in allowedOrigins." >&2
  cat "$discovery_body" >&2
  exit 1
fi

session_body="$tmpdir/session.json"
session_headers="$tmpdir/session.headers"
session_status="$(curl --silent --show-error \
  --connect-timeout 10 \
  --max-time 20 \
  --header "Origin: ${return_origin}" \
  --dump-header "$session_headers" \
  --output "$session_body" \
  --write-out '%{http_code}' \
  "$origin/session")"

if [[ "$session_status" != "200" ]]; then
  echo "Expected unauthenticated session discovery to return HTTP 200, got ${session_status}." >&2
  cat "$session_body" >&2 || true
  exit 1
fi
assert_header_equals "$session_headers" "Access-Control-Allow-Origin" "$return_origin"
assert_header_equals "$session_headers" "Access-Control-Allow-Credentials" "true"
if ! jq -e '
  .authenticated == false
  and .configured == true
  and .issuer == "hara-id"
  and .profile == null
  and .identity == null
' "$session_body" >/dev/null; then
  echo "The unauthenticated session response does not match the Hara identity contract." >&2
  cat "$session_body" >&2
  exit 1
fi

untrusted_body="$tmpdir/untrusted.json"
untrusted_headers="$tmpdir/untrusted.headers"
untrusted_status="$(curl --silent --show-error \
  --connect-timeout 10 \
  --max-time 20 \
  --header 'Origin: https://untrusted.example' \
  --dump-header "$untrusted_headers" \
  --output "$untrusted_body" \
  --write-out '%{http_code}' \
  "$origin/session")"

if [[ "$untrusted_status" != "403" ]]; then
  echo "Expected an untrusted Origin to receive HTTP 403, got ${untrusted_status}." >&2
  cat "$untrusted_body" >&2 || true
  exit 1
fi
if grep -qi '^access-control-allow-origin:' "$untrusted_headers"; then
  echo "The untrusted session response unexpectedly exposes an Access-Control-Allow-Origin header." >&2
  exit 1
fi

start_headers="$tmpdir/start.headers"
start_status="$(curl --silent --show-error \
  --connect-timeout 10 \
  --max-time 20 \
  --get \
  --data-urlencode "returnTo=${return_to}" \
  --dump-header "$start_headers" \
  --output /dev/null \
  --write-out '%{http_code}' \
  "$origin/github/start")"

if [[ "$start_status" != "302" ]]; then
  echo "Expected /github/start to redirect to GitHub, got HTTP ${start_status}." >&2
  exit 1
fi

location="$(header_value "Location" "$start_headers")"
node - "$location" "$origin" <<'NODE'
const [, , location, origin] = process.argv;
const url = new URL(location);
if (url.origin !== "https://github.com" || url.pathname !== "/login/oauth/authorize") {
  throw new Error(`Unexpected GitHub authorization URL: ${url}`);
}
for (const name of ["client_id", "state", "code_challenge"]) {
  if (!url.searchParams.get(name)) throw new Error(`Missing ${name} in GitHub authorization URL`);
}
if (url.searchParams.get("code_challenge_method") !== "S256") {
  throw new Error("GitHub authorization does not use S256 PKCE");
}
if (url.searchParams.get("redirect_uri") !== `${origin}/auth/github/callback`) {
  throw new Error(`Unexpected redirect_uri: ${url.searchParams.get("redirect_uri")}`);
}
NODE

for cookie_name in hara_id_oauth_state hara_id_oauth_verifier hara_id_oauth_return; do
  if ! grep -qi "^set-cookie: ${cookie_name}=" "$start_headers"; then
    echo "Missing ${cookie_name} OAuth cookie." >&2
    exit 1
  fi
done
if ! grep -qi '^set-cookie: .*HttpOnly' "$start_headers" \
  || ! grep -qi '^set-cookie: .*SameSite=Lax' "$start_headers"; then
  echo "OAuth attempt cookies are missing HttpOnly or SameSite=Lax." >&2
  exit 1
fi
if [[ "$origin" == https://* ]] && ! grep -qi '^set-cookie: .*Secure' "$start_headers"; then
  echo "OAuth attempt cookies are missing Secure on an HTTPS deployment." >&2
  exit 1
fi
if grep -qi '^set-cookie: .*Domain=' "$start_headers"; then
  echo "OAuth attempt cookies must remain host-only." >&2
  exit 1
fi

client_body="$tmpdir/identity-client.js"
client_status="$(curl --silent --show-error \
  --connect-timeout 10 \
  --max-time 20 \
  --output "$client_body" \
  --write-out '%{http_code}' \
  "$origin/identity-client.js")"
if [[ "$client_status" != "200" ]] || ! grep -q 'HaraIdentity' "$client_body"; then
  echo "The shared identity client is not available at ${origin}/identity-client.js." >&2
  exit 1
fi

logout_headers="$tmpdir/logout.headers"
logout_status="$(curl --silent --show-error \
  --connect-timeout 10 \
  --max-time 20 \
  --request POST \
  --header "Origin: ${return_origin}" \
  --header 'X-Hara-Request: sign-out' \
  --dump-header "$logout_headers" \
  --output /dev/null \
  --write-out '%{http_code}' \
  "$origin/logout")"
if [[ "$logout_status" != "204" ]]; then
  echo "Expected /logout to return HTTP 204, got ${logout_status}." >&2
  exit 1
fi
assert_header_equals "$logout_headers" "Access-Control-Allow-Origin" "$return_origin"
assert_header_equals "$logout_headers" "Access-Control-Allow-Credentials" "true"
if ! grep -qi '^set-cookie: hara_identity_session=;.*Max-Age=0' "$logout_headers"; then
  echo "Logout did not clear the central Hara session cookie." >&2
  exit 1
fi
if grep -qi '^set-cookie: .*Domain=' "$logout_headers"; then
  echo "The central session cookie must remain host-only." >&2
  exit 1
fi

echo "Verified GitHub OAuth readiness and shared-session boundaries on ${origin}."
