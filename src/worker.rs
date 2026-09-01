//! Cloudflare Workers/Durable Object entrypoint. Not built by the native
//! `cargo run`/`just api` path (see `src/main.rs`); `wrangler`/`worker-build`
//! compile this for the `wasm32-unknown-unknown` target instead.
//!
//! This reuses `app::router_with_state` and every handler in `app.rs`
//! unchanged. The only platform-specific code lives in `app.rs` itself,
//! behind `#[cfg(target_arch = "wasm32")]` (persistence via Durable Object
//! storage instead of SQLite, and the outbound Channels call via `Fetch`
//! instead of `reqwest`). This file only wires those pieces together:
//! - an outer Worker that forwards every request, unmodified, to a single
//!   fixed-name Durable Object instance (so the whole deployment shares one
//!   `Store`, mirroring the native binary's single-process
//!   `Arc<Mutex<Store>>`);
//! - that Durable Object, which builds an `AppState` from `Env` bindings
//!   (the wasm32 equivalent of `main.rs`'s `std::env::var` parsing) and
//!   calls the shared Axum router.
#![cfg(target_arch = "wasm32")]

use crate::{
    app::{router_with_state, AppState, RelayGateway},
    relay::RelayAllowlist,
};
use tower_service::Service as _;
use worker::{
    durable_object, event, Context, DurableObject, Env, HttpRequest, Request, Result, State,
    Storage,
};

/// Must match the `durable_objects` binding name in `wrangler.toml`.
const DURABLE_OBJECT_BINDING: &str = "RECOVERY_STORE";
/// A single, fixed Durable Object name so every request lands on the same
/// instance -- there is deliberately no per-contract-id/per-token sharding,
/// matching today's single-process behavior.
const DURABLE_OBJECT_NAME: &str = "global";

#[event(fetch)]
async fn fetch(
    req: HttpRequest,
    env: Env,
    _ctx: Context,
) -> Result<http::Response<axum::body::Body>> {
    let namespace = env.durable_object(DURABLE_OBJECT_BINDING)?;
    let stub = namespace.get_by_name(DURABLE_OBJECT_NAME)?;
    let worker_req: Request = req.try_into()?;
    let response = stub.fetch_with_request(worker_req).await?;
    Ok(response.into())
}

#[durable_object]
pub struct RecoveryStore {
    state: State,
    env: Env,
}

impl DurableObject for RecoveryStore {
    fn new(state: State, env: Env) -> Self {
        Self { state, env }
    }

    async fn fetch(&self, req: Request) -> Result<worker::Response> {
        let state = build_app_state(&self.env, self.state.storage())
            .await
            .map_err(|error| worker::Error::from(error.to_string()))?;
        let http_req: HttpRequest = req.try_into()?;
        let axum_req = http_req.map(axum::body::Body::new);
        let axum_resp = match router_with_state(state).call(axum_req).await {
            Ok(response) => response,
            // `Router: Service<Request, Error = Infallible>`.
            Err(never) => match never {},
        };
        axum_resp.try_into()
    }
}

#[derive(Debug, thiserror::Error)]
enum ConfigError {
    #[error("missing or invalid env binding `{0}`")]
    Env(&'static str),
    #[error(transparent)]
    Relay(#[from] crate::app::RelayGatewayConfigError),
}

/// Wasm32 counterpart of `main.rs`'s startup: same env vars, same shape, just
/// read from Workers' `Env` bindings instead of `std::env::var`.
async fn build_app_state(
    env: &Env,
    storage: Storage,
) -> std::result::Result<AppState, ConfigError> {
    let state = AppState::durable(storage)
        .await
        .map_err(|_| ConfigError::Env("durable object storage"))?;

    let operator_credentials = env
        .var("RECOVERY_OPERATOR_CREDENTIALS")
        .ok()
        .map(|value| value.to_string())
        .map(|value| {
            value
                .split(',')
                .filter(|entry| !entry.is_empty())
                .map(|entry| {
                    let (id, token) = entry
                        .split_once('=')
                        .expect("RECOVERY_OPERATOR_CREDENTIALS entries use id=token");
                    (id.to_owned(), token.to_owned())
                })
                .collect()
        })
        .unwrap_or_default();
    let state = state.with_operator_credentials(operator_credentials);

    let state = match env.var("RECOVERY_NETWORK_PASSPHRASE") {
        Ok(network) => state.with_l4_network(network.to_string()),
        Err(_) => state,
    };

    let state = match env.var("RELAY_CHANNELS_URL") {
        Ok(channels_url) => {
            let channels_url = channels_url.to_string();
            let api_key = env
                .secret("RELAY_CHANNELS_API_KEY")
                .map(|value| value.to_string())
                .map_err(|_| ConfigError::Env("RELAY_CHANNELS_API_KEY"))?;
            let allowed_origin = required_var(env, "RELAY_ALLOWED_ORIGIN")?;
            let roots = csv_var(env, "RELAY_WALLET_ROOTS")?;
            let functions = csv_var(env, "RELAY_FUNCTIONS")?
                .into_iter()
                .map(|value| {
                    value
                        .split_once(':')
                        .map(|(contract, function)| (contract.to_owned(), function.to_owned()))
                        .ok_or(ConfigError::Env("RELAY_FUNCTIONS"))
                })
                .collect::<std::result::Result<Vec<_>, _>>()?;
            let wasm_hashes = decode_hashes(csv_var(env, "RELAY_WASM_HASHES")?)?;
            let managed_account_wasm_hashes =
                decode_hashes(csv_var(env, "RELAY_MANAGED_ACCOUNT_WASM_HASHES")?)?;
            let allowlist = RelayAllowlist::new(roots, functions, wasm_hashes)
                .map_err(|_| ConfigError::Env("relay allowlist configuration"))?
                .with_managed_account_wasm_hashes(managed_account_wasm_hashes);
            let gateway = RelayGateway::testnet(channels_url, api_key, allowed_origin, allowlist)?;
            state.with_relay_gateway(gateway)
        }
        Err(_) => state,
    };

    Ok(state)
}

fn required_var(env: &Env, name: &'static str) -> std::result::Result<String, ConfigError> {
    env.var(name)
        .map(|value| value.to_string())
        .map_err(|_| ConfigError::Env(name))
}

fn csv_var(env: &Env, name: &'static str) -> std::result::Result<Vec<String>, ConfigError> {
    Ok(required_var(env, name)?
        .split(',')
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .collect())
}

fn decode_hashes(values: Vec<String>) -> std::result::Result<Vec<[u8; 32]>, ConfigError> {
    values
        .into_iter()
        .map(|hash| {
            hex::decode(hash)
                .ok()
                .and_then(|bytes| bytes.try_into().ok())
                .ok_or(ConfigError::Env("relay wasm hash (32-byte hex)"))
        })
        .collect()
}
