# account-sample

Smart Account recovery (L1-L4) implementation. The browser UI is a
TypeScript/React/Vite application in `frontend/`; the former Leptos scaffold is
not used for new UI work. The Axum server provides recovery coordination and an
optional Testnet fee-sponsored relay. See `CLAUDE.md` and
`docs/claude_code_recovery_brief.md` for the feature specification.

L1-L3 (recovery phrase, device pairing, guardian recovery) are wired into the
app end to end. **L4 (operator-assisted recovery) is implemented but currently
unwired** — its app entry points (Dashboard section, `/recovery/help`,
`/recovery/status`) were removed on 2026-08-30 pending a legal review of the
operator holding one recovery vote; the `l4*` frontend modules and the Axum
`/api/l4/*` endpoints remain in the codebase. See the L4 note in `CLAUDE.md`
before touching L4 code.

## Development

### 起動方法（localnet）

初回は **Dev Containers: Rebuild Container** を実行して `just` と Soroban
ビルド用 target を導入する。以降は開発コンテナ内で、次の順に実行する。

```bash
pnpm --dir frontend install
just localnet-bootstrap
```

その後、別々のターミナルで API とフロントエンドを起動する。

```bash
# terminal 1
just api

# terminal 2
pnpm --dir frontend dev
```

ローカルチェーンをブラウズするには、別のターミナルで次を実行する。

```bash
just explorer
```

`http://localhost:3001/ja/localnet` を開く。StellarView Explorer は上流では
Mainnet、Testnet、Futurenet のみを対象にしているため、Dev Container は固定
リビジョンを `tools/stellarview-explorer/` に取得し、localnet 用の互換パッチを
適用する。最初の Dev Container Rebuild / 作成時に Bun と依存関係を導入する。
Explorer の表示用 URL は `http://localhost:8011`（Quickstart の Horizon/RPC）で、
この URL はホスト側から開くブラウザ用である。

ブラウザで Vite が表示する URL（通常 `https://localhost:5173/`）を開く。
`localnet-bootstrap` は新しい localnet に対応した `frontend/.env.local` を
生成するため、手動でコピー・編集する必要はない。

### localnet の再作成

通常は `just localnet-bootstrap` だけでよい。段階ごとに実行する場合は以下を使う。

```bash
just localnet-reset  # localnet と連動する relayer state を再作成
just localnet-deploy # 契約を再ビルド・デプロイし、設定を生成
```

`localnet-bootstrap` recreates the disposable chain and its paired relayer
state, deploys the Smart Account dependencies plus both local recovery
policies, and writes the matching public configuration to
`frontend/.env.local`. It uses a temporary, Friendbot-funded deployer and
deletes its key at the end. Restart Vite if it was already running. Use
`just localnet-reset` and `just localnet-deploy` separately when needed.
The reset does not remove the dev container, source tree, or developer
toolchain volumes. See
[`docs/dev/deployment/localnet.md`](docs/dev/deployment/localnet.md) for the
scope and relayer notes.

The relayer URL is public browser configuration; credentials remain on the
relay service. It is required for account creation: the SDK's shared deployer
never pays transaction fees, and a fee-payer secret must not be put in browser
configuration. Existing-account recovery may submit directly to localnet RPC;
only the account-creation screen stays unavailable until a relay endpoint is
present.

`just api` loads the generated local account-WASM allowlist before starting
Axum. A direct `cargo run` continues to use the environment already supplied
by the dev container, which may refer to an earlier localnet deployment.

### API and Rust workspace

```bash
cargo build
cargo test
cargo clippy -- -D warnings
cargo fmt --check
cargo run   # serves the recovery API on http://127.0.0.1:3000
```

Set `RECOVERY_DATABASE_PATH=/path/to/recovery.db` before `cargo run` to retain
the development recovery state across restarts. Without it, the API uses the
in-memory development store.

For an authenticated 4-eyes gate, set `RECOVERY_OPERATOR_CREDENTIALS` as a
comma-separated `operator-id=bearer-token` list. The approval endpoint then
requires the matching `Authorization: Bearer …` header; do not use this setting
for browser clients or commit its tokens.

To enable Testnet account creation and subsequent recovery setup through the
fee-sponsored gateway, configure the server-only `RELAY_*` values documented
in [`docs/dev/deployment/testnet.md`](docs/dev/deployment/testnet.md). In
particular, set both `RELAY_WASM_HASHES` and
`RELAY_MANAGED_ACCOUNT_WASM_HASHES` to the intended Smart Account artifact.
Only a Channels-confirmed deployment of that explicit artifact gains the fixed
L1--L4 management relay surface; the browser receives no Channels credential.
`just testnet-deploy` builds and deploys that artifact (and this repository's
two recovery policies) to Testnet and writes both `frontend/.env.production`
and the matching `RELAY_*` hashes; see `docs/dev/deployment/testnet.md` for
what stays manual afterward (unlike localnet, it is not disposable — each run
is a new, permanent Testnet deployment).

### Cloudflare Workers deployment (Testnet verification)

`src/worker.rs` is a second entrypoint that runs the same
`app::router_with_state` router inside a Cloudflare Worker (Durable
Object-backed storage, hosted Testnet Channels instead of a self-hosted
Relayer). It covers L1--L3 only; L4 stays unwired regardless of deployment
target.

```bash
cargo check --target wasm32-unknown-unknown --lib
pnpm wrangler deploy
```

See [`docs/dev/deployment/cloudflare.md`](docs/dev/deployment/cloudflare.md)
for one-time setup (`worker-build`, `wrangler login`, the Channels API key),
`wrangler.toml` configuration, the Pages frontend deploy, and verification
steps.

## Status

Implemented API endpoints:

- `POST /api/l4/commit` accepts a verified L4 commitment only; it has no field
  for secret S, a mnemonic, or a private key.
- `POST /api/l4/challenges` and `POST /api/l4/proofs` provide a short-lived,
  single-use, contract-bound Ed25519 proof flow. The signed challenge is also
  domain-separated by network, using the server's configured
  `RECOVERY_NETWORK_PASSPHRASE` rather than a client-supplied value.
- `POST /api/l4/requests/:id/approvals`, `GET .../operator-ready`, and
  `POST .../operator-submit` enforce two distinct approvals before an operator
  action may proceed. `GET /api/l4/status/:contract_id` reports recovery
  status. These L4 endpoints are implemented and tested but not currently
  reachable from the app UI — see the L4 note above.
- `POST /api/pairing/sessions`, `.../relay`, and `.../complete` accept only
  opaque, base64url encrypted payloads and issue short-lived, single-use
  tokens for L2 device pairing.

The in-memory store is intentionally a development scaffold. Before deployment,
replace it with durable storage and authenticated operator identities, then run
the on-chain paths against the target network and audited policy deployments.

A public Testnet deployment (custom policy WASM hashes and contract
addresses) is recorded in
[`docs/dev/deployment/testnet.md`](docs/dev/deployment/testnet.md).

## Guardian recovery scope policy

`contracts/recovery-scope-policy/` is the deny-by-default policy attached to a
guardian recovery rule. It permits only the Smart Account's `add_signer`,
`batch_add_signer`, and `remove_signer` calls when their first argument is
Rule#0. For L4 it also scopes the separate initiation rule to exactly one
Smart Account `execute` call targeting `TimeDelayPolicy.initiate_recovery` and
its finalization-rule ID.
Transfers, application calls, cancellation, and changes to every other rule
are rejected. The L3 UI creates a rule with this policy and the standard
threshold policy; its guardian input intentionally accepts native Stellar
`G...` accounts only. External guardian signers need a separate verifier/key-data
onboarding path before they can safely be exposed.

```bash
cargo test --manifest-path contracts/recovery-scope-policy/Cargo.toml
stellar contract build --manifest-path contracts/recovery-scope-policy/Cargo.toml
```

## TimeDelayPolicy sample contract

`contracts/time-delay-policy/` is a Soroban `Policy` implementation for L4's
cancellable waiting period. It persists pending recovery state using an
`(account, rule id)` key. An operator starts a proposal; once the delay has
elapsed, the policy consumes that proposal atomically while authorizing the
protected signer change. A pending proposal is bound to the exact authorization
context hash and ledger expiry, so it cannot authorize a different signer
operation. The existing account may cancel a proposal.

```bash
cargo test --manifest-path contracts/time-delay-policy/Cargo.toml
stellar contract build --manifest-path contracts/time-delay-policy/Cargo.toml
```

It is a prototype, not an audited policy implementation. Recovery-scoped rules
deny the cancellation `execute` context, so the UI submits cancellation through
the connected default-rule credential. This still requires an on-chain
integration test against the intended Smart Account deployment before release.

See `docs/dev/context.md` for the full tech-stack context.
