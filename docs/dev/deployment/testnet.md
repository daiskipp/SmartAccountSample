# Testnet deployment

This covers deploying the Smart Account contract set to Stellar Testnet, the
Axum relay gateway's Testnet-facing configuration, and the record of the
current public deployment. Local development instead uses
[`localnet.md`](localnet.md)'s scripted, disposable chain.

## Deploying the contract set

```bash
just testnet-deploy
```

**The devcontainer's `STELLAR_RPC_URL` / `STELLAR_FRIENDBOT_URL` /
`STELLAR_NETWORK` / `STELLAR_NETWORK_PASSPHRASE` env vars (set for the
`stellar-localnet` sibling service's convenience) used to silently override
the Stellar CLI's `--network testnet` flag.** With them set, every `stellar`
invocation in the deploy script — funding, install, deploy — resolved to the
local Standalone network instead of the public Testnet, but reported success
either way (the `stellar keys generate --fund` output text was the only
tell: `funded on "Standalone Network ; February 2017"` instead of `"Test SDF
Network ; September 2015"`). This is exactly how the 2026-09-01 record below
went unnoticed for a day: nothing on Testnet actually existed at those
addresses, so every Testnet account creation failed after the passkey step
with `Could not obtain contract wasm from server`.
`deploy-testnet-contracts.sh` now `unset`s those four vars itself before its
first `stellar` invocation, so `just testnet-deploy` is safe to run directly
without an `env -u` wrapper. Still verify the result actually landed on
Testnet before trusting it, e.g.:

```bash
stellar contract info interface --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  --wasm-hash <the account wasm hash just written to frontend/.env.production>
```

Unlike `just localnet-bootstrap`, this is **not disposable** — every run
creates a new, permanent Testnet contract set (Smart Account, WebAuthn
verifier, Ed25519 verifier, threshold policy, and this repository's
`recovery-scope-policy`/`time-delay-policy`) using a throwaway,
Friendbot-funded deployer key that is discarded at the end. Call it
deliberately, not as part of a routine reset cycle. See
`.devcontainer/deploy-testnet-contracts.sh` for the exact steps — it mirrors
`.devcontainer/deploy-localnet-contracts.sh`, but against the `testnet`
network alias, pinned to the same OpenZeppelin `stellar-contracts` revision
(`fbfde388e1b72afa93d6b1c922067879b20e81db`).

It writes two files:

- `frontend/.env.production` — the full public `VITE_*` configuration. This
  file is **not** gitignored (unlike `.env.local`): these are public contract
  addresses and a WASM hash, not secrets, so review the diff and commit it.
- `.devcontainer/testnet.env` (gitignored) — `RELAY_WASM_HASHES` /
  `RELAY_MANAGED_ACCOUNT_WASM_HASHES` only, for `just api-testnet`. The rest
  of the relay config (`RELAY_CHANNELS_API_KEY`, `RELAY_ALLOWED_ORIGIN`,
  `RELAY_CHANNELS_URL`, `RELAY_NETWORK_PASSPHRASE`,
  `RECOVERY_NETWORK_PASSPHRASE`) is deployment-specific and not derivable from
  a contract deployment, so it isn't generated — set it yourself before
  sourcing that file.

The checked-in TimeDelayPolicy source exposes `get_pending_for_account` for
the unauthenticated public wait-status page, so the script points both
`VITE_TIME_DELAY_POLICY_ADDRESS` and `VITE_TIME_DELAY_POLICY_STATUS_ADDRESS`
at the same deployment.

Two things stay manual after running it:

1. Update `wrangler.toml`'s `[vars]` with the same `RELAY_WASM_HASHES` /
   `RELAY_MANAGED_ACCOUNT_WASM_HASHES` before `wrangler deploy` (see
   [`cloudflare.md`](cloudflare.md)) — it's a checked-in config file, so the
   script deliberately doesn't touch it. Update both values together; a
   mismatch between the relay's allowlist and the frontend's expectations is
   exactly the failure mode this is trying to avoid.
2. Append a new dated record with the new addresses and WASM hashes
   (`stellar contract info hash --wasm <file>`) to the deployment record
   below, rather than overwriting the previous one.

`contracts/recovery-scope-policy`'s L4 scoping references
`TimeDelayPolicy.initiate_recovery` directly (see [`../../../README.md`](../../../README.md)),
so the script always deploys both policies together even though L4 is
currently unwired from the app.

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
`get_pending_for_account`, so a fresh deployment should set both
`VITE_TIME_DELAY_POLICY_ADDRESS` and `VITE_TIME_DELAY_POLICY_STATUS_ADDRESS`
to that deployment (see step 3 above).

## Current deployment record (2026-09-02)

The following public artifacts were deployed to Stellar Testnet on 2026-09-02
via `just testnet-deploy` (with the devcontainer's `STELLAR_*` env vars
unset, per the warning above), superseding the 2026-09-01 set below. This is
the current contract set `frontend/.env.production` and
`.devcontainer/testnet.env` are generated from, and what the live
`account-sample-verify` Cloudflare Pages deployment and `account-sample-api`
Worker are configured against.

```dotenv
VITE_SMART_ACCOUNT_RPC_URL=https://soroban-testnet.stellar.org
VITE_SMART_ACCOUNT_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
VITE_SMART_ACCOUNT_WASM_HASH=8b650bdfe7942b2ab9791c4c975d7092481d4f29e956391532aa9767fe5f96d5
VITE_WEBAUTHN_VERIFIER_ADDRESS=CALYWNIIIYPPAS7D5BZTBDNRSAIUKMDFEKDXWPHAMRMCDLMXSXQIP4IB
VITE_ED25519_VERIFIER_ADDRESS=CAOUGXLZE6EKTKA2F45BIA4NKH6K6LFAUUTMKDDILFK6FIGXW6G4QHU7
VITE_THRESHOLD_POLICY_ADDRESS=CBSM4UNOLZDG7PEOQJNQLQZGJ774UD5EIS3IOT5X7WFABR2UVG4UTAF4
VITE_TIME_DELAY_POLICY_ADDRESS=CB3V2CPMLU5KB4LYOCV4UEZTDYRQLI46CAWCC47JODT3FQAZJLRRYQ2E
VITE_TIME_DELAY_POLICY_STATUS_ADDRESS=CB3V2CPMLU5KB4LYOCV4UEZTDYRQLI46CAWCC47JODT3FQAZJLRRYQ2E
VITE_RECOVERY_SCOPE_POLICY_ADDRESS=CAYAZ23OCEHATZ23JZHA7EZQVWN4W5GTYGR6YT7FUFSQLZZAURGNVSTN
```

The account, TimeDelayPolicy, and RecoveryScopePolicy WASM hashes are
unchanged from 2026-09-01 (deterministic builds from the same pinned source
revision); only the per-deployment contract instance addresses differ, since
each run uses a fresh throwaway deployer identity.

**Root cause of the "パスキーでアカウント作成できない" report that triggered
this redeploy**, both now fixed:

1. The 2026-09-01 record below was never actually reachable — see the
   `STELLAR_*` env var warning above. `just testnet-deploy` had silently
   targeted the local Standalone network the whole time, so no Testnet
   account creation could ever succeed against it.
2. Independently, `POST /api/relay` panicked on every real submission with
   `Rust panic: ... time not implemented on this platform` /
   `Critical RuntimeError: unreachable` (visible via `wrangler tail`),
   crashing and reinitializing the Worker's Wasm instance on every request
   that reached `forward_relay`'s rate-limit check (`GET /health` never hit
   this path, which is why the Worker looked healthy). Cause: `app.rs`'s
   `now()` called `std::time::SystemTime::now()` directly, which has no OS
   clock on `wasm32-unknown-unknown` and panics instead of returning a time.
   Fixed by switching to the `web-time` crate (a drop-in `SystemTime`/
   `UNIX_EPOCH` that uses `Date.now()` on wasm32 and plain `std::time`
   everywhere else) in `Cargo.toml` and `src/app.rs`.

Verified end-to-end after both fixes: a `smart-account-kit` shared-deployer
`{func, auth}` payload (synthetic P-256 public key, built directly against
this contract set) submitted through the live
`https://account-sample-api.dicekey.workers.dev/api/relay` returned Channels
`"status":"confirmed"`, and the resulting transaction hash
(`fc7312e49046fc89292331b3416e9391e91528a4c68f92915af526628d19f4d7`) shows
`successful: true` on Horizon.

## Superseded: 2026-09-01 deployment record

**This record was never actually live on public Testnet** — see the
`STELLAR_*` env var warning above; the addresses below only ever existed on
the devcontainer's local Standalone network. Kept for history only; do not
reuse these addresses.

The following public artifacts were deployed to Stellar Testnet on 2026-09-01
via `just testnet-deploy`, superseding the 2026-08-24 set below (kept for
history). This is the current contract set `frontend/.env.production` and
`.devcontainer/testnet.env` are generated from.

```dotenv
VITE_SMART_ACCOUNT_RPC_URL=https://soroban-testnet.stellar.org
VITE_SMART_ACCOUNT_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
VITE_SMART_ACCOUNT_WASM_HASH=8b650bdfe7942b2ab9791c4c975d7092481d4f29e956391532aa9767fe5f96d5
VITE_WEBAUTHN_VERIFIER_ADDRESS=CAW4ZEKKXSG4XT6Z2FR4WZUOP24SPFLOZDSAYWD6OOT3B7MGQN7N4G2R
VITE_ED25519_VERIFIER_ADDRESS=CDR7Q4F5FTKKSANAAOY636Q6CJPGMQUW7M4KXWPB2VRGYF4C32HLWOVH
VITE_THRESHOLD_POLICY_ADDRESS=CD3M5VC3I4VMWO6VKANI4N2CWD5RMPGMWU4NYIOUA44QUZVWRGTXSBCA
VITE_TIME_DELAY_POLICY_ADDRESS=CAW3O2WE4LVNSKFJNHV3PSQRVAXS3UXAURPCGBWFIB26J34VFJJOMJ33
VITE_TIME_DELAY_POLICY_STATUS_ADDRESS=CAW3O2WE4LVNSKFJNHV3PSQRVAXS3UXAURPCGBWFIB26J34VFJJOMJ33
VITE_RECOVERY_SCOPE_POLICY_ADDRESS=CCSDOBTJ53J4RMINK5KC4NMP4ZWQF22355XFHFYWFK7NQJK3OL3UJ5NI
```

The public WASM hashes for the custom policies are:

- TimeDelayPolicy: `1c175f7600f0497ab3e5b12d3d13e91ffe4cd1a4cd30dc833180849a5cf511a3`
  (changed from the 2026-08-24 build — this one adds `get_pending_for_account`)
- RecoveryScopePolicy: `359572daf4575346d20a436259bb57e44f9e30254b68620bb918975ff4ac9abd`
  (unchanged; same source as 2026-08-24)

`get_pending_for_account` against the deployed TimeDelayPolicy returned
`null`, confirming a clean initial state, so
`VITE_TIME_DELAY_POLICY_STATUS_ADDRESS` can point at it directly.

**Resolved for this deployment** (was previously listed as outstanding here):

- `wrangler.toml`'s `[vars]` updated to the 2026-09-01 hash
  (`8b650bdfe7942b2ab9791c4c975d7092481d4f29e956391532aa9767fe5f96d5`) in
  both `RELAY_WASM_HASHES` and `RELAY_MANAGED_ACCOUNT_WASM_HASHES`.
- The stray `testnet-deployer` identity in the default (non-scoped) Stellar
  CLI config was removed (`stellar keys rm testnet-deployer --force`).
- The Worker (`account-sample-api`), its `RecoveryStore` Durable Object, the
  `account-sample-verify` Cloudflare Pages project (deployed on the
  production branch so the root `pages.dev` domain matches
  `RELAY_ALLOWED_ORIGIN`), and the `RELAY_CHANNELS_API_KEY` secret are all
  now live. `GET /health` returns `204` with
  `access-control-allow-origin: https://account-sample-verify.pages.dev`,
  confirming the full chain (Worker config → CORS → Pages origin) matches.

**Still outstanding:**

- The full relay smoke test from the 2026-08-24 record below (Channels
  `confirmed`, on-chain account creation through the real UI) hasn't been
  re-run against this contract set yet.

## Superseded: 2026-08-24 deployment record

The following public artifacts were uploaded and deployed to Stellar Testnet on
2026-08-24. The ephemeral funding identity used for deployment was discarded;
none of its secret material is stored in this repository.

```dotenv
VITE_SMART_ACCOUNT_RPC_URL=https://soroban-testnet.stellar.org
VITE_SMART_ACCOUNT_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
VITE_SMART_ACCOUNT_WASM_HASH=070ef5dd25f681f092e171b9381444fec7a1d93737272cc57e67c232e048b366
VITE_WEBAUTHN_VERIFIER_ADDRESS=CCDFZOSI3OOUEJWDUBYBF7PAR7SKXJCAJSWTGGEHMT2I3ALQM5R2A62W
VITE_ED25519_VERIFIER_ADDRESS=CBHR7CSCVRMBZRLGZMOU2KRSJM57EXXZ4VDQR6ZV5KOTYORSRZWBZJ7N
VITE_THRESHOLD_POLICY_ADDRESS=CD7WLSWFKBH4D3NWDGKNRA6TJXLY4CAKITDFKNQAUEH4OR56WZ2APPPG
VITE_TIME_DELAY_POLICY_ADDRESS=CC4XWO64SMJSRN5UQ5C2H5YBNDZC4R75PTEEGSD7H74GQI2GTGVJWBRQ
VITE_RECOVERY_SCOPE_POLICY_ADDRESS=CBGMYCW64I4TPS4O3UTSYIDDD5FL76X3MH4XFC5JZAUD7GS5MJ52NXBD
```

The public WASM hashes for the custom policies are:

- TimeDelayPolicy: `3dc32f2d7f6f30425795364fd9f3ea6b52327be077e0642122f255ab3424ac06`
- RecoveryScopePolicy: `359572daf4575346d20a436259bb57e44f9e30254b68620bb918975ff4ac9abd`

The checked-in TimeDelayPolicy source also exposes `get_pending_for_account`
for the unauthenticated public wait-status page. The currently listed Testnet
policy predates that read-only entrypoint; deploy the current policy and set
its address as `VITE_TIME_DELAY_POLICY_STATUS_ADDRESS` before enabling that
on-chain status read on Testnet.

`get_pending` against the deployed TimeDelayPolicy returned `null`, confirming
the contract's clean initial state. Production-style deployment still needs a
server-held Channels API credential and a deployment-specific server allowlist
as described above.

### Relay deployment verification

The Testnet relay path was exercised with a normal `smart-account-kit`
shared-deployer payload and a synthetic P-256 WebAuthn public key. The gateway
validated the `{func, auth}` payload, Channels returned `confirmed`, and the
derived Smart Account was readable from Testnet RPC:

```text
CDP46ERTDTBQSKOKMZTHTIXNOX4GSWBBIB6IFQ2BQ2KGGZ3KHFFMTWOK
```

This contract is a public test fixture only; its credential is synthetic and
must not be used as an account. The one-time Channels key and the temporary
gateway process were discarded after the check.

A virtual WebAuthn authenticator was then used through the real Vite UI. It
created this Testnet account through the same gateway and received the normal
success screen:

```text
CDB2QJGQ75NXUSWJ452FWIETEW3VAKZAC5FG5NQLLP32OPKGP7H6433Y
```

The virtual authenticator was destroyed immediately after the test. The
opt-in regression test is `frontend/e2e/testnet-passkey-account.spec.ts`; it
runs only when `RUN_TESTNET_E2E=1` and the server-only relay configuration are
provided.

For this deployment, the server relay is configured with the account hash in
both `RELAY_WASM_HASHES` and `RELAY_MANAGED_ACCOUNT_WASM_HASHES`:

```dotenv
RELAY_WASM_HASHES=070ef5dd25f681f092e171b9381444fec7a1d93737272cc57e67c232e048b366
RELAY_MANAGED_ACCOUNT_WASM_HASHES=070ef5dd25f681f092e171b9381444fec7a1d93737272cc57e67c232e048b366
```

The latter is deliberately a separate, narrower permission: only a Channels-
confirmed deployment from that artifact is dynamically registered for the
fixed recovery-management relay surface.

The managed service's temporary API-key endpoint is a **GET** request (not a
POST). With a one-time key held only in a temporary file, an intentionally
invalid authorization payload reached Channels through `POST /api/relay` and
returned the expected structured `SIMULATION_FAILED` result. This verifies the
browser-compatible gateway transport without committing a credential or
sponsoring a real account deployment.

When this contract set is redeployed, append a new dated record above rather
than overwriting this one.
