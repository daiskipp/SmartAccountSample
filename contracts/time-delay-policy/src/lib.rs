#![no_std]

use soroban_sdk::{
    auth::Context, contract, contracterror, contractimpl, contracttype, xdr::ToXdr, Address,
    BytesN, Env, Vec,
};
use stellar_accounts::{
    policies::Policy,
    smart_account::{ContextRule, Signer},
};

/// A cancellable waiting period for an L4 recovery proposal.
///
/// The sample deliberately exposes initiation/finalization as separate successful
/// calls: persisting `PendingRecovery` is never coupled to an intentionally failed
/// authorization transaction, which would roll the state back on Soroban.
#[contract]
pub struct TimeDelayPolicy;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PendingRecovery {
    pub initiated_at_ledger: u32,
    pub valid_from_ledger: u32,
    pub expires_at_ledger: u32,
    pub proposal_hash: BytesN<32>,
}

/// Parameters supplied when the policy is attached to a recovery rule.
#[contracttype]
#[derive(Clone)]
pub struct TimeDelayParams {
    pub operator: Address,
    pub delay_ledgers: u32,
}

#[contracttype]
#[derive(Clone)]
struct Installation {
    operator: Address,
    delay_ledgers: u32,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Installation(Address, u32),
    Pending(Address, u32),
    ActiveRule(Address),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum TimeDelayError {
    NotInstalled = 1,
    UnauthorizedOperator = 2,
    RecoveryAlreadyPending = 3,
    NoPendingRecovery = 4,
    RecoveryStillLocked = 5,
    InvalidDelay = 6,
    InvalidExpiry = 7,
    ProposalMismatch = 8,
}

#[contractimpl]
impl TimeDelayPolicy {
    /// Test and operator setup helper. Production rule installation calls the
    /// `Policy::install` hook below with the same parameters.
    pub fn configure(
        env: Env,
        account: Address,
        context_rule_id: u32,
        operator: Address,
        delay_ledgers: u32,
    ) {
        account.require_auth();
        install_configuration(&env, account, context_rule_id, operator, delay_ledgers);
    }

    /// Starts a pending recovery after the configured operator authenticates.
    pub fn initiate_recovery(
        env: Env,
        account: Address,
        context_rule_id: u32,
        operator: Address,
        proposal_hash: BytesN<32>,
        expires_at_ledger: u32,
    ) -> PendingRecovery {
        let installation = installation(&env, &account, context_rule_id);
        if installation.operator != operator {
            env.panic_with_error(TimeDelayError::UnauthorizedOperator);
        }
        operator.require_auth();
        let key = DataKey::Pending(account, context_rule_id);
        if env.storage().persistent().has(&key) {
            env.panic_with_error(TimeDelayError::RecoveryAlreadyPending);
        }
        let initiated_at_ledger = env.ledger().sequence();
        if expires_at_ledger <= initiated_at_ledger {
            env.panic_with_error(TimeDelayError::InvalidExpiry);
        }
        let pending = PendingRecovery {
            initiated_at_ledger,
            valid_from_ledger: initiated_at_ledger.saturating_add(installation.delay_ledgers),
            expires_at_ledger,
            proposal_hash,
        };
        env.storage().persistent().set(&key, &pending);
        pending
    }

    /// Indicates whether a pending recovery has reached its earliest permitted
    /// ledger. The actual Rule#0 signer replacement is authorized by
    /// `Policy::enforce`, which consumes the pending record atomically.
    pub fn is_ready(env: Env, account: Address, context_rule_id: u32) -> bool {
        let installation = installation(&env, &account, context_rule_id);
        let pending = pending(&env, &account, context_rule_id);
        let _ = installation;
        let ledger = env.ledger().sequence();
        ledger >= pending.valid_from_ledger && ledger <= pending.expires_at_ledger
    }

    /// Existing account authorization cancels the proposal and leaves Rule#0
    /// untouched. Production integration must bind this to the intended Rule#0
    /// auth context before deployment.
    pub fn cancel_recovery(env: Env, account: Address, context_rule_id: u32) {
        account.require_auth();
        let key = DataKey::Pending(account, context_rule_id);
        if !env.storage().persistent().has(&key) {
            env.panic_with_error(TimeDelayError::NoPendingRecovery);
        }
        env.storage().persistent().remove(&key);
    }

    pub fn get_pending(
        env: Env,
        account: Address,
        context_rule_id: u32,
    ) -> Option<PendingRecovery> {
        env.storage()
            .persistent()
            .get(&DataKey::Pending(account, context_rule_id))
    }

    /// Public status lookup for the account's active L4 delay rule. This lets
    /// an unauthenticated status screen show a pending wait without exposing
    /// the internal context-rule ID to the user.
    pub fn get_pending_for_account(env: Env, account: Address) -> Option<PendingRecovery> {
        let rule_id: Option<u32> = env.storage().persistent().get(&DataKey::ActiveRule(account.clone()));
        rule_id.and_then(|id| env.storage().persistent().get(&DataKey::Pending(account, id)))
    }
}

#[contractimpl]
impl Policy for TimeDelayPolicy {
    type AccountParams = TimeDelayParams;

    fn enforce(
        env: &Env,
        context: Context,
        _authenticated_signers: Vec<Signer>,
        context_rule: ContextRule,
        smart_account: Address,
    ) {
        smart_account.require_auth();
        let pending = pending(env, &smart_account, context_rule.id);
        let ledger = env.ledger().sequence();
        if ledger < pending.valid_from_ledger {
            env.panic_with_error(TimeDelayError::RecoveryStillLocked);
        }
        if ledger > pending.expires_at_ledger {
            env.panic_with_error(TimeDelayError::InvalidExpiry);
        }
        if proposal_hash(env, &context) != pending.proposal_hash {
            env.panic_with_error(TimeDelayError::ProposalMismatch);
        }
        // This runs in the same transaction as the protected signer change.
        // If that change fails, Soroban rolls this removal back as well.
        env.storage()
            .persistent()
            .remove(&DataKey::Pending(smart_account.clone(), context_rule.id));
    }

    fn install(
        env: &Env,
        params: Self::AccountParams,
        context_rule: ContextRule,
        smart_account: Address,
    ) {
        smart_account.require_auth();
        install_configuration(
            env,
            smart_account,
            context_rule.id,
            params.operator,
            params.delay_ledgers,
        );
    }

    fn uninstall(env: &Env, context_rule: ContextRule, smart_account: Address) {
        smart_account.require_auth();
        env.storage().persistent().remove(&DataKey::Installation(
            smart_account.clone(),
            context_rule.id,
        ));
        env.storage()
            .persistent()
            .remove(&DataKey::Pending(smart_account.clone(), context_rule.id));
        if env
            .storage()
            .persistent()
            .get::<_, u32>(&DataKey::ActiveRule(smart_account.clone()))
            == Some(context_rule.id)
        {
            env.storage()
                .persistent()
                .remove(&DataKey::ActiveRule(smart_account));
        }
    }
}

fn proposal_hash(env: &Env, context: &Context) -> BytesN<32> {
    env.crypto().sha256(&context.clone().to_xdr(env)).into()
}

fn install_configuration(
    env: &Env,
    account: Address,
    context_rule_id: u32,
    operator: Address,
    delay_ledgers: u32,
) {
    if delay_ledgers == 0 {
        env.panic_with_error(TimeDelayError::InvalidDelay);
    }
    env.storage().persistent().set(
        &DataKey::Installation(account.clone(), context_rule_id),
        &Installation {
            operator,
            delay_ledgers,
        },
    );
    env.storage()
        .persistent()
        .set(&DataKey::ActiveRule(account), &context_rule_id);
}

fn installation(env: &Env, account: &Address, context_rule_id: u32) -> Installation {
    env.storage()
        .persistent()
        .get(&DataKey::Installation(account.clone(), context_rule_id))
        .unwrap_or_else(|| env.panic_with_error(TimeDelayError::NotInstalled))
}

fn pending(env: &Env, account: &Address, context_rule_id: u32) -> PendingRecovery {
    env.storage()
        .persistent()
        .get(&DataKey::Pending(account.clone(), context_rule_id))
        .unwrap_or_else(|| env.panic_with_error(TimeDelayError::NoPendingRecovery))
}

#[cfg(test)]
mod test {
    extern crate std;

    use super::*;
    use soroban_sdk::{
        auth::ContractContext,
        testutils::{Address as _, Ledger, LedgerInfo},
        vec, IntoVal, String, Symbol,
    };
    use stellar_accounts::smart_account::ContextRuleType;

    fn set_ledger(env: &Env, sequence_number: u32) {
        env.ledger().set(LedgerInfo {
            timestamp: 0,
            protocol_version: 27,
            sequence_number,
            network_id: [0; 32],
            base_reserve: 0,
            min_temp_entry_ttl: 0,
            min_persistent_entry_ttl: 0,
            max_entry_ttl: 0,
        });
    }

    fn recovery_rule(env: &Env, account: &Address, id: u32) -> ContextRule {
        ContextRule {
            id,
            context_type: ContextRuleType::CallContract(account.clone()),
            name: String::from_str(env, "recovery"),
            signers: vec![env],
            signer_ids: vec![env],
            policies: vec![env],
            policy_ids: vec![env],
            valid_until: None,
        }
    }

    fn signer_change_context(env: &Env, account: &Address) -> Context {
        Context::Contract(ContractContext {
            contract: account.clone(),
            fn_name: Symbol::new(env, "add_signer"),
            args: vec![env, 0_u32.into_val(env)],
        })
    }

    #[test]
    fn pending_recovery_can_be_cancelled_and_restarted() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(TimeDelayPolicy, ());
        let client = TimeDelayPolicyClient::new(&env, &contract_id);
        let account = Address::generate(&env);
        let operator = Address::generate(&env);
        set_ledger(&env, 100);
        client.configure(&account, &7, &operator, &10);
        let proposal = BytesN::from_array(&env, &[1; 32]);
        let first = client.initiate_recovery(&account, &7, &operator, &proposal, &200);
        assert_eq!(first.valid_from_ledger, 110);
        assert!(client.get_pending(&account, &7).is_some());
        assert!(client.get_pending_for_account(&account).is_some());
        client.cancel_recovery(&account, &7);
        assert!(client.get_pending(&account, &7).is_none());
        assert!(client.get_pending_for_account(&account).is_none());
        set_ledger(&env, 120);
        let restarted = client.initiate_recovery(&account, &7, &operator, &proposal, &220);
        assert_eq!(restarted.initiated_at_ledger, 120);
        assert_eq!(restarted.valid_from_ledger, 130);
    }

    #[test]
    fn readiness_requires_waiting_until_the_due_ledger() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(TimeDelayPolicy, ());
        let client = TimeDelayPolicyClient::new(&env, &contract_id);
        let account = Address::generate(&env);
        let operator = Address::generate(&env);
        set_ledger(&env, 10);
        client.configure(&account, &1, &operator, &2);
        let proposal = BytesN::from_array(&env, &[2; 32]);
        client.initiate_recovery(&account, &1, &operator, &proposal, &100);
        assert!(!client.is_ready(&account, &1));
        assert!(client.get_pending(&account, &1).is_some());
        set_ledger(&env, 11);
        assert!(!client.is_ready(&account, &1));
        assert!(client.get_pending(&account, &1).is_some());
        set_ledger(&env, 15);
        assert!(client.is_ready(&account, &1));
        set_ledger(&env, 101);
        assert!(!client.is_ready(&account, &1));
    }

    #[test]
    fn install_initializes_without_creating_a_pending_recovery() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(TimeDelayPolicy, ());
        let client = TimeDelayPolicyClient::new(&env, &contract_id);
        let account = Address::generate(&env);
        let operator = Address::generate(&env);

        client.configure(&account, &3, &operator, &10);

        assert!(client.get_pending(&account, &3).is_none());
        assert!(client.get_pending_for_account(&account).is_none());
    }

    #[test]
    fn rejects_invalid_or_uninstalled_recovery_operations() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(TimeDelayPolicy, ());
        let client = TimeDelayPolicyClient::new(&env, &contract_id);
        let account = Address::generate(&env);
        let operator = Address::generate(&env);

        assert!(client.try_configure(&account, &5, &operator, &0).is_err());
        assert!(client
            .try_initiate_recovery(
                &account,
                &5,
                &operator,
                &BytesN::from_array(&env, &[3; 32]),
                &100
            )
            .is_err());
        assert!(client.try_cancel_recovery(&account, &5).is_err());
    }

    #[test]
    fn rejects_duplicate_pending_recovery_and_wrong_operator() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(TimeDelayPolicy, ());
        let client = TimeDelayPolicyClient::new(&env, &contract_id);
        let account = Address::generate(&env);
        let operator = Address::generate(&env);
        let other_operator = Address::generate(&env);
        client.configure(&account, &9, &operator, &1);

        assert!(client
            .try_initiate_recovery(
                &account,
                &9,
                &other_operator,
                &BytesN::from_array(&env, &[4; 32]),
                &100,
            )
            .is_err());
        let proposal = BytesN::from_array(&env, &[4; 32]);
        client.initiate_recovery(&account, &9, &operator, &proposal, &100);
        assert!(client
            .try_initiate_recovery(&account, &9, &operator, &proposal, &100)
            .is_err());
    }

    #[test]
    fn only_the_pending_proposal_can_consume_the_delay_after_it_is_due() {
        let env = Env::default();
        env.mock_all_auths();
        let account = Address::generate(&env);
        let operator = Address::generate(&env);
        let rule = recovery_rule(&env, &account, 9);
        let context = signer_change_context(&env, &account);
        set_ledger(&env, 10);
        let contract_id = env.register(TimeDelayPolicy, ());
        let client = TimeDelayPolicyClient::new(&env, &contract_id);
        client.configure(&account, &9, &operator, &2);
        let proposal = proposal_hash(&env, &context);
        client.initiate_recovery(&account, &9, &operator, &proposal, &20);
        set_ledger(&env, 15);
        env.as_contract(&contract_id, || {
            <TimeDelayPolicy as Policy>::enforce(
                &env,
                context.clone(),
                vec![&env],
                rule.clone(),
                account.clone(),
            );
        });
        assert!(client.get_pending(&account, &9).is_none());

        client.initiate_recovery(&account, &9, &operator, &proposal, &20);
        set_ledger(&env, 20);
        let different_context = Context::Contract(ContractContext {
            contract: account.clone(),
            fn_name: Symbol::new(&env, "remove_signer"),
            args: vec![&env, 0_u32.into_val(&env)],
        });
        assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            env.as_contract(&contract_id, || {
                <TimeDelayPolicy as Policy>::enforce(
                    &env,
                    different_context,
                    vec![&env],
                    rule,
                    account.clone(),
                );
            });
        }))
        .is_err());
    }
}
