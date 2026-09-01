# CLAUDE.md
常に日本語で分かりやすく回答してください
This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository state

**As of 2026-08-24, this repo is the implementation target** (decided explicitly by the user via `dev-init` — see `docs/dev/context.md`). It is no longer spec-only: a Rust backend scaffold now exists (`Cargo.toml`, `src/`, `tests/`). Contents:

- `docs/claude_code_recovery_brief.md` — the implementation request (Japanese), written as instructions *for* Claude Code to implement an account-recovery feature (L0–L4) for a "Smart Account" project. Still the source of truth for scope; read it in full before implementing recovery logic.
- `docs/recovery-levels-demo.html` — a standalone, single-file prototype (vanilla JS + Web Crypto API, no dependencies) that demonstrates the crypto mechanics for each recovery level in-browser. Open it directly in a browser to see the flows; there's no dev server or build step. It is explicitly a throwaway reference, not code to ship — but it's the closest thing to a spec for the exact crypto operations (ECDH, SAS, commit hashing) each level needs, so port its logic deliberately rather than re-deriving it.
- `docs/dev/context.md` — dev-init-generated tech stack context (TypeScript/React frontend, Rust/Axum API, Soroban, SQLite, build commands). Keep it in sync with reality as the project grows; it records the approved target architecture; some target directories are not scaffolded yet.

The implementation uses the official `stellar/smart-account-kit` TypeScript SDK and OpenZeppelin Stellar smart-account contracts. The brief remains the product source of truth, while explicit decisions in `docs/dev/plans/recovery/` override its older Leptos, standalone reimplementation, and older L4 protocol assumptions.

## Dev environment

`.devcontainer/` (docker-compose based, modeled on the RPG project's) provides:

- A `dev` container with Node.js/pnpm for the TypeScript React/Vite frontend, Python, CLI tools, Stellar CLI, and Rust for the Axum API/relay gateway and Soroban. Do not add cargo-leptos; the old Leptos scaffold is transitional.
- A `stellar-localnet` sibling service (`stellar/quickstart:testing`, protocol 27, pinned as the baseline for smart-account-kit integration), reachable from the dev container at `http://stellar-localnet:8000` (`STELLAR_RPC_URL`/`STELLAR_FRIENDBOT_URL`/`STELLAR_NETWORK_PASSPHRASE` are pre-set in the environment). Not published to the host by default; `ACCOUNTSAMPLE_LOCALNET_HOST_PORT` (default 8011 in `docker-compose.yml`) controls the host-side port if you ever need to hit RPC directly (curl / Stellar Lab) — override it via a `.devcontainer/.env` you create yourself, since Claude Code's write-protection hooks block writing `.env` files.
- Existing-account localnet recovery uses direct RPC through the Vite HTTPS proxy. Browser account deployment needs a fee-sponsored relay because the SDK's shared deployer is deliberately sign-only. Testnet uses an Axum fail-closed gateway in front of OpenZeppelin Relayer 1.5.x with the Channels Plugin; never expose Relayer credentials to the browser.
- **Update (2026-08-30): a second, Cloudflare-hosted deployment path exists for Testnet verification** (added at user request, not part of the brief's scope — see README's "Cloudflare Workers deployment" section). `src/worker.rs` runs the same `app::router_with_state` Axum router inside a Cloudflare Worker, backed by a single Durable Object (`RecoveryStore`, SQLite storage backend) instead of the native binary's optional SQLite file, and talks to OpenZeppelin's *hosted* Testnet Channels service (`https://channels.openzeppelin.com/testnet`) rather than a self-hosted Relayer — so no Redis/Relayer containers are needed for this path. Platform-specific code stays isolated behind `#[cfg(target_arch = "wasm32")]` in `src/app.rs` (persistence, the outbound Channels call); everything else, including the whole `Store`, is shared and unmodified. Building the deployable wasm artifact needs `pkg-config`/`libssl-dev` installed (for `cargo install worker-build`) and hits a `wasm-bindgen` failure ("externref table required for catch wrappers") if Cargo's release-profile `strip = true` isn't disabled for that build — `wrangler.toml`'s `[build].command` already does this (`CARGO_PROFILE_RELEASE_STRIP=false worker-build --release`); do not remove that env var if you touch the build command.

Playwright is installed (`frontend/e2e/`: `recovery-ui.spec.ts`, `testnet-passkey-account.spec.ts`); run it with `pnpm --dir frontend test:e2e`. IPFS remains out of scope.

To preview the static demo inside the container: `python3 -m http.server 8080 --directory docs`, then open `http://localhost:8080/recovery-levels-demo.html`.

### Build & run

```bash
pnpm --dir frontend install
pnpm --dir frontend dev
pnpm --dir frontend build
pnpm --dir frontend test
cargo build
cargo test
cargo clippy -- -D warnings
cargo fmt --check
cargo run   # Axum API
cargo check --target wasm32-unknown-unknown --lib   # Cloudflare Workers build (src/worker.rs); always --lib, the native bin isn't wasm32-buildable
```

## What the brief specifies

Read `docs/claude_code_recovery_brief.md` in full before implementing anything — it's the source of truth. Summary of the shape of the work, for orientation:

- **Domain**: non-custodial smart-account recovery on Stellar/Soroban, layered on an existing **Context Rule × Signer × Policy** authorization model (`kit.rules`, `kit.signers`, `kit.policies`).
- **Scope: implement L1–L4** (L0 = current single-passkey state, unchanged; L5 = future ZK phase, explicitly out of scope):
  - **L1** — backup Ed25519/P-256 key derived from a client-generated word phrase ("ふっかつのじゅもん"), added as a Rule#0 signer. Shown once, never persisted or transmitted.
  - **L2** — multi-device pairing via ECDH + SAS (short authentication string) confirmation, relayed through a server that only ever sees encrypted payloads.
  - **L3** — self-sovereign friend-guardian recovery: a new independent `Rule#Recovery` (signers = guardians, policy = Threshold M-of-N) that can *only* replace Rule#0 signers, never authorize normal account actions.
  - **L4** — operator-guardian recovery via proof-of-possession: client computes `commit = hash(S || contractId)`, server stores only the commit (never `S`). On a recovery request, server hashes the submitted `S` and compares. Requires internal two-person (4-eyes) approval before the operator's Delegated Signer signs on-chain, then a **new custom `TimeDelayPolicy` contract** (the one genuinely new on-chain component — see §4-2 of the brief for its state machine, storage shape, and required functions: `install`, `enforce`, `cancel_recovery`, `get_pending`) gates finalization behind a cancellable waiting period (default 72h).
    **Update (2026-08-30): L4's app entry points were removed** (Dashboard section, `/recovery/help`, `/recovery/status`) — the implementation (setup/request/finalize screens, `l4*` crypto/logic modules, the Axum `/api/l4/*` endpoints) is still in the codebase but unwired. Rationale: the only scenario L4 uniquely covers is losing the recovery phrase too, which only the operator-assisted path can save — and building that requires a legal review of the operator holding one Threshold(2) vote (brief §12-4) that has not happened yet. The self-service fallback (phrase + independent backup key, no operator) is not a substitute: a user who still has the phrase already gets instant, unconditional recovery via L1 (Rule#0's phrase signer is a 1-of-N threshold), so nothing rational would route them through L4's approval-and-delay path instead. Re-wire L4 once the legal review clears.

- **Non-negotiable invariants** (validate against these before considering any implementation done):
  - No private key material, recovery phrase, or the L4 secret `S` ever reaches a server in plaintext — only `commit = hash(S || contractId)` is stored server-side.
  - `Rule#Recovery` never has authority over day-to-day account actions (payments, item ops) — only Rule#0 signer replacement.
  - In the L4 3-signer Threshold(2) setup (operator + user's second factor + recovery-phrase-derived key), the operator holds exactly one vote; the other two signers alone must still satisfy Threshold(2) so recovery works even if the operator is unavailable.
  - User-facing screens must not surface implementation terms like "Context Rule" / "Threshold Policy". **Update (2026-08-26): the RPG-flavored copy from brief §5-3 was replaced with plain, standard account-login/recovery Japanese** (e.g. パスキー/アカウントID/リカバリーフレーズ/ガーディアン/待機期間 instead of 冒険者番号/じゅもん/お願い相手/たすけを呼ぶ) — status/recovery UI copy should stay plain and non-technical, not game-flavored, going forward.

- Full functional/non-functional requirements, the `TimeDelayPolicy` state machine, frontend screen list, data-flow diagram, and test/acceptance criteria are enumerated in the brief's §2–§8 — treat those tables as the checklist, not something to re-derive.
- §12 of the brief lists open questions the author flagged as needing a product/legal decision before or during implementation (delay-period value, whether L4's "second factor" reuses the L1 phrase or is independent, scope of the internal 4-eyes approval tooling, legal review of the operator holding one recovery vote). Surface these rather than silently guessing if they become blocking.
