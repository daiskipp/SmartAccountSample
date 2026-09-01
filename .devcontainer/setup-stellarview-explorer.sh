#!/usr/bin/env bash
# Fetch a pinned upstream Explorer and apply the small localnet compatibility
# patch. The source is deliberately ignored: it is a third-party development
# tool, not part of the account-sample application.
set -euo pipefail

readonly EXPLORER_REPOSITORY="https://github.com/StellarViewOrg/stellarview-explorer.git"
readonly EXPLORER_REVISION="b6bf3d7badb3e095472825ec6ef3a3b96b686b66"
readonly WORKSPACE_DIR="/workspaces/account-sample"
readonly EXPLORER_DIR="${WORKSPACE_DIR}/tools/stellarview-explorer"
readonly PATCH_FILE="${WORKSPACE_DIR}/.devcontainer/stellarview-localnet.patch"

if ! command -v bun >/dev/null 2>&1; then
  echo "bun is unavailable; rebuild the Dev Container to install it" >&2
  exit 1
fi

if [ ! -d "${EXPLORER_DIR}/.git" ]; then
  mkdir -p "${WORKSPACE_DIR}/tools"
  git clone "${EXPLORER_REPOSITORY}" "${EXPLORER_DIR}"
fi

git -C "${EXPLORER_DIR}" fetch --depth 1 origin "${EXPLORER_REVISION}"
git -C "${EXPLORER_DIR}" reset --hard "${EXPLORER_REVISION}"
git -C "${EXPLORER_DIR}" apply "${PATCH_FILE}"

if [ ! -d "${EXPLORER_DIR}/node_modules" ]; then
  (
    cd "${EXPLORER_DIR}"
    bun install --frozen-lockfile
  )
fi
