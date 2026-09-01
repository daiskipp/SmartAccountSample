#![no_std]

use soroban_sdk::{
    auth::{Context, ContractContext},
    contract, contracterror, contractimpl, contracttype, panic_with_error, Address, Env, Symbol,
    TryFromVal, Val, Vec,
};
use stellar_accounts::{
    policies::Policy,
    smart_account::{ContextRule, ContextRuleType, Signer},
};

/// Restricts a recovery rule to modifying Rule#0 signer entries only.
///
/// Threshold and delay policies can be attached to the same ContextRule. All
/// policies are enforced together by the Smart Account, so this scope policy
/// prevents recovery signers from authorizing daily operations.
#[contract]
pub struct RecoveryScopePolicy;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RecoveryScopeParams {
    pub target_rule_id: u32,
    pub allowed_contract: Address,
    pub time_delay_policy: Address,
    pub permits_initiation: bool,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Installed(Address, u32),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum RecoveryScopeError {
    InvalidTargetRule = 1,
    InvalidRecoveryContext = 2,
    NotInstalled = 3,
}

#[contractimpl]
impl Policy for RecoveryScopePolicy {
    type AccountParams = RecoveryScopeParams;

    fn enforce(
        env: &Env,
        context: Context,
        _authenticated_signers: soroban_sdk::Vec<Signer>,
        context_rule: ContextRule,
        smart_account: Address,
    ) {
        smart_account.require_auth();
        let params = installed(env, &smart_account, context_rule.id);
        validate_recovery_context(env, &context, &smart_account, &params);
    }

    fn install(
        env: &Env,
        params: Self::AccountParams,
        context_rule: ContextRule,
        smart_account: Address,
    ) {
        smart_account.require_auth();
        match context_rule.context_type {
            ContextRuleType::CallContract(contract) if contract == params.allowed_contract => {}
            _ => panic_with_error!(env, RecoveryScopeError::InvalidRecoveryContext),
        }
        if !params.permits_initiation && params.target_rule_id != 0 {
            panic_with_error!(env, RecoveryScopeError::InvalidTargetRule);
        }
        env.storage().persistent().set(
            &DataKey::Installed(smart_account, context_rule.id),
            &params,
        );
    }

    fn uninstall(env: &Env, context_rule: ContextRule, smart_account: Address) {
        smart_account.require_auth();
        let key = DataKey::Installed(smart_account, context_rule.id);
        if !env.storage().persistent().has(&key) {
            panic_with_error!(env, RecoveryScopeError::NotInstalled);
        }
        env.storage().persistent().remove(&key);
    }
}

fn installed(env: &Env, smart_account: &Address, context_rule_id: u32) -> RecoveryScopeParams {
    env.storage()
        .persistent()
        .get(&DataKey::Installed(smart_account.clone(), context_rule_id))
        .unwrap_or_else(|| panic_with_error!(env, RecoveryScopeError::NotInstalled))
}

fn validate_recovery_context(
    env: &Env,
    context: &Context,
    smart_account: &Address,
    params: &RecoveryScopeParams,
) {
    let Context::Contract(ContractContext {
        contract,
        fn_name,
        args,
    }) = context
    else {
        panic_with_error!(env, RecoveryScopeError::InvalidRecoveryContext);
    };
    if !params.permits_initiation {
        let is_signer_update = fn_name == &Symbol::new(env, "add_signer")
            || fn_name == &Symbol::new(env, "remove_signer")
            || fn_name == &Symbol::new(env, "batch_add_signer");
        let requested_rule_id = args
            .get(0)
            .and_then(|arg: Val| u32::try_from_val(env, &arg).ok());
        if contract != smart_account || !is_signer_update || requested_rule_id != Some(params.target_rule_id) {
            panic_with_error!(env, RecoveryScopeError::InvalidRecoveryContext);
        }
        return;
    }
    let target = args
        .get(0)
        .and_then(|arg: Val| Address::try_from_val(env, &arg).ok());
    let target_fn = args
        .get(1)
        .and_then(|arg: Val| Symbol::try_from_val(env, &arg).ok());
    let target_args = args
        .get(2)
        .and_then(|arg: Val| Vec::<Val>::try_from_val(env, &arg).ok());
    let requested_account = target_args.as_ref().and_then(|values| {
        values.get(0).and_then(|arg| Address::try_from_val(env, &arg).ok())
    });
    let requested_rule_id = target_args.as_ref().and_then(|values| {
        values.get(1).and_then(|arg| u32::try_from_val(env, &arg).ok())
    });
    if contract != &params.allowed_contract
        || fn_name != &Symbol::new(env, "execute")
        || target != Some(params.time_delay_policy.clone())
        || target_fn != Some(Symbol::new(env, "initiate_recovery"))
        || requested_account != Some(smart_account.clone())
        || requested_rule_id != Some(params.target_rule_id)
    {
        panic_with_error!(env, RecoveryScopeError::InvalidRecoveryContext);
    }
}

#[cfg(test)]
mod test {
    extern crate std;

    use super::*;
    use soroban_sdk::{auth::ContractContext, testutils::Address as _, vec, IntoVal};

    fn context(
        env: &Env,
        account: &Address,
        function: soroban_sdk::Symbol,
        rule_id: u32,
    ) -> Context {
        Context::Contract(ContractContext {
            contract: account.clone(),
            fn_name: function,
            args: vec![env, rule_id.into_val(env)],
        })
    }

    fn signer_params(account: &Address) -> RecoveryScopeParams {
        RecoveryScopeParams {
            target_rule_id: 0,
            allowed_contract: account.clone(),
            time_delay_policy: account.clone(),
            permits_initiation: false,
        }
    }

    #[test]
    fn allows_only_rule_zero_signer_changes() {
        let env = Env::default();
        let account = Address::generate(&env);
        validate_recovery_context(
            &env,
            &context(&env, &account, Symbol::new(&env, "add_signer"), 0),
            &account,
            &signer_params(&account),
        );
        validate_recovery_context(
            &env,
            &context(&env, &account, Symbol::new(&env, "remove_signer"), 0),
            &account,
            &signer_params(&account),
        );
        validate_recovery_context(
            &env,
            &context(&env, &account, Symbol::new(&env, "batch_add_signer"), 0),
            &account,
            &signer_params(&account),
        );
    }

    #[test]
    fn rejects_daily_operations_other_rules_and_other_accounts() {
        let env = Env::default();
        let account = Address::generate(&env);
        let other = Address::generate(&env);
        assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            validate_recovery_context(
                &env,
                &context(&env, &account, Symbol::new(&env, "transfer"), 0),
                &account,
                &signer_params(&account),
            )
        }))
        .is_err());
        assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            validate_recovery_context(
                &env,
                &context(&env, &account, Symbol::new(&env, "add_signer"), 1),
                &account,
                &signer_params(&account),
            )
        }))
        .is_err());
        assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            validate_recovery_context(
                &env,
                &context(&env, &other, Symbol::new(&env, "add_signer"), 0),
                &account,
                &signer_params(&account),
            )
        }))
        .is_err());
    }

    #[test]
    fn permits_only_the_bound_time_delay_initiation() {
        let env = Env::default();
        let account = Address::generate(&env);
        let delay_policy = Address::generate(&env);
        let params = RecoveryScopeParams {
            target_rule_id: 7,
            allowed_contract: account.clone(),
            time_delay_policy: delay_policy.clone(),
            permits_initiation: true,
        };
        let target_args: Vec<Val> = vec![
            &env,
            account.clone().into_val(&env),
            7_u32.into_val(&env),
        ];
        let context = Context::Contract(ContractContext {
            contract: account.clone(),
            fn_name: Symbol::new(&env, "execute"),
            args: vec![
                &env,
                delay_policy.into_val(&env),
                Symbol::new(&env, "initiate_recovery").into_val(&env),
                target_args.into_val(&env),
            ],
        });
        validate_recovery_context(&env, &context, &account, &params);

        let wrong_target_args: Vec<Val> = vec![
            &env,
            account.clone().into_val(&env),
            8_u32.into_val(&env),
        ];
        let wrong_rule = Context::Contract(ContractContext {
            contract: params.allowed_contract.clone(),
            fn_name: Symbol::new(&env, "execute"),
            args: vec![
                &env,
                params.time_delay_policy.clone().into_val(&env),
                Symbol::new(&env, "initiate_recovery").into_val(&env),
                wrong_target_args.into_val(&env),
            ],
        });
        assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            validate_recovery_context(&env, &wrong_rule, &params.allowed_contract, &params)
        }))
        .is_err());
    }
}
