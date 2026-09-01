#!/usr/bin/env bash
# Ensure the stellar-localnet quickstart container is running.
# Covers the manual `docker stop` case that restart:unless-stopped does not.
# Idempotent: only starts when not already running.
set -uo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "docker CLI not available; skipping stellar-localnet recovery"
  exit 0
fi

CID="$(docker ps -a --filter "label=com.docker.compose.service=stellar-localnet" --format '{{.ID}}' | head -n 1)"

if [ -z "${CID}" ]; then
  echo "stellar-localnet container not found (compose will create it); skipping"
  exit 0
fi

STATUS="$(docker inspect -f '{{.State.Status}}' "${CID}" 2>/dev/null || echo unknown)"

if [ "${STATUS}" = "running" ]; then
  echo "stellar-localnet already running"
  exit 0
fi

echo "stellar-localnet status=${STATUS}; starting"
docker start "${CID}" >/dev/null 2>&1 || true

if [ "$(docker inspect -f '{{.State.Status}}' "${CID}" 2>/dev/null || echo unknown)" = "running" ]; then
  echo "stellar-localnet started"
else
  echo "failed to start stellar-localnet; check docker logs" >&2
fi
