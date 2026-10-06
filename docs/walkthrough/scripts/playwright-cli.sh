#!/usr/bin/env bash
set -euo pipefail

if ! command -v npx >/dev/null 2>&1; then
  echo "Error: npx is required but not found on PATH." >&2
  exit 1
fi

codex_home="${CODEX_HOME:-$HOME/.codex}"
exec npx --yes --package @playwright/cli playwright-cli "$@"

