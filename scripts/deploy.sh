#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

unset NPM_CONFIG_PREFIX || true
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 22 >/dev/null 2>&1 || true

echo "==> npm test (refuse deploy if red)"
npm test

# Prefer the long-lived bass-build token (CLOUDFLARE_BUILD_TOKEN) over a stale CLOUDFLARE_API_TOKEN.
if [ -n "${CLOUDFLARE_BUILD_TOKEN:-}" ]; then
  export CLOUDFLARE_API_TOKEN="$CLOUDFLARE_BUILD_TOKEN"
fi
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "CLOUDFLARE_API_TOKEN / CLOUDFLARE_BUILD_TOKEN not set" >&2
  exit 1
fi
# Account id avoids wrangler "Getting User settings" auth flakiness with API tokens.
export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-91a68408014ad4deb94e432d231f4af8}"


echo "==> wrangler deploy"
npx wrangler deploy "$@"
