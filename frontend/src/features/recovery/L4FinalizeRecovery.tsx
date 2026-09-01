import { useState } from "react";
import type { SmartAccountKit } from "smart-account-kit";
import { finalizeL4Recovery } from "../../smart-account/l4RecoveryExecute";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface L4FinalizeRecoveryProps {
  kit: SmartAccountKit | null;
  contractId: string;
  onContractIdChange(contractId: string): void;
  onFinalized(): void;
}

export function L4FinalizeRecovery({ kit, contractId, onContractIdChange, onFinalized }: L4FinalizeRecoveryProps): React.JSX.Element {
  const [phrase, setPhrase] = useState("");
  const [secondFactorSecret, setSecondFactorSecret] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const finalize = async (): Promise<void> => {
    if (!kit) return;
    setSubmitting(true);
    try {
      await finalizeL4Recovery(
        kit,
        contractId.trim(),
        phrase.normalize("NFKD").trim().split(/\s+/),
        secondFactorSecret,
        name,
      );
      setPhrase("");
      setSecondFactorSecret("");
      setMessage("新しいパスキーを登録しました。これからはこの端末でログインできます。");
      onFinalized();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "新しいパスキーを登録できませんでした");
    } finally {
      setSubmitting(false);
    }
  };

  return <Card>
    <CardHeader>
      <CardTitle>新しいパスキーを登録する</CardTitle>
      <CardDescription>待機期間が終わったあと、リカバリーフレーズと予備の復旧コードをこの端末だけで使って、新しいパスキーを登録します。</CardDescription>
    </CardHeader>
    <CardContent className="flex flex-col gap-4">
      <div className="grid gap-2">
        <Label htmlFor="l4-finalize-account">アカウントID</Label>
        <Input id="l4-finalize-account" value={contractId} onChange={(event) => onContractIdChange(event.target.value)} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="l4-finalize-name">新しいパスキーの名前</Label>
        <Input id="l4-finalize-name" value={name} onChange={(event) => setName(event.target.value)} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="l4-finalize-phrase">リカバリーフレーズ</Label>
        <Textarea id="l4-finalize-phrase" value={phrase} onChange={(event) => setPhrase(event.target.value)} autoComplete="off" rows={3} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="l4-finalize-backup-code">予備の復旧コード</Label>
        <Input id="l4-finalize-backup-code" value={secondFactorSecret} onChange={(event) => setSecondFactorSecret(event.target.value)} autoComplete="off" />
      </div>
      {!kit && <p className="text-muted-foreground text-sm">接続先の設定を確認してください。</p>}
      {message && <p role="alert" className="text-muted-foreground text-sm">{message}</p>}
    </CardContent>
    <CardFooter>
      <Button disabled={!kit || !contractId.trim() || !name || !phrase || !secondFactorSecret || submitting} onClick={() => void finalize()}>
        {submitting ? "パスキーを登録しています…" : "新しいパスキーを登録する"}
      </Button>
    </CardFooter>
  </Card>;
}
