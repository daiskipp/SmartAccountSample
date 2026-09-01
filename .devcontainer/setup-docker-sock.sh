#!/usr/bin/env bash
# Ensure the mounted docker socket is usable from inside the container.
# Idempotent: re-running is safe.
set -uo pipefail

SOCK="${DOCKER_HOST:-}"
SOCK="${SOCK#unix://}"
SOCK="${SOCK:-/var/run/docker.sock}"

if [ ! -S "${SOCK}" ]; then
  echo "docker socket ${SOCK} not present; skipping (docker-outside-of-docker not mounted)"
  exit 0
fi

if docker info >/dev/null 2>&1; then
  echo "docker socket already usable"
  exit 0
fi

echo "docker socket present but not accessible; applying chmod 666 (best effort)"
sudo chmod 666 "${SOCK}" 2>/dev/null || chmod 666 "${SOCK}" 2>/dev/null || true

if docker info >/dev/null 2>&1; then
  echo "docker socket now usable"
else
  echo "docker socket still not accessible; check host docker / permissions" >&2
fi
