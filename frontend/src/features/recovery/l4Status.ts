import {
  Account, Address, BASE_FEE, Keypair, Operation, TransactionBuilder, hash, rpc, scValToNative, xdr,
} from "@stellar/stellar-sdk";

export interface RecoveryStatus {
  state: "no_pending_recovery" | "awaiting_operator_approvals" | "operator_action_allowed" | "operator_action_submitted";
  approval_count: number;
}

export interface OnchainRecoveryPending {
  validFromLedger: number;
  expiresAtLedger: number;
  latestLedger: number;
}

const READ_ONLY_ACCOUNT = new Account(
  Keypair.fromRawEd25519Seed(hash(new TextEncoder().encode("account-sample/l4-status-read/v1"))).publicKey(),
  "0",
);

/** Reads the public TimeDelayPolicy status without any wallet credential. */
export async function getOnchainRecoveryPending(
  rpcUrl: string,
  networkPassphrase: string,
  timeDelayPolicyAddress: string,
  accountContractId: string,
): Promise<OnchainRecoveryPending | null> {
  const transaction = new TransactionBuilder(READ_ONLY_ACCOUNT, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(Operation.invokeHostFunction({
      func: xdr.HostFunction.hostFunctionTypeInvokeContract(new xdr.InvokeContractArgs({
        contractAddress: Address.fromString(timeDelayPolicyAddress).toScAddress(),
        functionName: "get_pending_for_account",
        args: [new Address(accountContractId).toScVal()],
      })),
      auth: [],
    }))
    .setTimeout(30)
    .build();
  const simulation = await new rpc.Server(rpcUrl).simulateTransaction(transaction);
  if ("error" in simulation && simulation.error) throw new Error("待機期間の状況を確認できませんでした");
  const retval = "result" in simulation ? simulation.result?.retval : undefined;
  if (!retval) throw new Error("待機期間の状況を確認できませんでした");
  const pending = decodePendingRecovery(retval);
  if (!pending) return null;
  return { ...pending, latestLedger: Number(simulation.latestLedger) };
}

export function decodePendingRecovery(value: xdr.ScVal): Omit<OnchainRecoveryPending, "latestLedger"> | null {
  const native = scValToNative(value) as null | { valid_from_ledger?: unknown; expires_at_ledger?: unknown };
  if (native === null) return null;
  const validFromLedger = Number(native.valid_from_ledger);
  const expiresAtLedger = Number(native.expires_at_ledger);
  if (!Number.isInteger(validFromLedger) || !Number.isInteger(expiresAtLedger)) {
    throw new Error("待機期間の情報を確認できませんでした");
  }
  return { validFromLedger, expiresAtLedger };
}

/** Stellar Testnet/localnet ledgers close approximately every five seconds. */
export function pendingRecoveryCopy(pending: OnchainRecoveryPending): string {
  const ledgers = Math.max(0, pending.validFromLedger - pending.latestLedger);
  if (ledgers === 0) return "待機期間が終わりました。新しいパスキーを登録できます。";
  const hours = Math.ceil((ledgers * 5) / 3_600);
  return `復旧の待機期間が続いています。あと約${hours}時間です。`;
}

export async function getRecoveryStatus(
  contractId: string,
  fetcher: typeof fetch = fetch,
): Promise<RecoveryStatus> {
  const response = await fetcher(`/api/l4/status/${encodeURIComponent(contractId)}`);
  if (!response.ok) throw new Error("復旧状況を確認できませんでした");
  return await response.json() as RecoveryStatus;
}

export function recoveryStatusCopy(status: RecoveryStatus): string {
  switch (status.state) {
    case "no_pending_recovery": return "現在、進行中の復旧依頼はありません。";
    case "awaiting_operator_approvals": return "復旧依頼を受け付けました。運営の確認を待っています。";
    case "operator_action_allowed": return "運営の確認がそろいました。次の手続きに進めます。";
    case "operator_action_submitted": return "運営が手続きを開始しました。待機期間の状況を確認できます。";
  }
}
