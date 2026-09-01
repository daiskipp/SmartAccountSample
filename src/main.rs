//! Native entrypoint (`cargo run`, `just api`). The Workers/Durable Object
//! entrypoint lives in `src/worker.rs` and is not built here.
#![cfg(not(target_arch = "wasm32"))]

use account_sample::{
    app::{router_with_state, AppState, RelayGateway},
    relay::RelayAllowlist,
};

#[tokio::main]
async fn main() {
    let state = match std::env::var("RECOVERY_DATABASE_PATH") {
        Ok(path) => AppState::sqlite(&path).expect("failed to open recovery database"),
        Err(_) => AppState::default(),
    };
    let operator_credentials = std::env::var("RECOVERY_OPERATOR_CREDENTIALS")
        .ok()
        .map(|value| {
            value
                .split(',')
                .map(|entry| {
                    entry
                        .split_once('=')
                        .expect("operator credentials use id=token")
                })
                .map(|(id, token)| (id.to_owned(), token.to_owned()))
                .collect()
        })
        .unwrap_or_default();
    let state = state.with_operator_credentials(operator_credentials);
    let state = match std::env::var("RECOVERY_NETWORK_PASSPHRASE") {
        Ok(network) => state.with_l4_network(network),
        Err(_) => state,
    };
    let state = match std::env::var("RELAY_CHANNELS_URL") {
        Ok(channels_url) => {
            let api_key = secret_env("RELAY_CHANNELS_API_KEY", "RELAY_CHANNELS_API_KEY_FILE");
            let allowed_origin = required_env("RELAY_ALLOWED_ORIGIN");
            let roots = csv_env("RELAY_WALLET_ROOTS");
            let functions = csv_env("RELAY_FUNCTIONS")
                .into_iter()
                .map(|value| {
                    value
                        .split_once(':')
                        .map(|(contract, function)| (contract.to_owned(), function.to_owned()))
                        .expect("RELAY_FUNCTIONS entries use CONTRACT_ID:function")
                })
                .collect::<Vec<_>>();
            let wasm_hashes = csv_env("RELAY_WASM_HASHES")
                .into_iter()
                .map(|hash| {
                    hex::decode(hash)
                        .expect("RELAY_WASM_HASHES entries are 32-byte hexadecimal hashes")
                        .try_into()
                        .expect("RELAY_WASM_HASHES entries are 32-byte hexadecimal hashes")
                })
                .collect::<Vec<[u8; 32]>>();
            let managed_account_wasm_hashes = csv_env("RELAY_MANAGED_ACCOUNT_WASM_HASHES")
                .into_iter()
                .map(|hash| {
                    hex::decode(hash)
                        .expect("RELAY_MANAGED_ACCOUNT_WASM_HASHES entries are 32-byte hexadecimal hashes")
                        .try_into()
                        .expect("RELAY_MANAGED_ACCOUNT_WASM_HASHES entries are 32-byte hexadecimal hashes")
                })
                .collect::<Vec<[u8; 32]>>();
            let allowlist = RelayAllowlist::new(roots, functions, wasm_hashes)
                .expect("invalid relay allowlist configuration")
                .with_managed_account_wasm_hashes(managed_account_wasm_hashes);
            {
                let gateway = if std::env::var("RELAY_NETWORK_PASSPHRASE").as_deref()
                    == Ok("Standalone Network ; February 2017")
                {
                    RelayGateway::localnet(channels_url, api_key, allowed_origin, allowlist)
                } else {
                    RelayGateway::new(channels_url, api_key, allowed_origin, allowlist)
                };
                state.with_relay_gateway(gateway.expect("failed to initialize relay HTTP client"))
            }
        }
        Err(_) => state,
    };
    let listener = tokio::net::TcpListener::bind("127.0.0.1:3000")
        .await
        .expect("failed to bind 127.0.0.1:3000");
    println!("listening on http://127.0.0.1:3000");
    axum::serve(listener, router_with_state(state))
        .await
        .expect("server error");
}

fn required_env(name: &str) -> String {
    std::env::var(name)
        .unwrap_or_else(|_| panic!("{name} must be set when RELAY_CHANNELS_URL is set"))
}

fn secret_env(name: &str, file_name: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| {
        let path = required_env(file_name);
        std::fs::read_to_string(&path)
            .unwrap_or_else(|_| panic!("failed to read {file_name} at {path}"))
            .trim()
            .to_owned()
    })
}

fn csv_env(name: &str) -> Vec<String> {
    required_env(name)
        .split(',')
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .collect()
}
