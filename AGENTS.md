# Repository Guidelines

## Project Structure & Module Organization

This repository pairs a Rust 2021 Axum API with a TypeScript/React/Vite frontend implementing Smart Account recovery levels L1-L4. `frontend/` contains the UI (`src/features/recovery/`, `src/smart-account/`) and uses `smart-account-kit` directly in the browser; `frontend/e2e/` holds Playwright specs. `src/main.rs` starts the Axum API (native binary), while `src/worker.rs` is a second, wasm32-only entrypoint that runs the same `app::router_with_state` router inside a Cloudflare Worker + Durable Object (see the README's "Cloudflare Workers deployment" section and `wrangler.toml`); Rust library modules (`src/app.rs`, `src/relay.rs`) contain the server domain logic shared by both. Platform-specific code (persistence, the outbound Channels HTTP call) is isolated behind `#[cfg(target_arch = "wasm32")]` in `src/app.rs` -- check both `cargo check` and `cargo check --target wasm32-unknown-unknown --lib` after touching that file. `contracts/` contains the two custom Soroban policy contracts (`recovery-scope-policy`, `time-delay-policy`). Integration tests live in `tests/`; name new files after the behavior they cover, such as `tests/recovery_flow.rs`.

L1-L3 are wired into the app end to end. L4 (operator-assisted recovery) is implemented but its entry points are currently removed from the app pending a legal review of the operator holding a recovery vote — see the L4 note in `CLAUDE.md` before touching L4 code.

Treat `docs/claude_code_recovery_brief.md` as the feature source of truth. `docs/recovery-levels-demo.html` is a throwaway cryptographic reference, not production code. Keep `docs/dev/context.md` aligned with major architecture changes. Development-container and Stellar localnet setup is under `.devcontainer/`.

`wrangler.toml` (Cloudflare Workers deployment of `src/worker.rs`) deliberately builds via `CARGO_PROFILE_RELEASE_STRIP=false worker-build --release`, not plain `worker-build --release`: the workspace `[profile.release]`'s `strip = true` (Cargo.toml) breaks `wasm-bindgen`'s release codegen (`externref table required for catch wrappers`). Don't remove that env var when touching the build command; `worker-build`'s own `wasm-opt` pass already shrinks the wasm output regardless.

## Build, Test, and Development Commands

- `pnpm --dir frontend install` — install frontend dependencies.
- `pnpm --dir frontend dev` — run the Vite frontend.
- `pnpm --dir frontend build` — type-check and build the frontend.
- `pnpm --dir frontend test` — run frontend unit tests.
- `cargo build` — compile the Axum API and Rust workspace.
- `cargo run` — run the Axum API.
- `cargo test` — run unit and integration tests.
- `cargo clippy -- -D warnings` — lint all targets and reject warnings.
- `cargo fmt --check` — verify formatting without changing files; use `cargo fmt` to apply it.
- `cargo check --target wasm32-unknown-unknown --lib` — type-check the Cloudflare Workers build (`src/worker.rs`); the native `[[bin]]` target isn't wasm32-buildable, so always scope this to `--lib`.
- `python3 -m http.server 8080 --directory docs` — preview the standalone recovery demo.

The old Leptos scaffold has been removed; do not reintroduce it or add `cargo-leptos`. All UI work belongs in `frontend/`.

## Coding Style & Naming Conventions

For Rust, follow `rustfmt.toml`: Rust 2021 formatting, 100-column width, field-init shorthand, Clippy-clean code, and domain logic outside Axum handlers. For TypeScript, use strict mode, functional React components, `PascalCase` components, `camelCase` functions/variables, and keep secret-handling code in browser-only modules.

## Testing Guidelines

Use Rust's built-in test framework for API, relay-gateway, and contract logic; use Vitest for TypeScript units and Playwright for browser/WebAuthn and on-chain E2E. Add focused unit tests beside domain modules and Rust integration behavior in `tests/` and browser flows in `frontend/e2e/`. Test names should state behavior, for example `rejects_plaintext_recovery_secret`. Always run the relevant frontend checks (`pnpm --dir frontend build` and `pnpm --dir frontend test`) plus `cargo test`, Clippy, and the formatting check before submitting. Security-sensitive recovery work must test the invariants documented in `CLAUDE.md` and the feature brief.

## Commit & Pull Request Guidelines

The existing history uses concise, imperative commit subjects (for example, `Scaffold Rust/Leptos implementation...`). Keep each commit focused and explain notable design or security decisions in its body. Pull requests should summarize behavior, list validation commands, link relevant issues/spec sections, and include screenshots for visible UI changes. Call out unresolved product decisions and never commit private keys, recovery phrases, L4 secrets, or local `.env` files.
