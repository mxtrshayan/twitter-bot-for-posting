#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
  else
    echo "Install Docker Compose first." >&2
    exit 1
  fi
}
echo "Launchpad: checking Docker…"
docker_ready() {
  python3 - <<'CHECK'
import subprocess
try:
    result = subprocess.run(["docker", "info"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15)
    raise SystemExit(result.returncode)
except (subprocess.TimeoutExpired, FileNotFoundError):
    raise SystemExit(1)
CHECK
}
if ! docker_ready; then
  if command -v colima >/dev/null 2>&1; then
    echo "Launchpad: starting Colima…"
    colima start
    if ! docker_ready; then
      echo "Docker is not responding. Restart Colima with: colima stop --force && colima start, then retry ./run.command." >&2
      exit 1
    fi
  else
    echo "Docker is unavailable. Start Docker Desktop, then retry." >&2
    exit 1
  fi
fi
host_pid_file="data/browser-host.pid"
host_is_running() {
  [[ -f "$host_pid_file" ]] || return 1
  local saved_pid
  saved_pid="$(cat "$host_pid_file")"
  [[ "$saved_pid" =~ ^[0-9]+$ ]] || return 1
  ps -p "$saved_pid" -o args= 2>/dev/null | grep -q 'scripts/profile-host.ts'
}
supervisor_is_running() {
  [[ -f data/browser-supervisor.pid ]] || return 1
  local saved_pid
  saved_pid="$(cat data/browser-supervisor.pid)"
  [[ "$saved_pid" =~ ^[0-9]+$ ]] || return 1
  ps -p "$saved_pid" -o args= 2>/dev/null | grep -q 'scripts/browser-supervisor.mjs'
}
stop_browser_host() {
  if supervisor_is_running; then
    kill -TERM "$(cat data/browser-supervisor.pid)"
    for attempt in {1..150}; do
      if ! supervisor_is_running; then break; fi
      sleep 1
    done
    if supervisor_is_running; then echo "Browser service is still stopping." >&2; exit 1; fi
  fi
  if host_is_running; then
    local saved_pid
    saved_pid="$(cat "$host_pid_file")"
    kill -TERM "$saved_pid"
    for attempt in {1..30}; do
      if ! host_is_running; then break; fi
      sleep 1
    done
    if host_is_running; then echo "Browser host is still shutting down. Try stop again shortly." >&2;exit 1;fi
  fi
}
mode="${1:-run}"
shift || true
case "$mode" in
  run)
    if [[ ! -f .env ]]; then
      echo "Create .env from .env.example and configure it before starting." >&2
      exit 1
    fi
    node --import tsx scripts/check-environment.ts
    echo "Launchpad: starting dashboard, database, queue and browsers…"
    stop_browser_host
    compose up -d --wait --wait-timeout 180 "$@"
    node --import tsx scripts/project-ready.ts
    ;;
  stop)
    stop_browser_host
    compose stop --timeout 150 "$@"
    echo "Launchpad stopped. Permanent browser profiles and backend data are preserved."
    ;;
  login)
    npm run login
    ;;
  *) echo "Usage: $0 run [--build] | stop | login" >&2; exit 1 ;;
esac
