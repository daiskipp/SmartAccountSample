import { useState } from "react";
import type { ContractSigner, SmartAccountKit } from "smart-account-kit";
import { addReplacementPasskeyWithGuardians } from "../../smart-account/guardianRecovery";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface GuardianRecoveryExecuteProps {
  kit: SmartAccountKit | null;
  /** The account being recovered. A guardian's own kit is never connected to
   * it by default, so this must be supplied (e.g. via a `?account=` link) or
   * entered by hand before the guardian rule can be loaded. */
  accountContractId?: string;
}

interface RecoveryRule {
  name: string;
  signers: ContractSigner[];
}

export function GuardianRecoveryExecute({ kit, accountContractId }: GuardianRecoveryExecuteProps): React.JSX.Element {
  const [contractId, setContractId] = useState(accountContractId ?? "");
  const [connected, setConnected] = useState(false);
  const [rule, setRule] = useState<RecoveryRule | null>(null);
  const [nickname, setNickname] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const connectAndLoad = async (): Promise<void> => {
    if (!kit || !contractId.trim()) return;
    setSubmitting(true);
    setMessage(null);
    try {
      // A guardian's device is never already connected to the account being
      // recovered. Pick this device's passkey, associate it with the target
      // account as a non-primary (trusted) mapping, then connect through it —
      // otherwise connectWallet resolves to the wrong (self-derived) address.
      const { credentialId } = await kit.authenticatePasskey();
      const stored = (await kit.credentials.getAll()).find((credential) => credential.credentialId === credentialId);
      if (!stored) throw new Error("この端末にガーディアン用のパスキーが見つかりません");
      await kit.credentials.save({
        credentialId,
        publicKey: stored.publicKey,
        contractId: contractId.trim(),
        isPrimary: false,
        nickname: stored.nickname,
      });
      await kit.connectWallet({ credentialId });
      setConnected(true);
      const rules = await kit.rules.list();
      const found = rules.find((candidate) => candidate.name === "guardian-recovery");
      if (!found) throw new Error("ガーディアンの復旧設定が見つかりません");
      setRule({ name: found.name, signers: found.signers });
      setMessage("復旧に使えるガーディアンを確認しました。この端末でガーディアンが署名すると、新しいパスキーを追加できます。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "復旧設定を読み込めませんでした");
    } finally {
      setSubmitting(false);
    }
  };

  const recover = async (): Promise<void> => {
    if (!kit || !rule) return;
    setSubmitting(true);
    setMessage(null);
    try {
      const signerCount = await addReplacementPasskeyWithGuardians(kit, rule.signers, nickname);
      setMessage(`${signerCount}人分の署名をこの端末で集め、新しいパスキーを追加しました。不要になった古いパスキーはデバイス管理から外してください。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "新しいパスキーを追加できませんでした");
    } finally {
      setSubmitting(false);
    }
  };

  return <section className="flex min-h-svh flex-col items-center justify-center gap-4 p-6">
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>ガーディアンでアカウントを復旧する</CardTitle>
        <CardDescription>登録済みのガーディアンそれぞれに署名してもらいます。必要な人数に届かなければ、パスキーは追加されません。</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!connected && <div className="grid gap-2">
          <Label htmlFor="guardian-recovery-account">本人のアカウントID</Label>
          <Input id="guardian-recovery-account" value={contractId} onChange={(event) => setContractId(event.target.value)} />
        </div>}
        {rule && <div className="grid gap-2">
          <Label htmlFor="guardian-recovery-nickname">新しいパスキーの名前</Label>
          <Input id="guardian-recovery-nickname" value={nickname} onChange={(event) => setNickname(event.target.value)} />
        </div>}
        {message && <p role="alert" className="text-muted-foreground text-sm">{message}</p>}
      </CardContent>
      <CardFooter>
        {rule
          ? <Button disabled={!nickname.trim() || submitting} onClick={() => void recover()}>
            {submitting ? "署名を集めています…" : "新しいパスキーを追加する"}
          </Button>
          : <Button disabled={!kit || !contractId.trim() || submitting} onClick={() => void connectAndLoad()}>
            {submitting ? "確認しています…" : "この端末のパスキーで復旧の設定を確認する"}
          </Button>}
      </CardFooter>
    </Card>
  </section>;
}
