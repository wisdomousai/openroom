#!/usr/bin/env bash
set -euo pipefail

walkthrough_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec bun --env-file="$walkthrough_dir/.env.local" "$walkthrough_dir/src/cli.ts" "$@"

