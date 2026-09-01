import { createEd25519Signer, createThresholdParams, createWebAuthnSigner, describeSignerType, type ContractSigner, type TransactionResult } from "smart-account-kit";
import { StrKey } from "@stellar/stellar-sdk";

interface SignerMutationKit {
  signers: {
    addBatch(contextRuleId: number, signers: ContractSigner[], options: { existingSignerCount: number }): Promise<unknown>;
  };
  signAndSubmit(transaction: unknown): Promise<TransactionResult>;
}

/**
 * `signAndSubmit` never throws for an on-chain/relayer failure — it resolves
 * with `{ success: false, error }` — so every call site must check `success`
 * itself or a failed submission is silently treated as a success.
 */
function assertSubmitted(result: TransactionResult, action: string): void {
  if (!result.success) throw new Error(`${action}できませんでした: ${result.error.message}`);
}

export interface RecoverySignerKit extends SignerMutationKit {
  policies: {
    add(contextRuleId: number, policyAddress: string, installParams: unknown): Promise<unknown>;
  };
  convertPolicyParams(policyType: "threshold", params: unknown): unknown;
}

export interface PairedPasskeyKit extends SignerMutationKit {
  rules: { get(contextRuleId: number): Promise<{ result: { signers: unknown[] } }> };
}

export interface RuleReaderKit {
  rules: { get(contextRuleId: number): Promise<{ result: { signers: ContractSigner[] } }> };
}

/**
 * The raw 32-byte public key of Rule#0's L1 recovery-phrase Ed25519 signer, if
 * one is registered. Lets a fresh page load (not just the just-registered
 * in-memory value) find the key an L4 setup needs to bind against.
 */
export async function getRecoveryPhrasePublicKey(kit: RuleReaderKit): Promise<Uint8Array | null> {
  const rule = await kit.rules.get(0);
  const signer = rule.result.signers.find((candidate) => describeSignerType(candidate) === "Ed25519");
  return signer && signer.tag === "External" ? Uint8Array.from(signer.values[1]) : null;
}

/** Whether Rule#0 already has an L1 recovery-phrase Ed25519 signer registered. */
export async function hasRecoveryPhraseSigner(kit: RuleReaderKit): Promise<boolean> {
  return (await getRecoveryPhrasePublicKey(kit)) !== null;
}

/**
 * Adds the phrase-derived public key to Rule#0 without replacing its existing
 * passkey. The private key/phrase never enters this module or a network call.
 */
export async function addRecoveryPhraseSigner(
  kit: RecoverySignerKit,
  ed25519VerifierAddress: string,
  thresholdPolicyAddress: string,
  publicKey: Uint8Array,
): Promise<void> {
  if (!StrKey.isValidContract(ed25519VerifierAddress)) throw new Error("Ed25519 verifier contract address is required");
  if (!StrKey.isValidContract(thresholdPolicyAddress)) throw new Error("threshold policy contract address is required");
  if (publicKey.length !== 32) throw new Error("recovery signer public key must be 32 bytes");
  // A default context without a policy requires every signer. Install a 1-of-N
  // threshold while the original passkey is still the sole signer, so the
  // newly-added phrase is actually an independent L1 recovery signer.
  const threshold = await kit.policies.add(
    0,
    thresholdPolicyAddress,
    kit.convertPolicyParams("threshold", createThresholdParams(1)),
  );
  assertSubmitted(await kit.signAndSubmit(threshold), "しきい値ポリシーの設定を");
  const signer = createEd25519Signer(ed25519VerifierAddress, publicKey);
  const transaction = await kit.signers.addBatch(0, [signer], { existingSignerCount: 1 });
  assertSubmitted(await kit.signAndSubmit(transaction), "リカバリーフレーズの登録を");
}

/** Adds a newly paired passkey only after the existing Rule#0 holder confirms SAS. */
export async function addPairedPasskeySigner(
  kit: PairedPasskeyKit,
  webauthnVerifierAddress: string,
  publicKey: Uint8Array,
  credentialId: string,
): Promise<void> {
  if (!StrKey.isValidContract(webauthnVerifierAddress)) throw new Error("WebAuthn verifier contract address is required");
  if (publicKey.length !== 65 || !credentialId) throw new Error("new passkey data is invalid");
  const currentRule = await kit.rules.get(0);
  const signer = createWebAuthnSigner(webauthnVerifierAddress, publicKey, credentialId);
  const transaction = await kit.signers.addBatch(0, [signer], { existingSignerCount: currentRule.result.signers.length });
  assertSubmitted(await kit.signAndSubmit(transaction), "端末の追加を");
}
