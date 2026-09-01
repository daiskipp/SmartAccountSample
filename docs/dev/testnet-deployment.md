# Testnet deployment

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

## Relay deployment verification

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

For this deployment, configure the server relay with the account hash in both
`RELAY_WASM_HASHES` and `RELAY_MANAGED_ACCOUNT_WASM_HASHES`:

```dotenv
RELAY_WASM_HASHES=070ef5dd25f681f092e171b9381444fec7a1d93737272cc57e67c232e048b366
RELAY_MANAGED_ACCOUNT_WASM_HASHES=070ef5dd25f681f092e171b9381444fec7a1d93737272cc57e67c232e048b366
```

The latter is deliberately a separate, narrower permission: only a Channels-
confirmed deployment from that artifact is dynamically registered for the
fixed recovery-management relay surface.

The checked-in TimeDelayPolicy source also exposes
`get_pending_for_account` for the unauthenticated public wait-status page. The
currently listed Testnet policy predates that read-only entrypoint; deploy the
current policy and set its address as
`VITE_TIME_DELAY_POLICY_STATUS_ADDRESS` before enabling that on-chain status
read on Testnet.

`get_pending` against the deployed TimeDelayPolicy returned `null`, confirming
the contract's clean initial state. Production-style deployment still needs a
server-held Channels API credential and a deployment-specific server allowlist
as described in [localnet-deployment.md](localnet-deployment.md).

The managed service's temporary API-key endpoint is a **GET** request (not a
POST). With a one-time key held only in a temporary file, an intentionally
invalid authorization payload reached Channels through `POST /api/relay` and
returned the expected structured `SIMULATION_FAILED` result. This verifies the
browser-compatible gateway transport without committing a credential or
sponsoring a real account deployment.
