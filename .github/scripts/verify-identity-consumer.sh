#!/usr/bin/env bash

set -euo pipefail

: "${HARA_IDENTITY_ORIGIN:?HARA_IDENTITY_ORIGIN is required}"
: "${HARA_CONSUMER_ORIGIN:?HARA_CONSUMER_ORIGIN is required}"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
origin="${HARA_IDENTITY_ORIGIN%/}"
consumer_origin="${HARA_CONSUMER_ORIGIN%/}"

HARA_IDENTITY_EXPECTED_RETURN_ORIGIN="$consumer_origin" \
  bash "$script_dir/verify-identity-service.sh"

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

discovery="$tmpdir/discovery.json"
curl --fail --silent --show-error --location \
  --connect-timeout 10 \
  --max-time 20 \
  "$origin/.well-known/hara-session" >"$discovery"

if ! jq -e \
  --arg origin "$origin" \
  --arg consumer "$consumer_origin" '
    .contractVersion == 1
    and .clientVersion == 1
    and .clientEndpoint == ($origin + "/v1/identity-client.js")
    and .legacyClientEndpoint == ($origin + "/identity-client.js")
    and (.allowedOrigins | index($consumer) != null)
  ' "$discovery" >/dev/null; then
  echo "The version-one Hara identity consumer contract is not available for ${consumer_origin}." >&2
  cat "$discovery" >&2
  exit 1
fi

for client in \
  "$origin/v1/identity-client.js" \
  "$origin/identity-client.js"; do
  body="$tmpdir/$(basename "$client").$(printf '%s' "$client" | cksum | awk '{print $1}')"
  if ! curl --fail --silent --show-error --location \
    --connect-timeout 10 \
    --max-time 20 \
    "$client" >"$body"; then
    echo "The shared Hara identity client is unavailable at ${client}." >&2
    exit 1
  fi
  if ! grep -q 'HaraIdentity' "$body"; then
    echo "The response at ${client} is not the shared Hara identity client." >&2
    exit 1
  fi
done

echo "Verified Hara identity contract v1 for ${consumer_origin} through ${origin}."
