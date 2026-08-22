#!/usr/bin/env bash
set -euo pipefail

: "${HARA_IDENTITY_ORIGIN:?HARA_IDENTITY_ORIGIN is required}"
: "${HARA_LEARN_ORIGIN:?HARA_LEARN_ORIGIN is required}"

identity_origin="${HARA_IDENTITY_ORIGIN%/}"
learn_origin="${HARA_LEARN_ORIGIN%/}"
callback="${learn_origin}/api/auth/callback"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

curl --fail --silent --show-error --location --max-time 20 \
  "${identity_origin}/.well-known/hara-handoff" >"$work/discovery.json"

jq -e --arg issuer "$identity_origin" --arg callback "$callback" '
  .issuer == $issuer
  and .configured == true
  and .authorizationEndpoint == ($issuer + "/v1/handoffs/authorize")
  and .tokenEndpoint == ($issuer + "/v1/handoffs/token")
  and (.codeChallengeMethodsSupported | index("S256") != null)
  and any(.clients[]; .id == "learn" and .redirectUri == $callback)
' "$work/discovery.json" >/dev/null

state="$(printf 'a%.0s' {1..43})"
challenge="$(printf 'b%.0s' {1..43})"
query="$(jq -rn \
  --arg client_id learn \
  --arg redirect_uri "$callback" \
  --arg state "$state" \
  --arg code_challenge "$challenge" \
  --arg code_challenge_method S256 \
  '$ARGS.named | to_entries | map("\(.key)=\(.value|@uri)") | join("&")')"
authorize_url="${identity_origin}/v1/handoffs/authorize?${query}"

status="$(curl --silent --show-error --max-time 20 \
  --dump-header "$work/authorize.headers" \
  --output "$work/authorize.body" \
  --write-out '%{http_code}' \
  "$authorize_url")"
[[ "$status" == "302" ]]
location="$(awk 'BEGIN{IGNORECASE=1} /^location:/ {sub(/^location:[[:space:]]*/, ""); sub(/\r$/, ""); print; exit}' "$work/authorize.headers")"
node - "$location" "$identity_origin" "$authorize_url" <<'NODE'
const [location, issuer, authorize] = process.argv.slice(2);
const redirect = new URL(location);
if (redirect.origin !== issuer || redirect.pathname !== "/github/start") process.exit(1);
if (redirect.searchParams.get("returnTo") !== authorize) process.exit(1);
NODE

status="$(curl --silent --show-error --max-time 20 \
  --output "$work/token.json" \
  --write-out '%{http_code}' \
  --request POST \
  --header 'Authorization: Basic bGVhcm46d3Jvbmc=' \
  --header 'Content-Type: application/x-www-form-urlencoded' \
  --data 'grant_type=authorization_code&code=invalid&code_verifier=invalid' \
  "${identity_origin}/v1/handoffs/token")"
[[ "$status" == "401" ]]
jq -e '.error.code == "HANDOFF_CLIENT_INVALID"' "$work/token.json" >/dev/null

return_to="${learn_origin}/me"
encoded_return="$(jq -rn --arg value "$return_to" '$value|@uri')"
status="$(curl --silent --show-error --max-time 20 \
  --dump-header "$work/logout.headers" \
  --output /dev/null \
  --write-out '%{http_code}' \
  "${identity_origin}/logout/global?returnTo=${encoded_return}")"
[[ "$status" == "302" ]]
location="$(awk 'BEGIN{IGNORECASE=1} /^location:/ {sub(/^location:[[:space:]]*/, ""); sub(/\r$/, ""); print; exit}' "$work/logout.headers")"
node - "$location" "$learn_origin" "$return_to" <<'NODE'
const [location, learn, returnTo] = process.argv.slice(2);
const redirect = new URL(location);
if (redirect.origin !== learn || redirect.pathname !== "/api/auth/logout") process.exit(1);
if (redirect.searchParams.get("source") !== "hara-identity") process.exit(1);
if (redirect.searchParams.get("returnTo") !== returnTo) process.exit(1);
NODE
if ! grep -qi '^set-cookie: hara_identity_session=;.*Max-Age=0' "$work/logout.headers"; then
  echo "Front-channel logout did not clear the central Identity cookie." >&2
  exit 1
fi

# The final same-origin Learn hop is an HTML bridge. Netlify otherwise propagates the source endpoint's query parameters onto a same-origin HTTP redirect.
status="$(curl --silent --show-error --max-time 20 \
  --dump-header "$work/learn-logout.headers" \
  --output "$work/learn-logout.html" \
  --write-out '%{http_code}' \
  "$location")"
[[ "$status" == "200" ]]
if ! grep -qi '^set-cookie: hara_learn_session=;.*Max-Age=0' "$work/learn-logout.headers"; then
  echo "Front-channel logout did not clear the Learn cookie." >&2
  exit 1
fi
grep -q "data-hara-logout-return href=\"${return_to}\"" "$work/learn-logout.html"
grep -q 'location.replace' "$work/learn-logout.html"
if grep -Eq 'source=hara-identity|returnTo=' "$work/learn-logout.html"; then
  echo "The Learn logout bridge leaked its source query into the return document." >&2
  exit 1
fi

echo "Verified the Learn identity handoff and exact global logout at ${identity_origin}."
