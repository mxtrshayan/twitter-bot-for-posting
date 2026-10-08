#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
exec node --import tsx scripts/verify-profiles.ts
