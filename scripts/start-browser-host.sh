#!/usr/bin/env bash
set -euo pipefail
virtual_display_file="$(mktemp)"
Xvfb -displayfd 3 -screen 0 1280x960x24 -nolisten tcp 3>"$virtual_display_file" &
export BROWSER_DISPLAY_PID="$!"
for attempt in {1..50}; do
  if [[ -s "$virtual_display_file" ]]; then break; fi
  kill -0 "$BROWSER_DISPLAY_PID"
  sleep 0.1
done
if [[ ! -s "$virtual_display_file" ]]; then echo "Virtual display did not start." >&2; exit 1; fi
export DISPLAY=":$(cat "$virtual_display_file")"
rm -- "$virtual_display_file"
exec node --import tsx scripts/profile-host.ts
