//! Fail-closed recovery API.  The request types deliberately have no secret-S,
//! mnemonic, or private-key field: recovery is proven with an Ed25519 challenge
//! signature from a key derived in the browser.

use crate::relay::{
    managed_contract_from_func_auth, managed_contract_from_xdr, validate_func_auth, validate_xdr,
    RelayAllowlist,
};
use axum::{
    extract::{Path, State},
    http::{header, HeaderMap, HeaderValue, Method, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use rand::{rngs::OsRng, RngCore};
#[cfg(not(target_arch = "wasm32"))]
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};
use tokio::sync::Mutex;
use tower_http::cors::{AllowOrigin, CorsLayer};
use web_time::{SystemTime, UNIX_EPOCH};

const TTL_SECONDS: u64 = 300;
/// Default lifetime for a pairing session when the caller does not request a
/// longer one. Kept distinct from `TTL_SECONDS`, which the L4 challenge flow
/// also uses, so the two lifetimes can move independently.
const PAIRING_DEFAULT_TTL_SECONDS: u64 = TTL_SECONDS;
/// A guardian invite may sit unopened far longer than a live device-pairing
/// QR would, but the store still needs a bound on how long an entry lives.
const PAIRING_MAX_TTL_SECONDS: u64 = 3 * 24 * 3600;
const PAIRING_MIN_TTL_SECONDS: u64 = 60;
const RATE_WINDOW_SECONDS: u64 = 60;
const MAX_PROOF_ATTEMPTS: usize = 5;
const MAX_RELAY_SUBMISSIONS: usize = 20;
const COMMIT_DOMAIN: &[u8] = b"account-sample/l4-commit/v1";
const CHALLENGE_DOMAIN: &[u8] = b"account-sample/l4-challenge/v1";

/// Durable Object storage handle used only by the Workers/wasm32 build. The
/// Storage type wraps a JS object and is not `Send`; `SendWrapper` is sound
/// here because Workers are single-threaded (see `worker::send`).
#[cfg(target_arch = "wasm32")]
pub(crate) type DurableStorage = worker::send::SendWrapper<worker::Storage>;

#[derive(Clone)]
pub struct AppState {
    store: Arc<Mutex<Store>>,
    #[cfg(not(target_arch = "wasm32"))]
    database: Option<Arc<std::sync::Mutex<Connection>>>,
    #[cfg(target_arch = "wasm32")]
    durable_storage: Option<Arc<DurableStorage>>,
    operator_credentials: HashMap<String, String>,
    relay_gateway: Option<RelayGateway>,
    /// The single Stellar network this deployment serves. L4 challenge
    /// signatures are domain-separated by this value rather than by a
    /// client-supplied network string.
    l4_network: String,
}

/// Credentials for the managed Channels service. This type is server-only and
/// is never serialized into an API response.
#[derive(Clone)]
pub struct RelayGateway {
    channels_url: String,
    channels_api_key: String,
    allowed_origin: HeaderValue,
    allowlist: RelayAllowlist,
    network_passphrase: String,
    // The native build sends via a persistent reqwest client. The wasm32
    // build sends per-call via the Workers `Fetch` API instead (see
    // `forward_relay`), so it needs no stored client.
    #[cfg(not(target_arch = "wasm32"))]
    client: reqwest::Client,
}

const TESTNET_CHANNELS_URL: &str = "https://channels.openzeppelin.com/testnet";
// Only the native build ever talks to the self-hosted localnet relayer.
#[cfg(not(target_arch = "wasm32"))]
const LOCALNET_CHANNELS_URL: &str = "http://openzeppelin-relayer:8080/api/v1/plugins/channels/call";
const TESTNET_PASSPHRASE: &str = "Test SDF Network ; September 2015";
const LOCALNET_PASSPHRASE: &str = "Standalone Network ; February 2017";

#[derive(Debug, thiserror::Error)]
pub enum RelayGatewayConfigError {
    #[error("only the OpenZeppelin Testnet Channels endpoint is permitted")]
    Network,
    #[cfg(not(target_arch = "wasm32"))]
    #[error("failed to initialize relay HTTP client")]
    Client(#[from] reqwest::Error),
    #[error("relay allowed origin must be a valid HTTP header value")]
    Origin,
}

#[cfg(not(target_arch = "wasm32"))]
impl RelayGateway {
    pub fn new(
        channels_url: String,
        channels_api_key: String,
        allowed_origin: String,
        allowlist: RelayAllowlist,
    ) -> Result<Self, RelayGatewayConfigError> {
        if channels_url.trim_end_matches('/') != TESTNET_CHANNELS_URL {
            return Err(RelayGatewayConfigError::Network);
        }
        let allowed_origin =
            HeaderValue::from_str(&allowed_origin).map_err(|_| RelayGatewayConfigError::Origin)?;
        Ok(Self {
            channels_url,
            channels_api_key,
            allowed_origin,
            allowlist,
            network_passphrase: TESTNET_PASSPHRASE.to_owned(),
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()?,
        })
    }

    pub fn localnet(
        channels_url: String,
        channels_api_key: String,
        allowed_origin: String,
        allowlist: RelayAllowlist,
    ) -> Result<Self, RelayGatewayConfigError> {
        if channels_url.trim_end_matches('/') != LOCALNET_CHANNELS_URL {
            return Err(RelayGatewayConfigError::Network);
        }
        let allowed_origin =
            HeaderValue::from_str(&allowed_origin).map_err(|_| RelayGatewayConfigError::Origin)?;
        Ok(Self {
            channels_url,
            channels_api_key,
            allowed_origin,
            allowlist,
            network_passphrase: LOCALNET_PASSPHRASE.to_owned(),
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()?,
        })
    }
}

#[cfg(target_arch = "wasm32")]
impl RelayGateway {
    /// Workers builds only ever talk to the hosted Testnet Channels service
    /// (there is no self-hosted localnet relayer to reach from Cloudflare).
    pub fn testnet(
        channels_url: String,
        channels_api_key: String,
        allowed_origin: String,
        allowlist: RelayAllowlist,
    ) -> Result<Self, RelayGatewayConfigError> {
        if channels_url.trim_end_matches('/') != TESTNET_CHANNELS_URL {
            return Err(RelayGatewayConfigError::Network);
        }
        let allowed_origin =
            HeaderValue::from_str(&allowed_origin).map_err(|_| RelayGatewayConfigError::Origin)?;
        Ok(Self {
            channels_url,
            channels_api_key,
            allowed_origin,
            allowlist,
            network_passphrase: TESTNET_PASSPHRASE.to_owned(),
        })
    }
}

#[cfg(not(target_arch = "wasm32"))]
impl RelayGateway {
    async fn send_to_channels(
        &self,
        input: &RelayInput,
    ) -> Result<(StatusCode, serde_json::Value), ApiError> {
        let response = self
            .client
            .post(&self.channels_url)
            .bearer_auth(&self.channels_api_key)
            .json(&serde_json::json!({ "params": input }))
            .send()
            .await
            .map_err(|error| {
                // `reqwest::Error` contains transport/status context but not the
                // Authorization header. Keep this operational signal while never
                // logging a Channels credential or caller payload.
                eprintln!("Channels relay transport failure: {error}");
                ApiError::RelayRejected
            })?;
        let status = response.status();
        let body = response
            .json::<serde_json::Value>()
            .await
            .map_err(|error| {
                eprintln!("Channels relay response parsing failure: {error}");
                ApiError::RelayRejected
            })?;
        Ok((status, body))
    }
}

/// Workers/wasm32 counterpart of `send_to_channels`, using the platform's
/// `Fetch` API instead of a stored `reqwest::Client` (see the `client` field
/// note on `RelayGateway`). Same allowlist/rate-limit checks in
/// `forward_relay` apply before this is ever called.
#[cfg(target_arch = "wasm32")]
impl RelayGateway {
    #[worker::send]
    async fn send_to_channels(
        &self,
        input: &RelayInput,
    ) -> Result<(StatusCode, serde_json::Value), ApiError> {
        let payload = serde_json::to_string(&serde_json::json!({ "params": input }))
            .map_err(|_| ApiError::Invalid)?;
        let headers = worker::Headers::new();
        headers
            .set("content-type", "application/json")
            .map_err(|_| ApiError::RelayRejected)?;
        headers
            .set(
                "authorization",
                &format!("Bearer {}", self.channels_api_key),
            )
            .map_err(|_| ApiError::RelayRejected)?;
        let mut init = worker::RequestInit::new();
        init.with_method(worker::Method::Post)
            .with_headers(headers)
            .with_body(Some(wasm_bindgen::JsValue::from_str(&payload)));
        let request =
            worker::Request::new_with_init(&self.channels_url, &init).map_err(|error| {
                worker::console_error!("Channels relay request build failure: {error:?}");
                ApiError::RelayRejected
            })?;
        let mut response = worker::Fetch::Request(request)
            .send()
            .await
            .map_err(|error| {
                worker::console_error!("Channels relay transport failure: {error:?}");
                ApiError::RelayRejected
            })?;
        let status =
            StatusCode::from_u16(response.status_code()).map_err(|_| ApiError::RelayRejected)?;
        let body: serde_json::Value = response.json().await.map_err(|error| {
            worker::console_error!("Channels relay response parsing failure: {error:?}");
            ApiError::RelayRejected
        })?;
        Ok((status, body))
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            store: Arc::new(Mutex::new(Store::default())),
            #[cfg(not(target_arch = "wasm32"))]
            database: None,
            #[cfg(target_arch = "wasm32")]
            durable_storage: None,
            operator_credentials: HashMap::new(),
            relay_gateway: None,
            l4_network: LOCALNET_PASSPHRASE.to_owned(),
        }
    }
}

#[cfg(not(target_arch = "wasm32"))]
impl AppState {
    /// Opens a durable development store. The persisted state has no field for
    /// S, a phrase, or private-key material.
    pub fn sqlite(path: &str) -> Result<Self, rusqlite::Error> {
        let connection = Connection::open(path)?;
        connection.execute(
            "CREATE TABLE IF NOT EXISTS recovery_state (id INTEGER PRIMARY KEY CHECK (id = 1), data BLOB NOT NULL)",
            [],
        )?;
        let saved: Option<Vec<u8>> = connection
            .query_row("SELECT data FROM recovery_state WHERE id = 1", [], |row| {
                row.get(0)
            })
            .optional()?;
        let store = saved
            .as_deref()
            .map(bincode::deserialize)
            .transpose()
            .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?
            .unwrap_or_default();
        Ok(Self {
            store: Arc::new(Mutex::new(store)),
            database: Some(Arc::new(std::sync::Mutex::new(connection))),
            operator_credentials: HashMap::new(),
            relay_gateway: None,
            l4_network: LOCALNET_PASSPHRASE.to_owned(),
        })
    }
}

/// Builds state backed by a Durable Object's own storage, which is this
/// deployment's equivalent of the native build's optional SQLite file: a
/// single-actor, transactionally-consistent store that survives restarts.
#[cfg(target_arch = "wasm32")]
impl AppState {
    pub(crate) async fn durable(storage: worker::Storage) -> Result<Self, ApiError> {
        let store: Store = storage
            .get("store")
            .await
            .map_err(|_| ApiError::Storage)?
            .unwrap_or_default();
        Ok(Self {
            store: Arc::new(Mutex::new(store)),
            durable_storage: Some(Arc::new(DurableStorage::new(storage))),
            operator_credentials: HashMap::new(),
            relay_gateway: None,
            l4_network: LOCALNET_PASSPHRASE.to_owned(),
        })
    }
}

impl AppState {
    /// Configures authenticated operator identities as `(id, bearer-token)` pairs.
    /// Tokens never enter recovery records or logs.
    pub fn with_operator_credentials(mut self, credentials: HashMap<String, String>) -> Self {
        self.operator_credentials = credentials;
        self
    }

    pub fn with_relay_gateway(mut self, relay_gateway: RelayGateway) -> Self {
        self.relay_gateway = Some(relay_gateway);
        self
    }

    /// Sets the single Stellar network passphrase this deployment serves for
    /// L4 recovery. Defaults to the localnet passphrase.
    pub fn with_l4_network(mut self, network: String) -> Self {
        self.l4_network = network;
        self
    }

    fn authenticated_operator(&self, headers: &HeaderMap) -> Result<Option<String>, ApiError> {
        if self.operator_credentials.is_empty() {
            return Ok(None);
        }
        let token = headers
            .get("authorization")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.strip_prefix("Bearer "))
            .ok_or(ApiError::Invalid)?;
        self.operator_credentials
            .iter()
            .find(|(_, configured)| {
                bool::from(subtle::ConstantTimeEq::ct_eq(
                    configured.as_bytes(),
                    token.as_bytes(),
                ))
            })
            .map(|(operator, _)| Some(operator.clone()))
            .ok_or(ApiError::Invalid)
    }

    #[cfg(not(target_arch = "wasm32"))]
    async fn persist(&self, store: &Store) -> Result<(), ApiError> {
        let Some(database) = &self.database else {
            return Ok(());
        };
        let data = bincode::serialize(store).map_err(|_| ApiError::Storage)?;
        database
            .lock()
            .map_err(|_| ApiError::Storage)?
            .execute(
                "INSERT INTO recovery_state (id, data) VALUES (1, ?1) ON CONFLICT(id) DO UPDATE SET data = excluded.data",
                [data],
            )
            .map_err(|_| ApiError::Storage)?;
        Ok(())
    }

    #[cfg(target_arch = "wasm32")]
    #[worker::send]
    async fn persist(&self, store: &Store) -> Result<(), ApiError> {
        let Some(storage) = &self.durable_storage else {
            return Ok(());
        };
        storage
            .put("store", store)
            .await
            .map_err(|_| ApiError::Storage)?;
        Ok(())
    }
}

#[derive(Default, Deserialize, Serialize)]
struct Store {
    commits: HashMap<Key, [u8; 32]>,
    challenges: HashMap<String, Challenge>,
    requests: HashMap<String, Request>,
    attempts: HashMap<Key, Vec<u64>>,
    #[serde(default)]
    relay_attempts: Vec<u64>,
    /// Contract IDs are added only after Channels confirms an allowlisted
    /// managed-account deployment. This contains no signer material.
    #[serde(default)]
    relay_wallet_roots: HashSet<[u8; 32]>,
    pairing: HashMap<String, Pairing>,
}

#[derive(Clone, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
struct Key {
    contract_id: String,
}
#[derive(Deserialize, Serialize)]
struct Challenge {
    key: Key,
    nonce: [u8; 32],
    expires_at: u64,
    used: bool,
}
#[derive(Deserialize, Serialize)]
struct Request {
    key: Key,
    approvals: HashSet<String>,
    #[serde(default)]
    operator_submitting: bool,
    #[serde(default)]
    operator_submitted: bool,
}
#[derive(Deserialize, Serialize)]
struct Pairing {
    expires_at: u64,
    initial_payload: String,
    #[serde(default)]
    offer_delivered: bool,
    relayed_payload: Option<String>,
    delivered: bool,
    /// Whether the existing device actually added the new signer on-chain.
    /// Carries no secret material, so it is stored and returned in the clear.
    #[serde(default)]
    outcome: Option<bool>,
}

#[derive(Debug, thiserror::Error)]
pub(crate) enum ApiError {
    #[error("invalid request")]
    Invalid,
    #[error("not found")]
    NotFound,
    #[error("expired or already used")]
    Expired,
    #[error("rate limit exceeded")]
    RateLimited,
    #[error("two distinct operator approvals are required")]
    NotReady,
    #[error("recovery state storage failure")]
    Storage,
    #[error("relay gateway is not configured")]
    RelayUnavailable,
    #[error("relay gateway rejected the submission")]
    RelayRejected,
}
impl IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        let status = match self {
            Self::Invalid => StatusCode::UNPROCESSABLE_ENTITY,
            Self::NotFound => StatusCode::NOT_FOUND,
            Self::Expired => StatusCode::GONE,
            Self::RateLimited => StatusCode::TOO_MANY_REQUESTS,
            Self::NotReady => StatusCode::CONFLICT,
            Self::Storage => StatusCode::INTERNAL_SERVER_ERROR,
            Self::RelayUnavailable => StatusCode::SERVICE_UNAVAILABLE,
            Self::RelayRejected => StatusCode::BAD_GATEWAY,
        };
        (
            status,
            Json(Error {
                error: self.to_string(),
            }),
        )
            .into_response()
    }
}
#[derive(Serialize)]
struct Error {
    error: String,
}

/// Registers only a commitment. `proof_public_key` is used to validate the
/// commitment and is intentionally never stored.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RegisterCommit {
    contract_id: String,
    proof_public_key: String,
    commit: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChallengeInput {
    contract_id: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProofInput {
    challenge_id: String,
    proof_public_key: String,
    signature: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ApprovalInput {
    approver_id: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CiphertextInput {
    encrypted_payload: String,
    /// Requested session lifetime in seconds. Clamped to
    /// `[PAIRING_MIN_TTL_SECONDS, PAIRING_MAX_TTL_SECONDS]`; defaults to
    /// `PAIRING_DEFAULT_TTL_SECONDS` when omitted, preserving today's L2
    /// device-pairing behavior.
    #[serde(default)]
    ttl_seconds: Option<u64>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PairingOutcomeInput {
    success: bool,
}
#[derive(Serialize)]
struct PairingOutcomeOutput {
    outcome: Option<bool>,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RelayFuncAuthInput {
    func: String,
    auth: Vec<String>,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RelayXdrInput {
    xdr: String,
}
#[derive(Deserialize, Serialize)]
#[serde(untagged)]
pub enum RelayInput {
    FuncAuth(RelayFuncAuthInput),
    Xdr(RelayXdrInput),
}
#[derive(Serialize)]
struct Registered {
    registered: bool,
}
#[derive(Serialize)]
struct ChallengeOutput {
    challenge_id: String,
    challenge: String,
    expires_at: u64,
}
#[derive(Serialize)]
struct ProofOutput {
    request_id: String,
    state: &'static str,
}
#[derive(Serialize)]
struct ApprovalOutput {
    approval_count: usize,
    operator_action_allowed: bool,
}
#[derive(Serialize)]
struct Status {
    state: &'static str,
    approval_count: usize,
}
#[derive(Serialize)]
struct PairingOutput {
    token: String,
    expires_at: u64,
}
#[derive(Serialize)]
struct Accepted {
    accepted: bool,
}
#[derive(Serialize)]
struct PairingPayloadOutput {
    encrypted_payload: String,
}

pub fn router() -> Router {
    router_with_state(AppState::default())
}

pub fn router_with_state(state: AppState) -> Router {
    let cors = state.relay_gateway.as_ref().map(|gateway| {
        CorsLayer::new()
            .allow_origin(AllowOrigin::exact(gateway.allowed_origin.clone()))
            .allow_methods([Method::POST])
            // smart-account-kit's RelayerClient always sends these two on
            // every request (see node_modules/smart-account-kit/dist/relayer.js);
            // without them allowed, the browser's preflight rejects the real
            // POST before it ever reaches this handler.
            .allow_headers([
                header::CONTENT_TYPE,
                header::HeaderName::from_static("x-client-name"),
                header::HeaderName::from_static("x-client-version"),
            ])
    });
    let router = Router::new()
        .route("/health", get(|| async { StatusCode::NO_CONTENT }))
        .route("/api/l4/commit", post(register_commit))
        .route("/api/l4/challenges", post(create_challenge))
        .route("/api/l4/proofs", post(verify_proof))
        .route("/api/l4/requests/{request_id}/approvals", post(approve))
        .route(
            "/api/l4/requests/{request_id}/operator-submit",
            post(submit_operator_recovery),
        )
        .route(
            "/api/l4/requests/{request_id}/operator-ready",
            get(operator_ready),
        )
        .route("/api/l4/status/{contract_id}", get(status))
        .route("/api/pairing/sessions", post(create_pairing))
        .route("/api/relay", post(relay_submission))
        .route("/api/pairing/sessions/{token}", get(get_pairing))
        .route(
            "/api/pairing/sessions/{token}/relay",
            post(relay_ciphertext).get(get_relayed_ciphertext),
        )
        .route(
            "/api/pairing/sessions/{token}/complete",
            post(report_pairing_outcome).get(get_pairing_outcome),
        )
        .with_state(state);
    match cors {
        Some(cors) => router.layer(cors),
        None => router,
    }
}

async fn relay_submission(
    State(state): State<AppState>,
    Json(input): Json<RelayInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    Ok(Json(forward_relay(&state, input).await?))
}

async fn forward_relay(state: &AppState, input: RelayInput) -> Result<serde_json::Value, ApiError> {
    let gateway = state
        .relay_gateway
        .as_ref()
        .ok_or(ApiError::RelayUnavailable)?;
    let allowlist = {
        let store = state.store.lock().await;
        gateway
            .allowlist
            .clone()
            .with_managed_wallets(store.relay_wallet_roots.iter().copied())
    };
    let created_wallet = match &input {
        RelayInput::FuncAuth(input) => {
            managed_contract_from_func_auth(&input.func, &allowlist, &gateway.network_passphrase)
        }
        RelayInput::Xdr(input) => {
            managed_contract_from_xdr(&input.xdr, &allowlist, &gateway.network_passphrase)
        }
    }
    .map_err(|_| ApiError::Invalid)?;
    match &input {
        RelayInput::FuncAuth(input) => validate_func_auth(&input.func, &input.auth, &allowlist),
        RelayInput::Xdr(input) => validate_xdr(&input.xdr, &allowlist),
    }
    .map_err(|_| ApiError::Invalid)?;
    let mut store = state.store.lock().await;
    let current = now();
    store
        .relay_attempts
        .retain(|attempt| current.saturating_sub(*attempt) < RATE_WINDOW_SECONDS);
    if store.relay_attempts.len() >= MAX_RELAY_SUBMISSIONS {
        return Err(ApiError::RateLimited);
    }
    store.relay_attempts.push(current);
    state.persist(&store).await?;
    drop(store);
    let (status, body) = gateway.send_to_channels(&input).await?;
    accept_channels_response(status, &body)?;
    let body = normalize_channels_response(body);
    if body.get("success").and_then(serde_json::Value::as_bool) == Some(true) {
        if let Some(wallet) = created_wallet {
            let mut store = state.store.lock().await;
            store.relay_wallet_roots.insert(wallet);
            state.persist(&store).await?;
        }
    }
    Ok(body)
}

fn normalize_channels_response(body: serde_json::Value) -> serde_json::Value {
    if body.get("success").and_then(serde_json::Value::as_bool) == Some(true) {
        if let Some(result) = body
            .pointer("/data/result")
            .and_then(serde_json::Value::as_object)
        {
            let mut normalized = result.clone();
            normalized.insert("success".to_owned(), serde_json::Value::Bool(true));
            return serde_json::Value::Object(normalized);
        }
    }
    body
}

fn accept_channels_response(status: StatusCode, body: &serde_json::Value) -> Result<(), ApiError> {
    // Channels returns a structured `{ success: false, code, ... }` body for
    // expected simulation and authorization rejections. Preserve that body so
    // smart-account-kit can surface its error code rather than converting it
    // into an opaque gateway failure. A non-JSON error response is rejected.
    if !status.is_success()
        && body
            .get("success")
            .and_then(serde_json::Value::as_bool)
            .is_none()
    {
        return Err(ApiError::RelayRejected);
    }
    Ok(())
}

async fn register_commit(
    State(state): State<AppState>,
    Json(input): Json<RegisterCommit>,
) -> Result<Json<Registered>, ApiError> {
    let key = key(input.contract_id)?;
    let public_key = bytes::<32>(&input.proof_public_key)?;
    let supplied = bytes::<32>(&input.commit)?;
    if supplied != commit(&public_key, &key.contract_id) {
        return Err(ApiError::Invalid);
    }
    let mut store = state.store.lock().await;
    store.commits.insert(key, supplied);
    state.persist(&store).await?;
    Ok(Json(Registered { registered: true }))
}

async fn create_challenge(
    State(state): State<AppState>,
    Json(input): Json<ChallengeInput>,
) -> Result<Json<ChallengeOutput>, ApiError> {
    let key = key(input.contract_id)?;
    let mut store = state.store.lock().await;
    if !store.commits.contains_key(&key) {
        return Err(ApiError::NotFound);
    }
    let current = now();
    let attempts = store.attempts.entry(key.clone()).or_default();
    attempts.retain(|at| current.saturating_sub(*at) < RATE_WINDOW_SECONDS);
    if attempts.len() >= MAX_PROOF_ATTEMPTS {
        return Err(ApiError::RateLimited);
    }
    attempts.push(current);
    let mut nonce = [0; 32];
    OsRng.fill_bytes(&mut nonce);
    let challenge_id = id();
    let expires_at = current + TTL_SECONDS;
    store.challenges.insert(
        challenge_id.clone(),
        Challenge {
            key,
            nonce,
            expires_at,
            used: false,
        },
    );
    state.persist(&store).await?;
    Ok(Json(ChallengeOutput {
        challenge_id,
        challenge: URL_SAFE_NO_PAD.encode(nonce),
        expires_at,
    }))
}

async fn verify_proof(
    State(state): State<AppState>,
    Json(input): Json<ProofInput>,
) -> Result<Json<ProofOutput>, ApiError> {
    let public_key = bytes::<32>(&input.proof_public_key)?;
    let signature = bytes::<64>(&input.signature)?;
    let mut store = state.store.lock().await;
    let (key, nonce) = {
        let challenge = store
            .challenges
            .get_mut(&input.challenge_id)
            .ok_or(ApiError::NotFound)?;
        if challenge.used || challenge.expires_at < now() {
            return Err(ApiError::Expired);
        }
        challenge.used = true; // failed proofs consume the challenge too.
        (challenge.key.clone(), challenge.nonce)
    };
    // Persist consumption before cryptographic verification. A process restart
    // after a bad signature must not turn a one-time challenge into a replayable one.
    state.persist(&store).await?;
    let saved = store.commits.get(&key).ok_or(ApiError::NotFound)?;
    let recomputed = commit(&public_key, &key.contract_id);
    if !bool::from(subtle::ConstantTimeEq::ct_eq(
        saved.as_slice(),
        recomputed.as_slice(),
    )) {
        return Err(ApiError::Invalid);
    }
    let verifying = VerifyingKey::from_bytes(&public_key).map_err(|_| ApiError::Invalid)?;
    verifying
        .verify(
            &message(&key, &state.l4_network, &nonce),
            &Signature::from_bytes(&signature),
        )
        .map_err(|_| ApiError::Invalid)?;
    let request_id = id();
    store.requests.insert(
        request_id.clone(),
        Request {
            key,
            approvals: HashSet::new(),
            operator_submitting: false,
            operator_submitted: false,
        },
    );
    state.persist(&store).await?;
    Ok(Json(ProofOutput {
        request_id,
        state: "awaiting_operator_approvals",
    }))
}

/// Forwards an operator-produced, already-authorized recovery submission only
/// after two distinct authenticated approvers have released the request. The
/// operator signing key itself remains outside this process (for example, in
/// an HSM or separate operator workstation).
async fn submit_operator_recovery(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(request_id): Path<String>,
    Json(input): Json<RelayInput>,
) -> Result<Json<serde_json::Value>, ApiError> {
    if state.authenticated_operator(&headers)?.is_none() {
        return Err(ApiError::Invalid);
    }
    {
        let mut store = state.store.lock().await;
        let request = store
            .requests
            .get_mut(&request_id)
            .ok_or(ApiError::NotFound)?;
        if request.approvals.len() < 2 {
            return Err(ApiError::NotReady);
        }
        if request.operator_submitting || request.operator_submitted {
            return Err(ApiError::Invalid);
        }
        request.operator_submitting = true;
        state.persist(&store).await?;
    }
    let forwarded = forward_relay(&state, input).await;
    let mut store = state.store.lock().await;
    let request = store
        .requests
        .get_mut(&request_id)
        .ok_or(ApiError::NotFound)?;
    request.operator_submitting = false;
    if forwarded.is_ok() {
        request.operator_submitted = true;
    }
    state.persist(&store).await?;
    forwarded.map(Json)
}

async fn approve(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(request_id): Path<String>,
    Json(input): Json<ApprovalInput>,
) -> Result<Json<ApprovalOutput>, ApiError> {
    if input.approver_id.trim().is_empty() || input.approver_id.len() > 128 {
        return Err(ApiError::Invalid);
    }
    let authenticated_operator = state.authenticated_operator(&headers)?;
    if let Some(operator) = &authenticated_operator {
        if operator != &input.approver_id {
            return Err(ApiError::Invalid);
        }
    }
    let approver_id = authenticated_operator.unwrap_or(input.approver_id);
    let mut store = state.store.lock().await;
    let request = store
        .requests
        .get_mut(&request_id)
        .ok_or(ApiError::NotFound)?;
    request.approvals.insert(approver_id);
    let approval_count = request.approvals.len();
    state.persist(&store).await?;
    Ok(Json(ApprovalOutput {
        approval_count,
        operator_action_allowed: approval_count >= 2,
    }))
}

async fn operator_ready(
    State(state): State<AppState>,
    Path(request_id): Path<String>,
) -> Result<Json<Status>, ApiError> {
    let store = state.store.lock().await;
    let request = store.requests.get(&request_id).ok_or(ApiError::NotFound)?;
    if request.approvals.len() < 2 {
        return Err(ApiError::NotReady);
    }
    Ok(Json(Status {
        state: if request.operator_submitted {
            "operator_action_submitted"
        } else {
            "operator_action_allowed"
        },
        approval_count: request.approvals.len(),
    }))
}

async fn status(
    State(state): State<AppState>,
    Path(contract_id): Path<String>,
) -> Result<Json<Status>, ApiError> {
    let target = key(contract_id)?;
    let store = state.store.lock().await;
    let request = store
        .requests
        .values()
        .filter(|request| request.key == target)
        .max_by_key(|request| request.approvals.len());
    let approval_count = request.map(|request| request.approvals.len()).unwrap_or(0);
    let state = if request.is_some_and(|request| request.operator_submitted) {
        "operator_action_submitted"
    } else if approval_count >= 2 {
        "operator_action_allowed"
    } else if approval_count > 0 {
        "awaiting_operator_approvals"
    } else {
        "no_pending_recovery"
    };
    Ok(Json(Status {
        state,
        approval_count,
    }))
}

async fn create_pairing(
    State(state): State<AppState>,
    Json(input): Json<CiphertextInput>,
) -> Result<Json<PairingOutput>, ApiError> {
    ciphertext(&input.encrypted_payload)?;
    let token = id();
    let ttl = input
        .ttl_seconds
        .unwrap_or(PAIRING_DEFAULT_TTL_SECONDS)
        .clamp(PAIRING_MIN_TTL_SECONDS, PAIRING_MAX_TTL_SECONDS);
    let expires_at = now() + ttl;
    let mut store = state.store.lock().await;
    store.pairing.insert(
        token.clone(),
        Pairing {
            expires_at,
            initial_payload: input.encrypted_payload,
            offer_delivered: false,
            relayed_payload: None,
            delivered: false,
            outcome: None,
        },
    );
    state.persist(&store).await?;
    Ok(Json(PairingOutput { token, expires_at }))
}

async fn get_pairing(
    State(state): State<AppState>,
    Path(token): Path<String>,
) -> Result<Json<PairingPayloadOutput>, ApiError> {
    let mut store = state.store.lock().await;
    let pairing = store.pairing.get_mut(&token).ok_or(ApiError::NotFound)?;
    if pairing.offer_delivered || pairing.expires_at < now() {
        return Err(ApiError::Expired);
    }
    pairing.offer_delivered = true;
    let encrypted_payload = pairing.initial_payload.clone();
    state.persist(&store).await?;
    Ok(Json(PairingPayloadOutput { encrypted_payload }))
}

async fn relay_ciphertext(
    State(state): State<AppState>,
    Path(token): Path<String>,
    Json(input): Json<CiphertextInput>,
) -> Result<Json<Accepted>, ApiError> {
    ciphertext(&input.encrypted_payload)?;
    let mut store = state.store.lock().await;
    let pairing = store.pairing.get_mut(&token).ok_or(ApiError::NotFound)?;
    if pairing.relayed_payload.is_some() || pairing.expires_at < now() {
        return Err(ApiError::Expired);
    }
    pairing.relayed_payload = Some(input.encrypted_payload);
    state.persist(&store).await?;
    Ok(Json(Accepted { accepted: true }))
}

async fn get_relayed_ciphertext(
    State(state): State<AppState>,
    Path(token): Path<String>,
) -> Result<Json<PairingPayloadOutput>, ApiError> {
    let mut store = state.store.lock().await;
    let pairing = store.pairing.get_mut(&token).ok_or(ApiError::NotFound)?;
    if pairing.delivered || pairing.expires_at < now() {
        return Err(ApiError::Expired);
    }
    let encrypted_payload = pairing.relayed_payload.clone().ok_or(ApiError::NotFound)?;
    pairing.delivered = true;
    state.persist(&store).await?;
    Ok(Json(PairingPayloadOutput { encrypted_payload }))
}

/// The existing device reports whether it actually added the new signer
/// on-chain, so the new device can stop waiting instead of guessing from
/// silence. Carries no secret material, so this is stored in the clear and
/// may be overwritten (e.g. a failed submission retried as a success).
async fn report_pairing_outcome(
    State(state): State<AppState>,
    Path(token): Path<String>,
    Json(input): Json<PairingOutcomeInput>,
) -> Result<Json<Accepted>, ApiError> {
    let mut store = state.store.lock().await;
    let pairing = store.pairing.get_mut(&token).ok_or(ApiError::NotFound)?;
    if pairing.expires_at < now() {
        return Err(ApiError::Expired);
    }
    pairing.outcome = Some(input.success);
    state.persist(&store).await?;
    Ok(Json(Accepted { accepted: true }))
}

async fn get_pairing_outcome(
    State(state): State<AppState>,
    Path(token): Path<String>,
) -> Result<Json<PairingOutcomeOutput>, ApiError> {
    let store = state.store.lock().await;
    let pairing = store.pairing.get(&token).ok_or(ApiError::NotFound)?;
    if pairing.expires_at < now() {
        return Err(ApiError::Expired);
    }
    Ok(Json(PairingOutcomeOutput {
        outcome: pairing.outcome,
    }))
}

fn key(contract_id: String) -> Result<Key, ApiError> {
    if contract_id.is_empty() || contract_id.len() > 256 {
        return Err(ApiError::Invalid);
    }
    Ok(Key { contract_id })
}
fn bytes<const N: usize>(value: &str) -> Result<[u8; N], ApiError> {
    URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| ApiError::Invalid)?
        .try_into()
        .map_err(|_| ApiError::Invalid)
}
fn commit(public_key: &[u8; 32], contract_id: &str) -> [u8; 32] {
    Sha256::new()
        .chain_update(COMMIT_DOMAIN)
        .chain_update(public_key)
        .chain_update(contract_id.as_bytes())
        .finalize()
        .into()
}
fn message(key: &Key, network: &str, nonce: &[u8; 32]) -> Vec<u8> {
    [
        CHALLENGE_DOMAIN,
        key.contract_id.as_bytes(),
        network.as_bytes(),
        nonce,
    ]
    .concat()
}
fn ciphertext(value: &str) -> Result<(), ApiError> {
    if value.is_empty() || value.len() > 16_384 || URL_SAFE_NO_PAD.decode(value).is_err() {
        Err(ApiError::Invalid)
    } else {
        Ok(())
    }
}
fn id() -> String {
    let mut value = [0; 24];
    OsRng.fill_bytes(&mut value);
    URL_SAFE_NO_PAD.encode(value)
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::{to_bytes, Body},
        http::{Request, StatusCode},
    };
    use ed25519_dalek::{Signer, SigningKey};
    use tower::ServiceExt;

    async fn post(router: Router, path: &str, body: serde_json::Value) -> axum::response::Response {
        router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(path)
                    .header("content-type", "application/json")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap()
    }

    async fn json(response: axum::response::Response) -> serde_json::Value {
        serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap()).unwrap()
    }

    async fn get(router: Router, path: &str) -> axum::response::Response {
        router
            .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
            .await
            .unwrap()
    }

    #[test]
    fn commitment_is_contract_bound() {
        assert_ne!(commit(&[7; 32], "one"), commit(&[7; 32], "two"));
    }
    #[test]
    fn signed_challenge_is_network_bound() {
        let nonce = [1; 32];
        let key = Key {
            contract_id: "c".into(),
        };
        assert_ne!(message(&key, "n1", &nonce), message(&key, "n2", &nonce));
    }

    #[test]
    fn configured_operator_identity_requires_the_matching_bearer_token() {
        let state = AppState::default()
            .with_operator_credentials(HashMap::from([("operator-a".into(), "token-a".into())]));
        let mut headers = HeaderMap::new();
        assert!(state.authenticated_operator(&headers).is_err());
        headers.insert("authorization", "Bearer token-a".parse().unwrap());
        assert_eq!(
            state.authenticated_operator(&headers).unwrap(),
            Some("operator-a".into())
        );
        headers.insert("authorization", "Bearer wrong".parse().unwrap());
        assert!(state.authenticated_operator(&headers).is_err());
    }

    #[test]
    fn relay_gateway_is_pinned_to_the_testnet_channels_service() {
        assert!(RelayGateway::new(
            "https://channels.openzeppelin.com/mainnet".into(),
            "server-only-key".into(),
            "https://frontend.example".into(),
            RelayAllowlist::default(),
        )
        .is_err());
        assert!(RelayGateway::new(
            TESTNET_CHANNELS_URL.into(),
            "server-only-key".into(),
            "https://frontend.example".into(),
            RelayAllowlist::default(),
        )
        .is_ok());
        assert!(RelayGateway::localnet(
            LOCALNET_CHANNELS_URL.into(),
            "server-only-key".into(),
            "https://frontend.example".into(),
            RelayAllowlist::default(),
        )
        .is_ok());
        assert!(RelayGateway::localnet(
            "http://untrusted-relayer:8080/api/v1/plugins/channels/call".into(),
            "server-only-key".into(),
            "https://frontend.example".into(),
            RelayAllowlist::default(),
        )
        .is_err());
    }

    #[test]
    fn channels_success_is_normalized_for_smart_account_kit() {
        let body = serde_json::json!({
            "success": true,
            "data": { "result": { "transactionId": "tx-1", "hash": "abc", "status": "confirmed" } },
            "error": null
        });
        assert_eq!(
            normalize_channels_response(body),
            serde_json::json!({
                "success": true, "transactionId": "tx-1", "hash": "abc", "status": "confirmed"
            })
        );
    }

    #[test]
    fn structured_channels_rejections_reach_the_sdk_but_html_errors_do_not() {
        let structured = serde_json::json!({ "success": false, "code": "SIMULATION_FAILED" });
        assert!(accept_channels_response(StatusCode::BAD_REQUEST, &structured).is_ok());
        assert!(accept_channels_response(
            StatusCode::BAD_GATEWAY,
            &serde_json::json!({ "error": "proxy" }),
        )
        .is_err());
    }

    #[tokio::test]
    async fn l4_proof_flow_never_accepts_secret_s_and_requires_distinct_approvals() {
        let router = router();
        let contract_id = "contract";
        let mut proof_secret = [0; 32];
        OsRng.fill_bytes(&mut proof_secret);
        let proof_key = SigningKey::from_bytes(&proof_secret);
        let public_key = proof_key.verifying_key().to_bytes();
        let commit = commit(&public_key, contract_id);

        let rejected = post(
            router.clone(),
            "/api/l4/commit",
            serde_json::json!({
                "contract_id": contract_id,
                "proof_public_key": URL_SAFE_NO_PAD.encode(public_key),
                "commit": URL_SAFE_NO_PAD.encode(commit),
                "secret": "must-not-be-accepted",
            }),
        )
        .await;
        assert_eq!(rejected.status(), StatusCode::UNPROCESSABLE_ENTITY);

        let registered = post(
            router.clone(),
            "/api/l4/commit",
            serde_json::json!({
                "contract_id": contract_id,
                "proof_public_key": URL_SAFE_NO_PAD.encode(public_key),
                "commit": URL_SAFE_NO_PAD.encode(commit),
            }),
        )
        .await;
        assert_eq!(registered.status(), StatusCode::OK);

        let challenge = json(
            post(
                router.clone(),
                "/api/l4/challenges",
                serde_json::json!({ "contract_id": contract_id }),
            )
            .await,
        )
        .await;
        let nonce: [u8; 32] = URL_SAFE_NO_PAD
            .decode(challenge["challenge"].as_str().unwrap())
            .unwrap()
            .try_into()
            .unwrap();
        let signature = proof_key.sign(&message(
            &Key {
                contract_id: contract_id.into(),
            },
            LOCALNET_PASSPHRASE,
            &nonce,
        ));
        let proof = json(
            post(
                router.clone(),
                "/api/l4/proofs",
                serde_json::json!({
                    "challenge_id": challenge["challenge_id"],
                    "proof_public_key": URL_SAFE_NO_PAD.encode(public_key),
                    "signature": URL_SAFE_NO_PAD.encode(signature.to_bytes()),
                }),
            )
            .await,
        )
        .await;
        let request_id = proof["request_id"].as_str().unwrap();

        let first_approval = post(
            router.clone(),
            &format!("/api/l4/requests/{request_id}/approvals"),
            serde_json::json!({ "approver_id": "operator-a" }),
        )
        .await;
        assert_eq!(first_approval.status(), StatusCode::OK);
        let still_not_ready = router
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!("/api/l4/requests/{request_id}/operator-ready"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(still_not_ready.status(), StatusCode::CONFLICT);

        let duplicate_approval = json(
            post(
                router.clone(),
                &format!("/api/l4/requests/{request_id}/approvals"),
                serde_json::json!({ "approver_id": "operator-a" }),
            )
            .await,
        )
        .await;
        assert_eq!(duplicate_approval["approval_count"], 1);
        let second_approval = json(
            post(
                router.clone(),
                &format!("/api/l4/requests/{request_id}/approvals"),
                serde_json::json!({ "approver_id": "operator-b" }),
            )
            .await,
        )
        .await;
        assert_eq!(second_approval["operator_action_allowed"], true);
    }

    #[tokio::test]
    async fn l4_challenge_requests_are_rate_limited_per_recovery_target() {
        let router = router();
        let public_key = [8; 32];
        let contract_id = "contract";
        let registered = post(
            router.clone(),
            "/api/l4/commit",
            serde_json::json!({
                "contract_id": contract_id,
                "proof_public_key": URL_SAFE_NO_PAD.encode(public_key),
                "commit": URL_SAFE_NO_PAD.encode(commit(&public_key, contract_id)),
            }),
        )
        .await;
        assert_eq!(registered.status(), StatusCode::OK);

        let request = serde_json::json!({ "contract_id": contract_id });
        for _ in 0..MAX_PROOF_ATTEMPTS {
            let response = post(router.clone(), "/api/l4/challenges", request.clone()).await;
            assert_eq!(response.status(), StatusCode::OK);
        }
        let limited = post(router, "/api/l4/challenges", request).await;
        assert_eq!(limited.status(), StatusCode::TOO_MANY_REQUESTS);
    }

    #[tokio::test]
    async fn relay_is_unavailable_until_server_only_channels_credentials_are_configured() {
        let response = post(
            router(),
            "/api/relay",
            serde_json::json!({ "func": "not-xdr", "auth": ["not-xdr"] }),
        )
        .await;
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    }

    #[tokio::test]
    async fn relay_cors_allows_only_the_configured_frontend_origin() {
        let state = AppState::default().with_relay_gateway(
            RelayGateway::new(
                TESTNET_CHANNELS_URL.into(),
                "server-only-key".into(),
                "https://frontend.example".into(),
                RelayAllowlist::default(),
            )
            .unwrap(),
        );
        let response = router_with_state(state)
            .oneshot(
                Request::builder()
                    .method("OPTIONS")
                    .uri("/api/relay")
                    .header("origin", "https://frontend.example")
                    .header("access-control-request-method", "POST")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            response
                .headers()
                .get("access-control-allow-origin")
                .unwrap(),
            "https://frontend.example"
        );
    }

    #[tokio::test]
    async fn relay_cors_allows_the_headers_smart_account_kit_actually_sends() {
        // smart-account-kit's RelayerClient always sends X-Client-Name and
        // X-Client-Version (see node_modules/smart-account-kit/dist/relayer.js);
        // a preflight that only allows Content-Type makes the browser reject
        // every real submission before it reaches this handler.
        let state = AppState::default().with_relay_gateway(
            RelayGateway::new(
                TESTNET_CHANNELS_URL.into(),
                "server-only-key".into(),
                "https://frontend.example".into(),
                RelayAllowlist::default(),
            )
            .unwrap(),
        );
        let response = router_with_state(state)
            .oneshot(
                Request::builder()
                    .method("OPTIONS")
                    .uri("/api/relay")
                    .header("origin", "https://frontend.example")
                    .header("access-control-request-method", "POST")
                    .header(
                        "access-control-request-headers",
                        "content-type,x-client-name,x-client-version",
                    )
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let allowed = response
            .headers()
            .get("access-control-allow-headers")
            .unwrap()
            .to_str()
            .unwrap()
            .to_ascii_lowercase();
        for header in ["content-type", "x-client-name", "x-client-version"] {
            assert!(allowed.contains(header), "missing {header} in {allowed}");
        }
    }

    #[tokio::test]
    async fn operator_submission_requires_two_authenticated_approvals_before_relaying() {
        let state = AppState::default()
            .with_operator_credentials(HashMap::from([("operator-a".into(), "token-a".into())]));
        let mut store = state.store.lock().await;
        store.requests.insert(
            "request".into(),
            super::Request {
                key: Key {
                    contract_id: "c".into(),
                },
                approvals: HashSet::from(["operator-a".into()]),
                operator_submitting: false,
                operator_submitted: false,
            },
        );
        drop(store);
        let router = router_with_state(state);
        let response = router
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/l4/requests/request/operator-submit")
                    .header("content-type", "application/json")
                    .header("authorization", "Bearer token-a")
                    .body(Body::from(r#"{"func":"not-xdr","auth":["not-xdr"]}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn sqlite_store_restores_commitments_without_secret_material() {
        let path = std::env::temp_dir().join(format!("account-sample-{}.db", id()));
        let key = Key {
            contract_id: "contract".into(),
        };
        let state = AppState::sqlite(path.to_str().unwrap()).unwrap();
        let mut store = state.store.lock().await;
        store.commits.insert(key.clone(), [9; 32]);
        store.challenges.insert(
            "consumed".into(),
            Challenge {
                key: key.clone(),
                nonce: [1; 32],
                expires_at: 100,
                used: true,
            },
        );
        state.persist(&store).await.unwrap();
        drop(store);
        drop(state);

        let restored = AppState::sqlite(path.to_str().unwrap()).unwrap();
        let store = restored.store.lock().await;
        assert_eq!(store.commits.get(&key), Some(&[9; 32]));
        assert!(store.challenges["consumed"].used);
        drop(store);
        drop(restored);
        std::fs::remove_file(path).unwrap();
    }

    #[tokio::test]
    async fn pairing_relay_delivers_only_opaque_ciphertext_once() {
        let router = router();
        let session = json(
            post(
                router.clone(),
                "/api/pairing/sessions",
                serde_json::json!({ "encrypted_payload": "AQ" }),
            )
            .await,
        )
        .await;
        let token = session["token"].as_str().unwrap();

        let initial =
            json(get(router.clone(), &format!("/api/pairing/sessions/{token}")).await).await;
        assert_eq!(initial["encrypted_payload"], "AQ");
        let repeated_offer = get(router.clone(), &format!("/api/pairing/sessions/{token}")).await;
        assert_eq!(repeated_offer.status(), StatusCode::GONE);
        let relayed = post(
            router.clone(),
            &format!("/api/pairing/sessions/{token}/relay"),
            serde_json::json!({ "encrypted_payload": "Ag" }),
        )
        .await;
        assert_eq!(relayed.status(), StatusCode::OK);

        let delivered = json(
            get(
                router.clone(),
                &format!("/api/pairing/sessions/{token}/relay"),
            )
            .await,
        )
        .await;
        assert_eq!(delivered["encrypted_payload"], "Ag");
        let replay = get(router, &format!("/api/pairing/sessions/{token}/relay")).await;
        assert_eq!(replay.status(), StatusCode::GONE);
    }

    #[tokio::test]
    async fn pairing_session_ttl_defaults_and_clamps() {
        let router = router();

        let default_session = json(
            post(
                router.clone(),
                "/api/pairing/sessions",
                serde_json::json!({ "encrypted_payload": "AQ" }),
            )
            .await,
        )
        .await;
        let before = now();
        let default_expires_at = default_session["expires_at"].as_u64().unwrap();
        assert!(default_expires_at >= before + PAIRING_DEFAULT_TTL_SECONDS);
        assert!(default_expires_at <= before + PAIRING_DEFAULT_TTL_SECONDS + 5);

        let long_session = json(
            post(
                router.clone(),
                "/api/pairing/sessions",
                serde_json::json!({ "encrypted_payload": "AQ", "ttl_seconds": 72 * 3600 }),
            )
            .await,
        )
        .await;
        let long_expires_at = long_session["expires_at"].as_u64().unwrap();
        assert!(long_expires_at >= before + 72 * 3600);

        let clamped_session = json(
            post(
                router.clone(),
                "/api/pairing/sessions",
                serde_json::json!({ "encrypted_payload": "AQ", "ttl_seconds": PAIRING_MAX_TTL_SECONDS + 3600 }),
            )
            .await,
        )
        .await;
        let clamped_expires_at = clamped_session["expires_at"].as_u64().unwrap();
        assert!(clamped_expires_at <= before + PAIRING_MAX_TTL_SECONDS + 5);

        let floored_session = json(
            post(
                router.clone(),
                "/api/pairing/sessions",
                serde_json::json!({ "encrypted_payload": "AQ", "ttl_seconds": 1 }),
            )
            .await,
        )
        .await;
        let floored_expires_at = floored_session["expires_at"].as_u64().unwrap();
        assert!(floored_expires_at >= before + PAIRING_MIN_TTL_SECONDS);
    }

    #[tokio::test]
    async fn pairing_outcome_is_pending_until_the_existing_device_reports_it() {
        let router = router();
        let session = json(
            post(
                router.clone(),
                "/api/pairing/sessions",
                serde_json::json!({ "encrypted_payload": "AQ" }),
            )
            .await,
        )
        .await;
        let token = session["token"].as_str().unwrap();

        let pending = json(
            get(
                router.clone(),
                &format!("/api/pairing/sessions/{token}/complete"),
            )
            .await,
        )
        .await;
        assert_eq!(pending["outcome"], serde_json::Value::Null);

        let reported = post(
            router.clone(),
            &format!("/api/pairing/sessions/{token}/complete"),
            serde_json::json!({ "success": true }),
        )
        .await;
        assert_eq!(reported.status(), StatusCode::OK);

        let resolved =
            json(get(router, &format!("/api/pairing/sessions/{token}/complete")).await).await;
        assert_eq!(resolved["outcome"], true);
    }

    #[tokio::test]
    async fn pairing_outcome_is_rejected_for_an_unknown_or_expired_session() {
        let router = router();
        let unknown = post(
            router.clone(),
            "/api/pairing/sessions/missing/complete",
            serde_json::json!({ "success": false }),
        )
        .await;
        assert_eq!(unknown.status(), StatusCode::NOT_FOUND);
    }
}
