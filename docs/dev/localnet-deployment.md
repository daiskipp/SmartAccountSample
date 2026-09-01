# Protocol 27 localnet deployment

Localnet contract IDs are disposable. Do not copy old IDs into a frontend
environment: regenerate a matching set after each reset.

After rebuilding the development container (the image installs `just`), run:

```sh
just localnet-bootstrap
just api
pnpm --dir frontend dev
```

`localnet-bootstrap` is equivalent to `just localnet-reset` followed by
`just localnet-deploy`. Reset removes only the `stellar-localnet` and
OpenZeppelin Relayer containers plus the two chain-specific relayer volumes;
it never removes the dev container, workspace, or developer home/toolchain
volumes. Deployment checks out OpenZeppelin `stellar-contracts` at
`fbfde388e1b72afa93d6b1c922067879b20e81db`, builds the Smart Account,
WebAuthn verifier, Ed25519 verifier, threshold policy, and this repository's
recovery-scope/time-delay policies. It writes their public addresses and the
account WASM hash to ignored `frontend/.env.local`.

The deployer is created in a temporary Stellar CLI configuration, funded from
local Friendbot, and discarded after deployment. Its public address is written
as the local L4 operator address, but no operator signing credential is kept;
create an explicitly managed local-only credential if an operator signature is
needed for a manual L4 test.

The script also writes ignored `.devcontainer/localnet.env` with the matching
account WASM allowlists. Use `just api`, which sources it before `cargo run`.

Use the Vite HTTPS RPC proxy for this localnet. Existing-account recovery uses
direct RPC. Account creation additionally needs a fee-sponsored relay endpoint
in `VITE_SMART_ACCOUNT_RELAYER_URL`.
The SDK's shared deployer deliberately cannot be used as a transaction source,
and a fee-payer secret must never be put in a Vite environment file. This
repository's devcontainer provisions a local-only OpenZeppelin Relayer
Channels-backed gateway and its funding accounts. The browser continues to use
`/api/relay`; Axum validates the request before forwarding it to the private
Compose service. The gateway is pinned to the localnet service URL and its
Standalone passphrase, so it cannot be redirected to an arbitrary relayer.

## Local development relayer

After changing the devcontainer definition, run **Dev Containers: Rebuild
Container**. Startup then creates a named Docker volume containing a random API
key and Channels management secret, starts Redis plus OpenZeppelin Relayer
1.8.0, funds the local Channels accounts from Friendbot, and configures those
accounts for the Channels plugin. None of these secrets are written to the
workspace or exposed to Vite.

Check readiness from the Docker host with:

```sh
docker compose -p account-sample_devcontainer -f .devcontainer/docker-compose.yml ps
```

`openzeppelin-relayer` must be healthy and
`openzeppelin-relayer-bootstrap` must have exited successfully before starting
the Axum API. Recreating localnet requires recreating the relayer Redis and
secret volumes too, so that fresh channel accounts are funded on the new chain.
The Vite development certificate is local-only; do not use it for Testnet or
production.

## Testnet relay gateway configuration

`POST /api/relay` accepts the SDK's fee-sponsored `{ "func", "auth" }` and
signed `{ "xdr" }` submissions. It decodes the XDR and rejects every request
except a one-operation Soroban invocation for an allowlisted
contract/function or shared-deployer `CreateContractV2`, with an allowlisted
authorization root and WASM hash. Signed envelopes must also contain bounded
Soroban resource and transaction fees. The backend wraps the accepted payload
as `{ "params": ... }` for Channels; `RELAY_CHANNELS_API_KEY` therefore
belongs only to the Axum process, never to `frontend/.env*`.

```dotenv
RELAY_CHANNELS_URL=https://channels.openzeppelin.com/testnet
RELAY_CHANNELS_API_KEY=server-only-channels-key
RELAY_ALLOWED_ORIGIN=https://your-testnet-frontend.example
RELAY_WALLET_ROOTS=G...,C...
RELAY_FUNCTIONS=C...:execute,C...:__constructor
RELAY_WASM_HASHES=lowercase-64-character-wasm-hash
RELAY_MANAGED_ACCOUNT_WASM_HASHES=lowercase-64-character-smart-account-wasm-hash
```

All relay variables are required when `RELAY_CHANNELS_URL` is set. CORS permits
only `RELAY_ALLOWED_ORIGIN`; do not use a wildcard for a fee-sponsored endpoint.
Keep the lists deployment-specific and minimal. `RELAY_MANAGED_ACCOUNT_WASM_HASHES`
is the subset of creation hashes that represents this application's Smart
Account artifact. After Channels confirms one of those creations, its derived
contract ID is persisted and receives only the fixed recovery-management
surface (`add_policy`, `add_context_rule`, signer add/remove, and `execute`). This lets a newly
created account continue into L1--L4 setup without a gateway restart, while
other allowlisted contract deployments receive no additional relay access. No
Channels credentials or funded Testnet channel account is committed in this
repository.
The operator address is public only; its one-time local development credential
was deleted after deployment. It cannot perform an operator signature until a
new local operator credential is created and funded.

The generated TimeDelayPolicy is the current source build and exposes
`get_pending_for_account`, so the script sets both
`VITE_TIME_DELAY_POLICY_ADDRESS` and `VITE_TIME_DELAY_POLICY_STATUS_ADDRESS`
to that deployment.
