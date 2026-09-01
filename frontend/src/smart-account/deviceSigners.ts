import type { ContractSigner, TransactionResult } from "smart-account-kit";

export interface DeviceSignerKit {
  rules: { get(contextRuleId: number): Promise<{ result: { signers: ContractSigner[] } }> };
  signers: { remove(contextRuleId: number, signer: ContractSigner): Promise<unknown> };
  signAndSubmit(transaction: unknown): Promise<TransactionResult>;
}

export function ensureCanRemoveSigner(signerCount: number): void {
  if (signerCount <= 1) throw new Error("最後のパスキーは外せません。先に別の端末を登録するか、リカバリーフレーズを用意してください。");
}

export async function removeDeviceSigner(kit: DeviceSignerKit, signer: ContractSigner): Promise<void> {
  const rule = await kit.rules.get(0);
  ensureCanRemoveSigner(rule.result.signers.length);
  // signAndSubmit never throws for an on-chain failure — it resolves with
  // { success: false, error } — so a failed removal must be checked here.
  const result = await kit.signAndSubmit(await kit.signers.remove(0, signer));
  if (!result.success) throw new Error(`端末を外せませんでした: ${result.error.message}`);
}
