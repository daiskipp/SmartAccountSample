import { useEffect, useState } from "react";
import type { SmartAccountKit } from "smart-account-kit";
import { L4RecoveryRequestPage } from "./L4RecoveryRequestPage";
import { L4FinalizeRecovery } from "./L4FinalizeRecovery";
import { cancelConfiguredL4Recovery } from "../../smart-account/l4RecoveryExecute";
import {
  getOnchainRecoveryPending, getRecoveryStatus, pendingRecoveryCopy, recoveryStatusCopy,
  type OnchainRecoveryPending, type RecoveryStatus,
} from "./l4Status";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const POLL_INTERVAL_MS = 30_000;

const rpcUrl = import.meta.env.VITE_SMART_ACCOUNT_RPC_URL;
const networkPassphrase = import.meta.env.VITE_SMART_ACCOUNT_NETWORK_PASSPHRASE;
const statusPolicyAddress = import.meta.env.VITE_TIME_DELAY_POLICY_STATUS_ADDRESS;
const timeDelayPolicyAddress = import.meta.env.VITE_TIME_DELAY_POLICY_ADDRESS;

type Step = "request" | "waiting" | "finalize";

const STEPS: Array<{ id: Step; label: string }> = [
  { id: "request", label: "① 依頼" },
  { id: "waiting", label: "② 待機" },
  { id: "finalize", label: "③ パスキー再登録" },
];

export function RecoveryHelp({ kit }: { kit: SmartAccountKit | null }): React.JSX.Element {
  const [step, setStep] = useState<Step>("request");
  const [contractId, setContractId] = useState("");

  return <div className="mx-auto flex max-w-md flex-col gap-4 p-6">
    <Card>
      <CardHeader>
        <CardTitle>サポートに復旧を依頼する</CardTitle>
        <CardDescription>リカバリーフレーズもガーディアンも使えないときの最終手段です。運営の確認と待機期間を経て、新しいパスキーを登録します。</CardDescription>
      </CardHeader>
      <CardContent>
        <nav aria-label="復旧の進み具合" className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-sm">
          {STEPS.map((entry) => <span key={entry.id} className={entry.id === step ? "text-foreground font-medium" : undefined}>{entry.label}</span>)}
        </nav>
      </CardContent>
    </Card>

    {step === "request" && <L4RecoveryRequestPage
      kit={kit}
      timeDelayPolicyAddress={timeDelayPolicyAddress}
      contractId={contractId}
      onContractIdChange={setContractId}
      onSubmitted={(submittedContractId) => { setContractId(submittedContractId); setStep("waiting"); }}
    />}

    {step === "waiting" && <WaitingStep
      kit={kit}
      contractId={contractId}
      onCancelled={() => setStep("request")}
      onReady={() => setStep("finalize")}
    />}

    {step === "finalize" && <L4FinalizeRecovery
      kit={kit}
      contractId={contractId}
      onContractIdChange={setContractId}
      onFinalized={() => setStep("request")}
    />}
  </div>;
}

interface WaitingStepProps {
  kit: SmartAccountKit | null;
  contractId: string;
  onCancelled(): void;
  onReady(): void;
}

function WaitingStep({ kit, contractId, onCancelled, onReady }: WaitingStepProps): React.JSX.Element {
  const [status, setStatus] = useState<RecoveryStatus | null>(null);
  const [onchainPending, setOnchainPending] = useState<OnchainRecoveryPending | null>(null);
  const [onchainChecked, setOnchainChecked] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = async (): Promise<void> => {
    try {
      const nextStatus = await getRecoveryStatus(contractId);
      setStatus(nextStatus);
      if (rpcUrl && networkPassphrase && statusPolicyAddress) {
        setOnchainPending(await getOnchainRecoveryPending(rpcUrl, networkPassphrase, statusPolicyAddress, contractId));
        setOnchainChecked(true);
      }
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "復旧状況を確認できませんでした");
    }
  };

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => { void refresh(); }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractId]);

  const cancel = async (): Promise<void> => {
    if (!kit || !timeDelayPolicyAddress) return;
    try {
      await cancelConfiguredL4Recovery(kit, contractId, timeDelayPolicyAddress);
      onCancelled();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "待機中の復旧依頼を取り消せませんでした");
    }
  };

  const ledgersRemaining = onchainPending ? Math.max(0, onchainPending.validFromLedger - onchainPending.latestLedger) : null;
  const submitted = status?.state === "operator_action_submitted";
  const readyToFinalize = submitted && (!onchainChecked || ledgersRemaining === 0);

  return <Card>
    <CardHeader>
      <CardTitle>運営の確認と待機期間を待っています</CardTitle>
      <CardDescription>この画面を閉じても依頼は失われません。時間をおいてから「更新する」で状況を確認してください。</CardDescription>
    </CardHeader>
    <CardContent className="flex flex-col gap-3">
      {status && <p role="status" className="text-sm">{recoveryStatusCopy(status)}</p>}
      {onchainPending && <p role="status" className="text-sm">{pendingRecoveryCopy(onchainPending)}</p>}
      {message && <p role="alert" className="text-muted-foreground text-sm">{message}</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => void refresh()}>更新する</Button>
        {kit && timeDelayPolicyAddress && <Button variant="outline" onClick={() => void cancel()}>取り消す</Button>}
        <Button disabled={!readyToFinalize} onClick={onReady}>次へ進む</Button>
      </div>
    </CardContent>
  </Card>;
}
