#!/usr/bin/env bash

set -euo pipefail

: "${HARA_IDENTITY_ORIGIN:?HARA_IDENTITY_ORIGIN is required}"
: "${HARA_CONSUMER_ORIGIN:?HARA_CONSUMER_ORIGIN is required}"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export HARA_IDENTITY_EXPECTED_RETURN_ORIGIN="${HARA_CONSUMER_ORIGIN%/}"
exec bash "$script_dir/verify-identity-service.sh"
