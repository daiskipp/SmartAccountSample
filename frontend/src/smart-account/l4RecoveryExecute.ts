import { Address } from "@stellar/stellar-sdk";
import type { ContractSigner } from "smart-account-kit";
import { Keypair } from "@stellar/stellar-sdk";
import { deriveRecoverySigningSeed, type RecoveryPhrase } from "../crypto/recoveryPhrase";

export interface L4RecoveryInitiationKit {
  execute(target: string, targetFn: string, targetArgs: unknown[]): Promise<unknown>;
  multiSigners: {
    buildSelectedSigners(signers: ContractSigner[]): unknown[];
    operation(
      transaction: unknown,
      selectedSigners: unknown[],
      options: { resolveContextRuleIds(): number[] },
    ): Promise<unknown>;
  };
}

export interface L4RecoveryCancellationKit {
  execute(target: string, targetFn: string, targetArgs: unknown[]): Promise<unknown>;
  signAndSubmit(transaction: unknown): Promise<unknown>;
}

export interface L4RecoveryCancellationLookupKit extends L4RecoveryCancellationKit {
  rules: {
    list(): Promise<Array<{ id: number; name: string }>>;
  };
}

export interface L4RecoveryFinalizationKit {
  connectWallet(options: { contractId: string; credentialId: string }): Promise<unknown>;
  disconnect(): Promise<void>;
  externalSigners: {
    addEd25519FromSecret(secret: string): { address: string };
    remove(address: string): void;
  };
  credentials: { delete(credentialId: string): Promise<void> };
  rules: {
    get(contextRuleId: number): Promise<{ result: { signers: ContractSigner[] } }>;
    list(): Promise<Array<{ id: number; name: string }>>;
  };
  signers: {
    addPasskey(contextRuleId: number, appName: string, userName: string, options: { nickname: string }): Promise<{
      credentialId: string;
      transaction: unknown;
    }>;
  };
  multiSigners: {
    buildSelectedSigners(signers: ContractSigner[], activeCredentialId?: string | null): unknown[];
    operation(transaction: unknown, selectedSigners: unknown[], options: { resolveContextRuleIds(): number[] }): Promise<{ success?: boolean; error?: unknown }>;
  };
}

export interface L4RecoveryInitiation {
  accountContractId: string;
  timeDelayPolicyAddress: string;
  initiationRuleId: number;
  finalizationRuleId: number;
  operatorAddress: string;
  signers: ContractSigner[];
  proposalHash: Uint8Array;
  expiresAtLedger: number;
}

/**
 * Starts a delay proposal with the initiation-only rule. The selected rule is
 * crucial: it authorizes only Smart Account `execute` calls that target the
 * exact delay-policy `initiate_recovery` operation.
 */
export async function initiateL4Recovery(
  kit: L4RecoveryInitiationKit,
  request: L4RecoveryInitiation,
): Promise<void> {
  if (request.proposalHash.length !== 32) throw new Error("復旧内容を確認してください");
  if (!Number.isInteger(request.initiationRuleId) || request.initiationRuleId < 1
    || !Number.isInteger(request.finalizationRuleId) || request.finalizationRuleId < 1
    || !Number.isInteger(request.expiresAtLedger) || request.expiresAtLedger < 1) {
    throw new Error("復旧の設定を確認してください");
  }
  const selectedSigners = kit.multiSigners.buildSelectedSigners(request.signers);
  if (selectedSigners.length < 2) throw new Error("必要な2人分の署名がそろっていません");
  const transaction = await kit.execute(request.timeDelayPolicyAddress, "initiate_recovery", [
    new Address(request.accountContractId),
    request.finalizationRuleId,
    new Address(request.operatorAddress),
    request.proposalHash,
    request.expiresAtLedger,
  ]);
  await kit.multiSigners.operation(transaction, selectedSigners, {
    resolveContextRuleIds: () => [request.initiationRuleId],
  });
}

/**
 * Cancels through the connected account's default rule. Recovery-scoped rules
 * cannot authorize this `execute` context: their scope policy permits only
 * signer replacement or the bound initiation call.
 */
export async function cancelL4Recovery(
  kit: L4RecoveryCancellationKit,
  accountContractId: string,
  timeDelayPolicyAddress: string,
  finalizationRuleId: number,
): Promise<void> {
  if (!Number.isInteger(finalizationRuleId) || finalizationRuleId < 1) {
    throw new Error("復旧の設定を確認してください");
  }
  const transaction = await kit.execute(timeDelayPolicyAddress, "cancel_recovery", [
    new Address(accountContractId),
    finalizationRuleId,
  ]);
  await kit.signAndSubmit(transaction);
}

/**
 * Cancels using the connected wallet's default credential. The recovery-scope
 * rules intentionally reject the cancellation `execute` context, leaving the
 * normal Rule#0 path as the only available authorization route.
 */
export async function cancelConfiguredL4Recovery(
  kit: L4RecoveryCancellationLookupKit,
  accountContractId: string,
  timeDelayPolicyAddress: string,
): Promise<void> {
  const finalization = (await kit.rules.list()).find(
    (rule) => rule.name === "operator-recovery-finalize",
  );
  if (!finalization) throw new Error("待機中のサポート復旧設定が見つかりません");
  await cancelL4Recovery(kit, accountContractId, timeDelayPolicyAddress, finalization.id);
}

/**
 * After the delay is due, reconstructs the two user-held L4 signers in memory
 * and uses the finalization-only rule to add a replacement passkey to Rule#0.
 * Neither secret is sent to the API or persisted by the browser.
 */
export async function finalizeL4Recovery(
  kit: L4RecoveryFinalizationKit,
  accountContractId: string,
  phrase: RecoveryPhrase,
  secondFactorSecret: string,
  name: string,
): Promise<void> {
  if (!accountContractId || !name.trim() || !secondFactorSecret.trim()) {
    throw new Error("アカウント、リカバリーフレーズ、第2要素、新しいパスキーの名前を確認してください");
  }
  const finalization = (await kit.rules.list()).find(
    (rule) => rule.name === "operator-recovery-finalize",
  );
  if (!finalization) throw new Error("待機中のサポート復旧設定が見つかりません");
  const phraseSeed = await deriveRecoverySigningSeed(phrase);
  const phraseSecret = Keypair.fromRawEd25519Seed(phraseSeed).secret();
  phraseSeed.fill(0);
  const recoveryCredentialId = `l4-recovery-${crypto.randomUUID()}`;
  const externalAddresses: string[] = [];
  let replacementCredentialId: string | undefined;
  let connectedReplacement = false;
  try {
    await kit.connectWallet({ contractId: accountContractId, credentialId: recoveryCredentialId });
    externalAddresses.push(kit.externalSigners.addEd25519FromSecret(phraseSecret).address);
    externalAddresses.push(kit.externalSigners.addEd25519FromSecret(secondFactorSecret.trim()).address);
    const rule = await kit.rules.get(finalization.id);
    const selected = kit.multiSigners.buildSelectedSigners(rule.result.signers, null);
    if (selected.length < 2) throw new Error("リカバリーフレーズと第2要素の両方を確認してください");
    const replacement = await kit.signers.addPasskey(0, "Account Sample recovery", name.trim(), {
      nickname: "復旧用パスキー",
    });
    replacementCredentialId = replacement.credentialId;
    const result = await kit.multiSigners.operation(replacement.transaction, selected, {
      resolveContextRuleIds: () => [finalization.id],
    });
    if (result.success === false) {
      throw new Error(result.error instanceof Error ? result.error.message : "待機時間または復旧内容を確認してください");
    }
    await kit.disconnect();
    await kit.connectWallet({ contractId: accountContractId, credentialId: replacement.credentialId });
    connectedReplacement = true;
  } catch (error) {
    if (replacementCredentialId) await kit.credentials.delete(replacementCredentialId);
    throw error;
  } finally {
    externalAddresses.forEach((address) => kit.externalSigners.remove(address));
    if (!connectedReplacement) await kit.disconnect();
  }
}
