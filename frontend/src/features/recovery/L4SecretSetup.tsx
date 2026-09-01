import { useEffect, useState } from "react";
import { Keypair } from "@stellar/stellar-sdk";
import type { SmartAccountKit } from "smart-account-kit";
import type { L4ProofMaterial } from "../../crypto/l4Proof";
import { installL4RecoveryRule } from "../../smart-account/l4RecoveryRule";
import { getRecoveryPhrasePublicKey } from "../../smart-account/recoverySigners";
import {
  base64Url,
  createL4CommitRequest,
  discardL4Secret,
  l4CommitRequest,
  registerL4Commit,
} from "./l4Commit";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

const RULE_NAME = "operator-recovery-finalize";

interface PreparedSecret {
  material: L4ProofMaterial;
  contractId: string;
  secondFactorSecret: string;
  secondFactorPublicKey: Uint8Array;
}

interface L4SecretSetupProps {
  kit: SmartAccountKit | null;
  accountContractId: string | null;
  /** Set right after this session registers a recovery phrase; the on-chain
   * lookup below covers every other case (e.g. a returning visit). */
  phrasePublicKey: Uint8Array | null;
  operatorAddress?: string;
  thresholdPolicyAddress?: string;
  recoveryScopePolicyAddress?: string;
  timeDelayPolicyAddress?: string;
  ed25519VerifierAddress?: string;
  delayLedgers?: number;
}

export function L4SecretSetup(props: L4SecretSetupProps): React.JSX.Element {
  const [prepared, setPrepared] = useState<PreparedSecret | null>(null);
  const [revealStep, setRevealStep] = useState<"recoveryCode" | "backupCode">("recoveryCode");
  const [confirmed, setConfirmed] = useState(false);
  const [loadedPhrasePublicKey, setLoadedPhrasePublicKey] = useState<Uint8Array | null>(null);
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!props.kit || !props.accountContractId) {
      setInstalled(null);
      setLoadedPhrasePublicKey(null);
      return;
    }
    const kit = props.kit;
    let cancelled = false;
    void kit.rules.list().then(
      (rules) => { if (!cancelled) setInstalled(rules.some((rule) => rule.name === RULE_NAME)); },
      () => { if (!cancelled) setInstalled(null); },
    );
    void getRecoveryPhrasePublicKey(kit).then(
      (key) => { if (!cancelled) setLoadedPhrasePublicKey(key); },
      () => { if (!cancelled) setLoadedPhrasePublicKey(null); },
    );
    return () => { cancelled = true; };
  }, [props.kit, props.accountContractId]);

  const phrasePublicKey = props.phrasePublicKey ?? loadedPhrasePublicKey;
  const canIssue = Boolean(props.kit && props.accountContractId && phrasePublicKey) && installed !== true;

  const issue = async (): Promise<void> => {
    if (!props.accountContractId) return;
    const next = await createL4CommitRequest(props.accountContractId);
    const secondFactor = Keypair.random();
    setPrepared({
      material: next.material, contractId: props.accountContractId,
      secondFactorSecret: secondFactor.secret(), secondFactorPublicKey: secondFactor.rawPublicKey(),
    });
    setRevealStep("recoveryCode");
    setConfirmed(false);
    setMessage(null);
  };

  const complete = async (): Promise<void> => {
    if (!prepared || !confirmed) return;
    try {
      const request = l4CommitRequest(prepared.contractId, prepared.material);
      if (!props.kit || !props.accountContractId || !phrasePublicKey) {
        throw new Error("リカバリーフレーズを登録したアカウントにログインしてから設定してください。");
      }
      props.kit.externalSigners.addEd25519FromSecret(prepared.secondFactorSecret, props.ed25519VerifierAddress);
      await installL4RecoveryRule(props.kit, {
        accountContractId: props.accountContractId,
        operatorAddress: props.operatorAddress ?? "",
        ed25519VerifierAddress: props.ed25519VerifierAddress ?? "",
        thresholdPolicyAddress: props.thresholdPolicyAddress ?? "",
        recoveryScopePolicyAddress: props.recoveryScopePolicyAddress ?? "",
        timeDelayPolicyAddress: props.timeDelayPolicyAddress ?? "",
        delayLedgers: props.delayLedgers ?? 51_840,
      }, phrasePublicKey, prepared.secondFactorPublicKey);
      await registerL4Commit(request);
      discardL4Secret(prepared.material);
      prepared.secondFactorPublicKey.fill(0);
      prepared.secondFactorSecret = "";
      setPrepared(null);
      setInstalled(true);
      setMessage("サポート復旧の設定を登録しました。復旧コードはこの端末から消去しました。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "復旧コードの登録を完了できませんでした");
    }
  };

  if (installed === true) {
    return <Card>
      <CardHeader>
        <CardTitle>サポート復旧の設定</CardTitle>
        <CardDescription>パスキーもリカバリーフレーズも使えなくなったときの最終手段が設定済みです。</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm">サポート復旧の設定は完了しています。</p>
        {message && <p role="alert" className="text-muted-foreground text-sm">{message}</p>}
      </CardContent>
    </Card>;
  }

  if (prepared && revealStep === "recoveryCode") {
    return <Card>
      <CardHeader>
        <CardTitle>復旧コードを保管してください（1/2）</CardTitle>
        <CardDescription>この表示は一度だけです。紙など、端末の外に控えてください。</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-2">
          <Label>復旧コード</Label>
          <output aria-label="一度だけ表示する復旧コード" className="bg-muted rounded-md border p-3 font-mono text-sm break-all">
            {base64Url(prepared.material.secret)}
          </output>
          <p className="text-muted-foreground text-sm">この値そのものは運営へ送信されません。運営が受け取るのは照合用のハッシュ値だけです。</p>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox id="l4-recovery-code-confirmed" checked={confirmed} onCheckedChange={(checked) => setConfirmed(checked === true)} />
          <Label htmlFor="l4-recovery-code-confirmed" className="font-normal">控えました。次に、もう1つのコードを表示します。</Label>
        </div>
        {message && <p role="alert" className="text-muted-foreground text-sm">{message}</p>}
      </CardContent>
      <CardFooter>
        <Button disabled={!confirmed} onClick={() => { setRevealStep("backupCode"); setConfirmed(false); }}>次へ</Button>
      </CardFooter>
    </Card>;
  }

  if (prepared && revealStep === "backupCode") {
    return <Card>
      <CardHeader>
        <CardTitle>予備の復旧コードを保管してください（2/2）</CardTitle>
        <CardDescription>復旧コードとは別に、もう1つ必要です。この表示も一度だけです。</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-2">
          <Label>予備の復旧コード</Label>
          <output aria-label="一度だけ表示する予備の復旧コード" className="bg-muted rounded-md border p-3 font-mono text-sm break-all">
            {prepared.secondFactorSecret}
          </output>
          <p className="text-muted-foreground text-sm">復旧コードと予備の復旧コード、両方をそろえて控えてください。</p>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox id="l4-backup-code-confirmed" checked={confirmed} onCheckedChange={(checked) => setConfirmed(checked === true)} />
          <Label htmlFor="l4-backup-code-confirmed" className="font-normal">控えました。画面を閉じると、もう表示できないことを理解しました。</Label>
        </div>
        {message && <p role="alert" className="text-muted-foreground text-sm">{message}</p>}
      </CardContent>
      <CardFooter>
        <Button disabled={!confirmed} onClick={() => void complete()}>保管を完了する</Button>
      </CardFooter>
    </Card>;
  }

  return <Card>
    <CardHeader>
      <CardTitle>サポート復旧の設定</CardTitle>
      <CardDescription>
        パスキーもリカバリーフレーズも使えなくなったときの最終手段です。復旧コードを2つ発行します。実際の復旧には運営の確認と待機期間が必要です。
      </CardDescription>
    </CardHeader>
    <CardContent className="flex flex-col gap-4">
      <Button disabled={!canIssue} onClick={() => void issue()}>復旧コードを発行する</Button>
      {!canIssue && !phrasePublicKey && <p className="text-muted-foreground text-sm">リカバリーフレーズを登録したアカウントにログインすると、設定できます。</p>}
      {message && <p role="alert" className="text-muted-foreground text-sm">{message}</p>}
    </CardContent>
  </Card>;
}
