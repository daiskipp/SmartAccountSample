//! Validation for the fee-sponsored Testnet relay boundary.
//!
//! The browser is never given the Channels API key.  Before a request can be
//! forwarded, the gateway decodes the XDR emitted by `smart-account-kit` and
//! checks it against a deployment-specific allowlist.  In particular, this is
//! deliberately not a generic XDR proxy.

use std::collections::HashSet;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use sha2::{Digest, Sha256};
use stellar_strkey::Strkey;
use stellar_xdr::curr::{
    ContractExecutable, Hash, HashIdPreimage, HashIdPreimageContractId, HostFunction, Limits,
    OperationBody, PublicKey, ReadXdr, ScAddress, SorobanAuthorizationEntry,
    SorobanAuthorizedFunction, SorobanCredentials, Transaction, TransactionEnvelope,
    TransactionExt, WriteXdr,
};

const XDR_LIMITS: Limits = Limits {
    depth: 32,
    len: 64 * 1024,
};

#[derive(Clone, Debug)]
pub struct RelayAllowlist {
    /// Contract and account addresses allowed to appear as authorization roots.
    pub wallet_roots: HashSet<[u8; 32]>,
    /// `(contract id, function name)` pairs permitted for contract invocation.
    pub functions: HashSet<([u8; 32], String)>,
    /// WASM hashes permitted for shared-deployer contract creation.
    pub wasm_hashes: HashSet<[u8; 32]>,
    /// A subset of `wasm_hashes` whose successful deployments become managed
    /// Smart Accounts. Other allowlisted deployments never gain this privilege.
    pub managed_account_wasm_hashes: HashSet<[u8; 32]>,
    pub max_auth_entries: usize,
    pub max_resource_fee: i64,
    pub max_transaction_fee: u32,
}

impl Default for RelayAllowlist {
    fn default() -> Self {
        Self {
            wallet_roots: HashSet::new(),
            functions: HashSet::new(),
            wasm_hashes: HashSet::new(),
            managed_account_wasm_hashes: HashSet::new(),
            max_auth_entries: 8,
            max_resource_fee: 100_000_000,
            max_transaction_fee: 100_000_000,
        }
    }
}

impl RelayAllowlist {
    pub fn new(
        wallet_roots: impl IntoIterator<Item = String>,
        functions: impl IntoIterator<Item = (String, String)>,
        wasm_hashes: impl IntoIterator<Item = [u8; 32]>,
    ) -> Result<Self, RelayValidationError> {
        let wallet_roots = wallet_roots
            .into_iter()
            .map(|value| parse_address(&value))
            .collect::<Result<_, _>>()?;
        let functions = functions
            .into_iter()
            .map(|(contract, function)| Ok((parse_contract(&contract)?, function)))
            .collect::<Result<_, RelayValidationError>>()?;
        Ok(Self {
            wallet_roots,
            functions,
            wasm_hashes: wasm_hashes.into_iter().collect(),
            managed_account_wasm_hashes: HashSet::new(),
            max_auth_entries: 8,
            max_resource_fee: 100_000_000,
            max_transaction_fee: 100_000_000,
        })
    }

    pub fn with_managed_account_wasm_hashes(
        mut self,
        wasm_hashes: impl IntoIterator<Item = [u8; 32]>,
    ) -> Self {
        self.managed_account_wasm_hashes = wasm_hashes.into_iter().collect();
        self
    }

    /// Adds confirmed Smart Account contract IDs to a request-local allowlist.
    /// Their management surface is intentionally fixed rather than supplied by
    /// callers or a broad wildcard configuration.
    pub fn with_managed_wallets(mut self, wallets: impl IntoIterator<Item = [u8; 32]>) -> Self {
        const MANAGED_ACCOUNT_FUNCTIONS: [&str; 6] = [
            "add_policy",
            "add_context_rule",
            "batch_add_signer",
            "add_signer",
            "remove_signer",
            "execute",
        ];
        for wallet in wallets {
            self.wallet_roots.insert(wallet);
            self.functions.extend(
                MANAGED_ACCOUNT_FUNCTIONS
                    .iter()
                    .map(|function| (wallet, (*function).to_owned())),
            );
        }
        self
    }
}

/// Derives the address created by an SDK shared-deployer request. Returns
/// `None` for non-creation calls and for WASM that is not explicitly marked as
/// a managed Smart Account artifact.
pub fn managed_contract_from_func_auth(
    func: &str,
    allowlist: &RelayAllowlist,
    network_passphrase: &str,
) -> Result<Option<[u8; 32]>, RelayValidationError> {
    let host = HostFunction::from_xdr(
        STANDARD
            .decode(func)
            .map_err(|_| RelayValidationError::InvalidXdr)?,
        XDR_LIMITS,
    )
    .map_err(|_| RelayValidationError::InvalidXdr)?;
    managed_contract_from_host(&host, allowlist, network_passphrase)
}

pub fn managed_contract_from_xdr(
    xdr: &str,
    allowlist: &RelayAllowlist,
    network_passphrase: &str,
) -> Result<Option<[u8; 32]>, RelayValidationError> {
    let envelope = TransactionEnvelope::from_xdr(
        STANDARD
            .decode(xdr)
            .map_err(|_| RelayValidationError::InvalidXdr)?,
        XDR_LIMITS,
    )
    .map_err(|_| RelayValidationError::InvalidXdr)?;
    let transaction = match envelope {
        TransactionEnvelope::Tx(envelope) => envelope.tx,
        TransactionEnvelope::TxFeeBump(envelope) => match envelope.tx.inner_tx {
            stellar_xdr::curr::FeeBumpTransactionInnerTx::Tx(envelope) => envelope.tx,
        },
        TransactionEnvelope::TxV0(_) => return Err(RelayValidationError::ForbiddenFunction),
    };
    let [operation] = transaction.operations.as_slice() else {
        return Err(RelayValidationError::ForbiddenFunction);
    };
    let OperationBody::InvokeHostFunction(operation) = &operation.body else {
        return Err(RelayValidationError::ForbiddenFunction);
    };
    managed_contract_from_host(&operation.host_function, allowlist, network_passphrase)
}

fn managed_contract_from_host(
    host: &HostFunction,
    allowlist: &RelayAllowlist,
    network_passphrase: &str,
) -> Result<Option<[u8; 32]>, RelayValidationError> {
    let HostFunction::CreateContractV2(create) = host else {
        return Ok(None);
    };
    let ContractExecutable::Wasm(wasm_hash) = &create.executable else {
        return Ok(None);
    };
    if !allowlist.managed_account_wasm_hashes.contains(&wasm_hash.0) {
        return Ok(None);
    }
    let network_id = Hash(Sha256::digest(network_passphrase.as_bytes()).into());
    let preimage = HashIdPreimage::ContractId(HashIdPreimageContractId {
        network_id,
        contract_id_preimage: create.contract_id_preimage.clone(),
    });
    let xdr = preimage
        .to_xdr(XDR_LIMITS)
        .map_err(|_| RelayValidationError::InvalidXdr)?;
    Ok(Some(Sha256::digest(xdr).into()))
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum RelayValidationError {
    #[error("invalid relay XDR")]
    InvalidXdr,
    #[error("relay request is not an allowed host function")]
    ForbiddenFunction,
    #[error("relay request has an unapproved authorization root")]
    ForbiddenAuthorization,
}

/// Validates the SDK's `{func, auth}` submission form.  The returned XDR is
/// intentionally not re-encoded: this lets Channels receive the exact signed
/// authorization entries the browser created.
pub fn validate_func_auth(
    func: &str,
    auth: &[String],
    allowlist: &RelayAllowlist,
) -> Result<(), RelayValidationError> {
    if auth.is_empty() || auth.len() > allowlist.max_auth_entries {
        return Err(RelayValidationError::ForbiddenAuthorization);
    }
    let func_bytes = STANDARD
        .decode(func)
        .map_err(|_| RelayValidationError::InvalidXdr)?;
    let host = HostFunction::from_xdr(func_bytes, XDR_LIMITS)
        .map_err(|_| RelayValidationError::InvalidXdr)?;
    validate_host_function(&host, allowlist)?;
    for entry in auth {
        let entry_bytes = STANDARD
            .decode(entry)
            .map_err(|_| RelayValidationError::InvalidXdr)?;
        let entry = SorobanAuthorizationEntry::from_xdr(entry_bytes, XDR_LIMITS)
            .map_err(|_| RelayValidationError::InvalidXdr)?;
        validate_authorization(&host, &entry, allowlist)?;
    }
    Ok(())
}

/// Validates the signed-envelope form used by dedicated deployers.  Only one
/// Soroban invoke operation is allowed: fee bumping must not turn this
/// endpoint into a general-purpose transaction sponsor.
pub fn validate_xdr(xdr: &str, allowlist: &RelayAllowlist) -> Result<(), RelayValidationError> {
    let bytes = STANDARD
        .decode(xdr)
        .map_err(|_| RelayValidationError::InvalidXdr)?;
    let envelope = TransactionEnvelope::from_xdr(bytes, XDR_LIMITS)
        .map_err(|_| RelayValidationError::InvalidXdr)?;
    let transaction = match envelope {
        TransactionEnvelope::Tx(envelope) => envelope.tx,
        TransactionEnvelope::TxFeeBump(envelope) => match envelope.tx.inner_tx {
            stellar_xdr::curr::FeeBumpTransactionInnerTx::Tx(envelope) => envelope.tx,
        },
        TransactionEnvelope::TxV0(_) => return Err(RelayValidationError::ForbiddenFunction),
    };
    validate_transaction(&transaction, allowlist)
}

fn validate_transaction(
    transaction: &Transaction,
    allowlist: &RelayAllowlist,
) -> Result<(), RelayValidationError> {
    if transaction.fee > allowlist.max_transaction_fee {
        return Err(RelayValidationError::ForbiddenFunction);
    }
    let TransactionExt::V1(data) = &transaction.ext else {
        return Err(RelayValidationError::ForbiddenFunction);
    };
    if data.resource_fee < 0 || data.resource_fee > allowlist.max_resource_fee {
        return Err(RelayValidationError::ForbiddenFunction);
    }
    let [operation] = transaction.operations.as_slice() else {
        return Err(RelayValidationError::ForbiddenFunction);
    };
    let OperationBody::InvokeHostFunction(operation) = &operation.body else {
        return Err(RelayValidationError::ForbiddenFunction);
    };
    validate_host_function(&operation.host_function, allowlist)?;
    let auth = operation.auth.as_slice();
    if auth.is_empty() || auth.len() > allowlist.max_auth_entries {
        return Err(RelayValidationError::ForbiddenAuthorization);
    }
    for entry in auth {
        validate_authorization(&operation.host_function, entry, allowlist)?;
    }
    Ok(())
}

fn validate_host_function(
    host: &HostFunction,
    allowlist: &RelayAllowlist,
) -> Result<(), RelayValidationError> {
    match host {
        HostFunction::InvokeContract(call) => {
            let contract = contract_from_sc_address(&call.contract_address)?;
            let function = std::str::from_utf8(call.function_name.as_ref())
                .map_err(|_| RelayValidationError::InvalidXdr)?;
            if allowlist
                .functions
                .contains(&(contract, function.to_owned()))
            {
                Ok(())
            } else {
                Err(RelayValidationError::ForbiddenFunction)
            }
        }
        HostFunction::CreateContractV2(create) => match &create.executable {
            ContractExecutable::Wasm(hash) if allowlist.wasm_hashes.contains(&hash.0) => Ok(()),
            _ => Err(RelayValidationError::ForbiddenFunction),
        },
        // Old creation, raw WASM upload, and every future host-function type
        // are denied until explicitly modelled and allowlisted.
        _ => Err(RelayValidationError::ForbiddenFunction),
    }
}

fn validate_authorization(
    host: &HostFunction,
    entry: &SorobanAuthorizationEntry,
    allowlist: &RelayAllowlist,
) -> Result<(), RelayValidationError> {
    let SorobanCredentials::Address(credentials) = &entry.credentials else {
        return Err(RelayValidationError::ForbiddenAuthorization);
    };
    if !allowlist
        .wallet_roots
        .contains(&address_from_sc_address(&credentials.address)?)
    {
        return Err(RelayValidationError::ForbiddenAuthorization);
    }
    let root_matches = match (&host, &entry.root_invocation.function) {
        (HostFunction::InvokeContract(host), SorobanAuthorizedFunction::ContractFn(root)) => {
            root.contract_address == host.contract_address
                && root.function_name == host.function_name
        }
        (
            HostFunction::CreateContractV2(host),
            SorobanAuthorizedFunction::CreateContractV2HostFn(root),
        ) => root == host,
        _ => false,
    };
    if root_matches {
        Ok(())
    } else {
        Err(RelayValidationError::ForbiddenAuthorization)
    }
}

fn parse_contract(value: &str) -> Result<[u8; 32], RelayValidationError> {
    match Strkey::from_string(value).map_err(|_| RelayValidationError::InvalidXdr)? {
        Strkey::Contract(contract) => Ok(contract.0),
        _ => Err(RelayValidationError::InvalidXdr),
    }
}

fn parse_address(value: &str) -> Result<[u8; 32], RelayValidationError> {
    match Strkey::from_string(value).map_err(|_| RelayValidationError::InvalidXdr)? {
        Strkey::Contract(contract) => Ok(contract.0),
        Strkey::PublicKeyEd25519(public_key) => Ok(public_key.0),
        _ => Err(RelayValidationError::InvalidXdr),
    }
}

fn contract_from_sc_address(address: &ScAddress) -> Result<[u8; 32], RelayValidationError> {
    match address {
        ScAddress::Contract(contract) => Ok(contract.0),
        ScAddress::Account(_) => Err(RelayValidationError::ForbiddenFunction),
    }
}

fn address_from_sc_address(address: &ScAddress) -> Result<[u8; 32], RelayValidationError> {
    match address {
        ScAddress::Contract(contract) => Ok(contract.0),
        ScAddress::Account(account) => match &account.0 {
            PublicKey::PublicKeyTypeEd25519(key) => Ok(key.0),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use stellar_xdr::curr::{
        ContractIdPreimage, ContractIdPreimageFromAddress, CreateContractArgsV2, Uint256, VecM,
    };

    #[test]
    fn malformed_or_empty_relay_payloads_fail_closed() {
        let allowlist = RelayAllowlist::default();
        assert_eq!(
            validate_func_auth("not-xdr", &["not-xdr".into()], &allowlist),
            Err(RelayValidationError::InvalidXdr)
        );
        assert_eq!(
            validate_func_auth("not-xdr", &[], &allowlist),
            Err(RelayValidationError::ForbiddenAuthorization)
        );
        assert_eq!(
            validate_xdr("not-xdr", &allowlist),
            Err(RelayValidationError::InvalidXdr)
        );
    }

    #[test]
    fn only_contract_and_ed25519_strkeys_are_valid_roots() {
        assert!(parse_address("not-a-strkey").is_err());
        assert!(parse_contract("not-a-contract").is_err());
    }

    #[test]
    fn confirmed_managed_wallets_receive_only_the_fixed_management_surface() {
        let wallet = [7; 32];
        let allowlist = RelayAllowlist::default().with_managed_wallets([wallet]);
        assert!(allowlist.wallet_roots.contains(&wallet));
        assert!(allowlist
            .functions
            .contains(&(wallet, "add_policy".to_owned())));
        assert!(allowlist
            .functions
            .contains(&(wallet, "add_context_rule".to_owned())));
        assert!(allowlist
            .functions
            .contains(&(wallet, "execute".to_owned())));
        assert!(!allowlist
            .functions
            .contains(&(wallet, "__constructor".to_owned())));
    }

    #[test]
    fn only_explicitly_managed_wasm_can_register_a_new_wallet() {
        let wasm_hash = [9; 32];
        let host = HostFunction::CreateContractV2(CreateContractArgsV2 {
            contract_id_preimage: ContractIdPreimage::Address(ContractIdPreimageFromAddress {
                address: ScAddress::Contract(stellar_xdr::curr::Hash([3; 32])),
                salt: Uint256([4; 32]),
            }),
            executable: ContractExecutable::Wasm(stellar_xdr::curr::Hash(wasm_hash)),
            constructor_args: VecM::default(),
        });
        let unmanaged = RelayAllowlist::default();
        assert_eq!(
            managed_contract_from_host(&host, &unmanaged, "Standalone Network ; February 2017")
                .unwrap(),
            None
        );

        let managed = unmanaged.with_managed_account_wasm_hashes([wasm_hash]);
        assert!(
            managed_contract_from_host(&host, &managed, "Standalone Network ; February 2017")
                .unwrap()
                .is_some()
        );
    }
}
