import { useState } from "react";
import type { SmartAccountKit } from "smart-account-kit";
import { fromBase64Url, requestL4Recovery } from "./l4RecoveryRequest";
import { cancelConfiguredL4Recovery } from "../../smart-account/l4RecoveryExecute";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface L4RecoveryRequestPageProps {
  kit: SmartAccountKit | null;
  timeDelayPolicyAddress?: string;
  contractId: string;
  onContractIdChange(contractId: string): void;
  onSubmitted(contractId: string): void;
}

const network = import.meta.env.VITE_SMART_ACCOUNT_NETWORK_PASSPHRASE ?? "";

export function L4RecoveryRequestPage({ kit, timeDelayPolicyAddress, contractId, onContractIdChange, onSubmitted }: L4RecoveryRequestPageProps): React.JSX.Element {
  const [secret, setSecret] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    try {
      const secretBytes = fromBase64Url(secret);
      if (secretBytes.length !== 32) throw new Error("控えた復旧コードを確認してください。");
      await requestL4Recovery(secretBytes, { contractId, network });
      secretBytes.fill(0);
      setSecret("");
      setMessage(null);
      onSubmitted(contractId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "依頼を受け付けられませんでした");
    }
  };

  const cancel = async (): Promise<void> => {
    if (!kit || !timeDelayPolicyAddress || !contractId.trim()) return;
    try {
      await cancelConfiguredL4Recovery(kit, contractId.trim(), timeDelayPolicyAddress);
      setMessage("待機中の復旧依頼を取り消しました。登録済みのパスキーは変わっていません。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "待機中の復旧依頼を取り消せませんでした");
    }
  };

  return <Card>
    <CardHeader>
      <CardTitle>サポートに復旧を依頼する</CardTitle>
      <CardDescription>控えていた復旧コードで、本人確認をこの端末で行います。復旧コードそのものは送信されません。</CardDescription>
    </CardHeader>
    <CardContent className="flex flex-col gap-4">
      <div className="grid gap-2">
        <Label htmlFor="l4-request-account">アカウントID</Label>
        <Input id="l4-request-account" value={contractId} onChange={(event) => onContractIdChange(event.target.value)} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="l4-request-code">復旧コード</Label>
        <Input id="l4-request-code" value={secret} onChange={(event) => setSecret(event.target.value)} autoComplete="off" />
      </div>
      {kit && timeDelayPolicyAddress && contractId.trim() && <Button variant="outline" size="sm" className="self-start" onClick={() => void cancel()}>
        待機中の復旧依頼を取り消す
      </Button>}
      {message && <p role="alert" className="text-muted-foreground text-sm">{message}</p>}
    </CardContent>
    <CardFooter>
      <Button disabled={!contractId.trim() || !secret.trim()} onClick={() => void submit()}>確認して依頼する</Button>
    </CardFooter>
  </Card>;
}
