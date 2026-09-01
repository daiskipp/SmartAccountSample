#!/usr/bin/env bash
# Orchestrates devcontainer post-create / post-start setup steps.
# Each step is idempotent and logs to ~/.cache/account-sample-devcontainer/.
set -uo pipefail

LOG_DIR="${HOME}/.cache/account-sample-devcontainer"
mkdir -p "${LOG_DIR}"
LOG_FILE="${LOG_DIR}/setup-all.log"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() {
  echo "[$(date '+%Y-%m-%dT%H:%M:%S%z')] $*" | tee -a "${LOG_FILE}"
}

run_step() {
  local name="$1"
  shift
  log "=== START ${name} ==="
  if "$@" >>"${LOG_FILE}" 2>&1; then
    log "=== OK ${name} ==="
  else
    local rc=$?
    log "=== FAIL ${name} (rc=${rc}) ==="
    status=1
  fi
}

status=0
ai_cli_args=()

if [ "${1:-}" = "--update-ai-clis" ]; then
  ai_cli_args=(--update)
fi

run_step "docker-sock" bash "${SCRIPT_DIR}/setup-docker-sock.sh"
run_step "stellar-localnet" bash "${SCRIPT_DIR}/setup-stellar-localnet.sh"
run_step "stellar-cli" bash "${SCRIPT_DIR}/setup-stellar-cli.sh"
run_step "rust" bash "${SCRIPT_DIR}/setup-rust.sh"
run_step "stellarview-explorer" bash "${SCRIPT_DIR}/setup-stellarview-explorer.sh"
run_step "ai-clis" bash "${SCRIPT_DIR}/setup-ai-clis.sh" "${ai_cli_args[@]}"

if [ "${status}" -ne 0 ]; then
  log "setup-all completed with errors (status=${status})"
else
  log "setup-all completed successfully"
fi

exit "${status}"
