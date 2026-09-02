set shell := ["bash", "-euo", "pipefail", "-c"]

default:
    @just --list

# Recreate the disposable Protocol 27 chain and the relayer state tied to it.
localnet-reset:
    ./.devcontainer/reset-localnet.sh

# Build and deploy all local Smart Account dependencies and write the public
# Vite configuration to frontend/.env.local.
localnet-deploy:
    ./.devcontainer/deploy-localnet-contracts.sh

# Start from a fresh localnet and deploy a matching contract set.
localnet-bootstrap: localnet-reset localnet-deploy

# Run the API with the generated localnet WASM allowlist, if present.
api:
    if [[ -f .devcontainer/localnet.env ]]; then source .devcontainer/localnet.env; fi; cargo run

# Run the separately sourced Explorer against the quickstart localnet. Its
# browser requests use the dev container's forwarded host port 8011.
explorer:
    cd tools/stellarview-explorer && bun run dev:web -- --port 3001

contracts-build:
    stellar contract build --manifest-path contracts/recovery-scope-policy/Cargo.toml
    stellar contract build --manifest-path contracts/time-delay-policy/Cargo.toml

# Build and deploy the Smart Account contract set to Stellar Testnet, and
# write the matching public configuration to frontend/.env.production and
# .devcontainer/testnet.env. Unlike localnet-deploy this is NOT disposable --
# every run creates a new, permanent Testnet contract set. See
# docs/dev/deployment/testnet.md.
testnet-deploy:
    ./.devcontainer/deploy-testnet-contracts.sh

# Run the API against the Testnet contract set from testnet-deploy. Also set
# RELAY_CHANNELS_API_KEY / RELAY_ALLOWED_ORIGIN / RELAY_CHANNELS_URL /
# RELAY_NETWORK_PASSPHRASE / RECOVERY_NETWORK_PASSPHRASE first (not generated).
api-testnet:
    if [[ -f .devcontainer/testnet.env ]]; then source .devcontainer/testnet.env; fi; cargo run
