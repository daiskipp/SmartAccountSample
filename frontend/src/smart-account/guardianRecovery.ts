import { Address, xdr } from "@stellar/stellar-sdk";
import {
  createCallContractContext,
  createThresholdParams,
  createWebAuthnSigner,
  type ContextRule,
  type ContractSigner,
} from "smart-account-kit";
import { validateGuardianConfiguration, type GuardianConfiguration, type GuardianEntry } from "../features/recovery/guardians";

const RULE_NAME = "guardian-recovery";

export interface GuardianRecoveryKit {
  rules: {
    add(context: ReturnType<typeof createCallContractContext>, name: string, signers: ContractSigner[], policies: Map<string, unknown>): Promise<unknown>;
  };
  signAndSubmit(transaction: unknown): Promise<unknown>;
  convertPolicyParams(policyType: "threshold", params: ReturnType<typeof createThresholdParams>): unknown;
}

export interface GuardianRecoveryDeployment {
  accountContractId: string;
  webauthnVerifierAddress: string;
  thresholdPolicyAddress: string;
  recoveryScopePolicyAddress: string;
}

export interface GuardianRecoveryExecutionKit {
  signers: {
    addPasskey(contextRuleId: number, appName: string, userName: string, options?: { nickname?: string }): Promise<{
      transaction: unknown;
    }>;
  };
  multiSigners: {
    buildSelectedSigners(signers: ContractSigner[]): unknown[];
    operation(transaction: unknown, selectedSigners: unknown[]): Promise<unknown>;
  };
}

export interface GuardianRecoveryMutationKit {
  rules: {
    list(): Promise<ContextRule[]>;
  };
  signers: {
    addBatch(contextRuleId: number, signers: ContractSigner[], options: { existingSignerCount: number }): Promise<unknown>;
    remove(contextRuleId: number, signer: ContractSigner): Promise<unknown>;
  };
  policyClients: {
    threshold(policyAddress: string): {
      setThreshold(threshold: number, contextRule: ContextRule): Promise<unknown>;
    };
  };
  signAndSubmit(transaction: unknown): Promise<unknown>;
}

/** Encodes `RecoveryScopeParams { target_rule_id: 0 }` for the custom policy. */
export function recoveryScopeParams(
  allowedContract: string,
  targetRuleId = 0,
  timeDelayPolicy = allowedContract,
  permitsInitiation = false,
): xdr.ScVal {
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("target_rule_id"),
      val: xdr.ScVal.scvU32(targetRuleId),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("allowed_contract"),
      val: new Address(allowedContract).toScVal(),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("time_delay_policy"),
      val: new Address(timeDelayPolicy).toScVal(),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol("permits_initiation"),
      val: xdr.ScVal.scvBool(permitsInitiation),
    }),
  ]);
}

function guardianSigner(webauthnVerifierAddress: string, guardian: GuardianEntry): ContractSigner {
  return createWebAuthnSigner(webauthnVerifierAddress, guardian.passkey.publicKey, guardian.passkey.credentialId);
}

/** Creates a guardian-only rule limited to replacements of Rule#0 signers. */
export async function installGuardianRecovery(
  kit: GuardianRecoveryKit,
  configuration: GuardianConfiguration,
  deployment: GuardianRecoveryDeployment,
): Promise<void> {
  validateGuardianConfiguration(configuration);
  const { accountContractId, webauthnVerifierAddress, thresholdPolicyAddress, recoveryScopePolicyAddress } = deployment;
  if (!accountContractId || !webauthnVerifierAddress || !thresholdPolicyAddress || !recoveryScopePolicyAddress) {
    throw new Error("ガーディアン復旧の接続先が設定されていません");
  }
  const transaction = await kit.rules.add(
    createCallContractContext(accountContractId),
    RULE_NAME,
    configuration.guardians.map((guardian) => guardianSigner(webauthnVerifierAddress, guardian)),
    new Map([
      [thresholdPolicyAddress, kit.convertPolicyParams("threshold", createThresholdParams(configuration.threshold))],
      [recoveryScopePolicyAddress, recoveryScopeParams(accountContractId)],
    ]),
  );
  await kit.signAndSubmit(transaction);
}

async function findGuardianRule(kit: GuardianRecoveryMutationKit): Promise<ContextRule> {
  const rules = await kit.rules.list();
  const rule = rules.find((candidate) => candidate.name === RULE_NAME);
  if (!rule) throw new Error("ガーディアンの復旧設定が見つかりません");
  return rule;
}

/**
 * Adds one guardian passkey to an existing Rule#Recovery and re-asserts the
 * threshold on the same signer set, since the threshold policy is not
 * auto-notified when a rule's signers change.
 */
export async function addGuardianSigner(
  kit: GuardianRecoveryMutationKit,
  webauthnVerifierAddress: string,
  thresholdPolicyAddress: string,
  guardian: GuardianEntry,
  threshold: number,
): Promise<void> {
  const rule = await findGuardianRule(kit);
  const signer = guardianSigner(webauthnVerifierAddress, guardian);
  const addTransaction = await kit.signers.addBatch(rule.id, [signer], { existingSignerCount: rule.signers.length });
  await kit.signAndSubmit(addTransaction);
  const refreshedRule = await findGuardianRule(kit);
  const thresholdTransaction = await kit.policyClients.threshold(thresholdPolicyAddress).setThreshold(threshold, refreshedRule);
  await kit.signAndSubmit(thresholdTransaction);
}

/**
 * Removes one guardian passkey. The caller must ensure the target threshold
 * does not exceed the signer count that remains afterward; lower the
 * threshold first via {@link updateGuardianThreshold} when needed.
 */
export async function removeGuardianSigner(
  kit: GuardianRecoveryMutationKit,
  signer: ContractSigner,
): Promise<void> {
  const rule = await findGuardianRule(kit);
  const transaction = await kit.signers.remove(rule.id, signer);
  await kit.signAndSubmit(transaction);
}

/** Updates M on the threshold policy attached to Rule#Recovery. */
export async function updateGuardianThreshold(
  kit: GuardianRecoveryMutationKit,
  thresholdPolicyAddress: string,
  threshold: number,
): Promise<void> {
  const rule = await findGuardianRule(kit);
  if (!Number.isInteger(threshold) || threshold < 2 || threshold > rule.signers.length) {
    throw new Error("必要な承認数を正しく設定してください");
  }
  const transaction = await kit.policyClients.threshold(thresholdPolicyAddress).setThreshold(threshold, rule);
  await kit.signAndSubmit(transaction);
}

/**
 * Creates a replacement passkey and submits its Rule#0 addition through the
 * guardian rule. `operation` collects only locally available guardian
 * signatures; the on-chain threshold policy rejects an under-signed request.
 */
export async function addReplacementPasskeyWithGuardians(
  kit: GuardianRecoveryExecutionKit,
  guardianSigners: ContractSigner[],
  nickname: string,
): Promise<number> {
  if (!nickname.trim()) throw new Error("新しいパスキーの名前を入力してください");
  const selectedSigners = kit.multiSigners.buildSelectedSigners(guardianSigners);
  if (selectedSigners.length === 0) throw new Error("この端末で署名できるガーディアンの鍵が見つかりません");
  const { transaction } = await kit.signers.addPasskey(0, "Account Sample recovery", nickname.trim(), {
    nickname: nickname.trim(),
  });
  await kit.multiSigners.operation(transaction, selectedSigners);
  return selectedSigners.length;
}
