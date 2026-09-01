#!/usr/bin/env bash
# Recreate only disposable localnet and relayer state. It deliberately leaves
# the dev container and all developer home/toolchain volumes untouched.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose_file="${repo_root}/.devcontainer/docker-compose.yml"
compose_project="${ACCOUNTSAMPLE_COMPOSE_PROJECT:-account-sample_devcontainer}"
compose=(docker compose -p "${compose_project}" -f "${compose_file}")
services=(
  openzeppelin-relayer-bootstrap
  openzeppelin-relayer
  openzeppelin-relayer-redis
  openzeppelin-relayer-secrets
  stellar-localnet
)

command -v docker >/dev/null || {
  echo "docker is required; run this inside the development container." >&2
  exit 1
}

echo "Resetting Protocol 27 localnet and its relayer state (project: ${compose_project})..."
"${compose[@]}" rm --stop --force "${services[@]}" >/dev/null 2>&1 || true

# Resolve by Compose labels so a custom project name cannot remove another
# project's volumes. These volumes contain chain-specific Channels accounts.
for volume_name in account-sample-relayer-secrets account-sample-relayer-redis; do
  while IFS= read -r volume; do
    [[ -z "${volume}" ]] && continue
    if docker volume rm "${volume}" >/dev/null 2>&1; then
      continue
    fi

    # The dev service mounts only the secret volume read-only, so Docker will
    # refuse to remove it while this script is running inside that service.
    # Clear precisely that labelled volume; the init-secrets service recreates
    # its contents on the next Compose start. Redis must be removable here.
    if [[ "${volume_name}" == "account-sample-relayer-secrets" ]]; then
      docker run --rm -v "${volume}:/secrets:rw" redis:7.4-bookworm \
        sh -ec 'find /secrets -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +'
    else
      echo "Unable to remove the relayer Redis volume ${volume}." >&2
      exit 1
    fi
  done < <(docker volume ls --quiet \
    --filter "label=com.docker.compose.project=${compose_project}" \
    --filter "label=com.docker.compose.volume=${volume_name}")
done

"${compose[@]}" up --detach --force-recreate \
  stellar-localnet openzeppelin-relayer-secrets openzeppelin-relayer-redis \
  openzeppelin-relayer openzeppelin-relayer-bootstrap

localnet_id="$("${compose[@]}" ps --quiet stellar-localnet)"
for _ in $(seq 1 60); do
  status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${localnet_id}")"
  [[ "${status}" == "healthy" ]] && break
  sleep 2
done

if [[ "${status:-}" != "healthy" ]]; then
  echo "stellar-localnet did not become healthy; inspect it with:" >&2
  echo "  ${compose[*]} logs stellar-localnet" >&2
  exit 1
fi

"${compose[@]}" wait openzeppelin-relayer-bootstrap
echo "Localnet and relayer are ready. Run 'just localnet-deploy' next."
