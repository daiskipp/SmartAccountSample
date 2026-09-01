#!/usr/bin/env bash
# Install the Stellar CLI if it is not already on PATH.
# Idempotent: existing installs are detected and skipped.
set -euo pipefail

if command -v stellar >/dev/null 2>&1; then
  echo "stellar already installed: $(stellar version | head -n 1)"
  exit 0
fi

echo "installing stellar CLI via official install.sh"
curl --proto '=https' --tlsv1.2 -fsSL \
  https://github.com/stellar/stellar-cli/raw/main/install.sh \
  | sh -s -- --user --install-deps

if command -v stellar >/dev/null 2>&1; then
  echo "stellar installed: $(stellar version | head -n 1)"
else
  echo "stellar install completed but binary not on PATH; check ~/.local/bin" >&2
  exit 1
fi
