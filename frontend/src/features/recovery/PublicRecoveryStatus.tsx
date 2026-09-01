import { useState } from "react";
import {
  getOnchainRecoveryPending, getRecoveryStatus, pendingRecoveryCopy, recoveryStatusCopy,
  type OnchainRecoveryPending, type RecoveryStatus,
} from "./l4Status";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface PublicRecoveryStatusProps {
  rpcUrl?: string;
  networkPassphrase?: string;
  statusPolicyAddress?: string;
}

export function PublicRecoveryStatus(props: PublicRecoveryStatusProps): React.JSX.Element {
  const [contractId, setContractId] = useState("");
  const [status, setStatus] = useState<RecoveryStatus | null>(null);
  const [onchainPending, setOnchainPending] = useState<OnchainRecoveryPending | null>(null);
  const [onchainChecked, setOnchainChecked] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const check = async (): Promise<void> => {
    try {
      setOnchainPending(null);
      setOnchainChecked(false);
      const status = await getRecoveryStatus(contractId);
      setStatus(status);
      if (props.rpcUrl && props.networkPassphrase && props.statusPolicyAddress) {
        setOnchainPending(await getOnchainRecoveryPending(
          props.rpcUrl,
          props.networkPassphrase,
          props.statusPolicyAddress,
          contractId,
        ));
        setOnchainChecked(true);
      } else {
        setOnchainPending(null);
      }
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "復旧状況を確認できませんでした");
    }
  };

  return <div className="mx-auto max-w-md p-6">
    <Card>
      <CardHeader>
        <CardTitle>復旧状況を確認する</CardTitle>
        <CardDescription>ログインしなくても、復旧依頼の状況を確認できます。</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-2">
          <Label htmlFor="public-status-account">アカウントID</Label>
          <Input id="public-status-account" value={contractId} onChange={(event) => setContractId(event.target.value)} />
        </div>
        <Button disabled={!contractId} onClick={() => void check()} className="self-start">状況を確認する</Button>
        {status && <p role="status" className="text-sm">{recoveryStatusCopy(status)}</p>}
        {onchainPending && <p role="status" className="text-sm">{pendingRecoveryCopy(onchainPending)}</p>}
        {status && onchainChecked && !onchainPending && <p role="status" className="text-sm">現在、待機期間の記録はありません。</p>}
        {message && <p role="alert" className="text-muted-foreground text-sm">{message}</p>}
      </CardContent>
    </Card>
  </div>;
}
