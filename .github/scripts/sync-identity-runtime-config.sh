#!/usr/bin/env bash
set -euo pipefail

: "${NETLIFY_AUTH_TOKEN:?NETLIFY_AUTH_TOKEN is required}"
: "${NETLIFY_SITE_ID:?NETLIFY_SITE_ID is required}"
: "${NETLIFY_ACCOUNT_SLUG:?NETLIFY_ACCOUNT_SLUG is required}"
: "${HARA_GITHUB_OAUTH_CLIENT_ID:?HARA_GITHUB_OAUTH_CLIENT_ID is required}"
: "${HARA_GITHUB_OAUTH_CLIENT_SECRET:?HARA_GITHUB_OAUTH_CLIENT_SECRET is required}"
: "${HARA_AUTH_SESSION_SECRET:?HARA_AUTH_SESSION_SECRET is required}"

api="https://api.netlify.com/api/v1/accounts/${NETLIFY_ACCOUNT_SLUG}/env"
auth="Authorization: Bearer ${NETLIFY_AUTH_TOKEN}"

sync_variable() {
  local key="$1"
  local value="$2"
  local secret="$3"
  local payload
  local status

  payload="$(jq -nc \
    --arg key "$key" \
    --arg value "$value" \
    --argjson secret "$secret" \
    '{key: $key, is_secret: $secret, scopes: ["functions", "runtime"], values: [{context: "production", value: $value}]}')"

  status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
      --header "$auth" \
      "${api}/${key}?site_id=${NETLIFY_SITE_ID}")"

  if [[ "$status" == "200" ]]; then
    curl --fail --silent --show-error --output /dev/null \
      --request PUT \
      --header "$auth" \
      --header "Content-Type: application/json" \
      --data "$payload" \
      "${api}/${key}?site_id=${NETLIFY_SITE_ID}"
  elif [[ "$status" == "404" ]]; then
    curl --fail --silent --show-error --output /dev/null \
      --request POST \
      --header "$auth" \
      --header "Content-Type: application/json" \
      --data "[$payload]" \
      "${api}?site_id=${NETLIFY_SITE_ID}"
  else
    echo "Could not read Netlify environment variable ${key} (HTTP ${status})." >&2
    return 1
  fi

  echo "Synced ${key}."
}

sync_variable HARA_GITHUB_OAUTH_CLIENT_ID "$HARA_GITHUB_OAUTH_CLIENT_ID" true
sync_variable HARA_GITHUB_OAUTH_CLIENT_SECRET "$HARA_GITHUB_OAUTH_CLIENT_SECRET" true
sync_variable HARA_AUTH_SESSION_SECRET "$HARA_AUTH_SESSION_SECRET" true
sync_variable HARA_GITHUB_OAUTH_REDIRECT_URI "https://id.hara-lang.org/auth/github/callback" false
