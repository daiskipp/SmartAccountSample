#!/usr/bin/env bash
# Install the Rust toolchain and the Soroban-compatible wasm32v1-none target if
# not already present. Idempotent: existing installs are detected and skipped.
set -euo pipefail

if ! command -v rustup >/dev/null 2>&1; then
  echo "installing rustup"
  curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs \
    | sh -s -- -y --default-toolchain stable --no-modify-path
fi

# shellcheck disable=SC1090
source "${HOME}/.cargo/env"

rustup target add wasm32v1-none

if command -v cargo >/dev/null 2>&1; then
  echo "cargo installed: $(cargo --version)"
else
  echo "rustup install completed but cargo not on PATH; check ~/.cargo/bin" >&2
  exit 1
fi
