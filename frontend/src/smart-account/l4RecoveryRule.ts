import { Address, xdr } from "@stellar/stellar-sdk";
import {
  createCallContractContext,
  createDelegatedSigner,
  createEd25519Signer,
  createThresholdParams,
  type ContractSigner,
} from "smart-account-kit";
import { recoveryScopeParams } from "./guardianRecovery";

export interface L4RecoveryRuleKit {
  rules: {
    add(context: ReturnType<typeof createCallContractContext>, name: string, signers: ContractSigner[], policies: Map<string, unknown>): Promise<unknown>;
    list(): Promise<Array<{ id: number; name: string }>>;
  };
  signAndSubmit(transaction: unknown): Promise<unknown>;
  convertPolicyParams(policyType: "threshold", params: ReturnType<typeof createThresholdParams>): unknown;
}

export interface L4RecoveryRuleDeployment {
  accountContractId: string;
  operatorAddress: string;
  ed25519VerifierAddress: string;
  thresholdPolicyAddress: string;
  recoveryScopePolicyAddress: string;
  timeDelayPolicyAddress: string;
  delayLedgers: number;
}

/** Encodes `TimeDelayParams { operator, delay_ledgers }` for policy installation. */
export function timeDelayParams(operatorAddress: string, delayLedgers: number): xdr.ScVal {
  if (!Number.isInteger(delayLedgers) || delayLedgers < 1) throw new Error("待機時間を正しく設定してください");
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("operator"), val: new Address(operatorAddress).toScVal() }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("delay_ledgers"), val: xdr.ScVal.scvU32(delayLedgers) }),
  ]);
}

/**
 * Installs two operator-assisted 2-of-3 L4 rules plus a 2-of-2 self-recovery
 * rule. The initiation rule may call only
 * `initiate_recovery` on the delay policy; the finalization rule may only
 * replace Rule#0 signers after that pending proposal is due.
 */
export async function installL4RecoveryRule(
  kit: L4RecoveryRuleKit,
  deployment: L4RecoveryRuleDeployment,
  phrasePublicKey: Uint8Array,
  secondFactorPublicKey: Uint8Array,
): Promise<void> {
  const {
    accountContractId, operatorAddress, ed25519VerifierAddress, thresholdPolicyAddress,
    recoveryScopePolicyAddress, timeDelayPolicyAddress, delayLedgers,
  } = deployment;
  if (!accountContractId || !operatorAddress || !ed25519VerifierAddress || !thresholdPolicyAddress
    || !recoveryScopePolicyAddress || !timeDelayPolicyAddress) {
    throw new Error("運営復旧の接続先が設定されていません");
  }
  if (phrasePublicKey.length !== 32 || secondFactorPublicKey.length !== 32) {
    throw new Error("復旧用の公開鍵を確認してください");
  }
  if (phrasePublicKey.every((byte, index) => byte === secondFactorPublicKey[index])) {
    throw new Error("第2要素の鍵はリカバリーフレーズ由来の鍵とは別にしてください");
  }
  const signers = [
    createDelegatedSigner(operatorAddress),
    createEd25519Signer(ed25519VerifierAddress, phrasePublicKey),
    createEd25519Signer(ed25519VerifierAddress, secondFactorPublicKey),
  ];
  const finalization = await kit.rules.add(
    createCallContractContext(accountContractId),
    "operator-recovery-finalize",
    signers,
    new Map([
      [thresholdPolicyAddress, kit.convertPolicyParams("threshold", createThresholdParams(2))],
      [recoveryScopePolicyAddress, recoveryScopeParams(accountContractId)],
      [timeDelayPolicyAddress, timeDelayParams(operatorAddress, delayLedgers)],
    ]),
  );
  await kit.signAndSubmit(finalization);
  const finalRule = (await kit.rules.list()).find((rule) => rule.name === "operator-recovery-finalize");
  if (!finalRule) throw new Error("運営復旧の設定を確認できませんでした");
  const initiation = await kit.rules.add(
    createCallContractContext(accountContractId),
    "operator-recovery-initiate",
    signers,
    new Map([
      [thresholdPolicyAddress, kit.convertPolicyParams("threshold", createThresholdParams(2))],
      [recoveryScopePolicyAddress, recoveryScopeParams(accountContractId, finalRule.id, timeDelayPolicyAddress, true)],
    ]),
  );
  await kit.signAndSubmit(initiation);
  const selfRecovery = await kit.rules.add(
    createCallContractContext(accountContractId),
    "operator-recovery-self",
    [
      createEd25519Signer(ed25519VerifierAddress, phrasePublicKey),
      createEd25519Signer(ed25519VerifierAddress, secondFactorPublicKey),
    ],
    new Map([
      [thresholdPolicyAddress, kit.convertPolicyParams("threshold", createThresholdParams(2))],
      [recoveryScopePolicyAddress, recoveryScopeParams(accountContractId)],
    ]),
  );
  await kit.signAndSubmit(selfRecovery);
}
