#!/usr/bin/env bash
# Install AI CLIs in the remote user npm prefix.
# Pass --update to refresh both packages during a devcontainer rebuild.
set -euo pipefail

NPM_PREFIX="${HOME}/.npm-global"
UPDATE=false

if [ "${1:-}" = "--update" ]; then
  UPDATE=true
fi

mkdir -p "${NPM_PREFIX}"
npm config set prefix "${NPM_PREFIX}" --location=user
export PATH="${NPM_PREFIX}/bin:${PATH}"

install_cli() {
  local command_name="$1"
  local package_name="$2"

  if [ "${UPDATE}" = true ] || [ ! -x "${NPM_PREFIX}/bin/${command_name}" ]; then
    echo "installing ${package_name} in ${NPM_PREFIX}"
    npm install -g "${package_name}"
  else
    echo "${command_name} already installed: $("${NPM_PREFIX}/bin/${command_name}" --version 2>/dev/null || echo unknown)"
  fi
}

install_cli claude @anthropic-ai/claude-code
install_cli codex @openai/codex

echo "AI CLI install step done"
