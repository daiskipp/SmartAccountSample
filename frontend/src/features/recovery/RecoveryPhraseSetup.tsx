import { useEffect, useState } from "react";
import { deriveRecoveryPublicKey, discardPhrase, generateRecoveryPhrase } from "../../crypto/recoveryPhrase";
import { hasRecoveryPhraseSigner, type RuleReaderKit } from "../../smart-account/recoverySigners";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

interface RecoveryPhraseSetupProps {
  /** Used to look up whether Rule#0 already has a recovery-phrase signer. */
  kit?: RuleReaderKit | null;
  /**
   * The logged-in account, used only to re-trigger the Rule#0 lookup on
   * login/logout — the SDK's `kit` instance is created once for the app's
   * lifetime and keeps the same reference across a re-login, so `kit` alone
   * does not change when the signed-in account changes.
   */
  accountContractId?: string | null;
  /** Registers the derived public key with Rule#0 through the connected kit. */
  registerSigner?: (publicKey: Uint8Array) => Promise<void>;
  onRegistered?(publicKey: Uint8Array): void;
}

export function RecoveryPhraseSetup({ kit, accountContractId, registerSigner, onRegistered }: RecoveryPhraseSetupProps): React.JSX.Element {
  const [phrase, setPhrase] = useState<string[] | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [derivedPublicKey, setDerivedPublicKey] = useState<Uint8Array | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [registered, setRegistered] = useState<boolean | null>(null);

  useEffect(() => {
    if (!kit || !accountContractId) { setRegistered(null); return; }
    let cancelled = false;
    void hasRecoveryPhraseSigner(kit).then(
      (result) => { if (!cancelled) setRegistered(result); },
      (error) => {
        if (cancelled) return;
        setRegistered(null);
        setMessage(error instanceof Error ? error.message : "登録状況を確認できませんでした");
      },
    );
    return () => { cancelled = true; };
  }, [kit, accountContractId]);

  const issue = async (): Promise<void> => {
    const next = [...await generateRecoveryPhrase()];
    const nextPublicKey = await deriveRecoveryPublicKey(next);
    setDerivedPublicKey(nextPublicKey);
    setPublicKey(toBase64Url(nextPublicKey));
    setConfirmed(false);
    setMessage(null);
    setPhrase(next);
  };

  const complete = async (): Promise<void> => {
    if (!phrase || !confirmed) return;
    if (!registerSigner || !derivedPublicKey) {
      setMessage("アカウントにログインしてから、このリカバリーフレーズを登録してください。登録が終わるまで画面を閉じないでください。");
      return;
    }
    setSubmitting(true);
    try {
      await registerSigner(derivedPublicKey);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "リカバリーフレーズの登録を完了できませんでした");
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
    setRegistered(true);
    onRegistered?.(derivedPublicKey.slice());
    discardPhrase(phrase);
    setPhrase(null);
    setDerivedPublicKey(null);
  };

  if (!phrase) return <Card>
    <CardHeader>
      <CardTitle>リカバリーフレーズの設定</CardTitle>
      <CardDescription>端末を紛失したときにアカウントを復旧できる、専用のリカバリーフレーズを発行できます。</CardDescription>
    </CardHeader>
    <CardContent className="flex flex-col gap-3">
      {registered
        ? <p className="text-sm">リカバリーフレーズは登録済みです。</p>
        : <Button onClick={() => void issue()}>リカバリーフレーズを発行する</Button>}
      {publicKey && <p className="text-muted-foreground text-sm">リカバリーフレーズの登録が完了しました。</p>}
      {message && <p role="alert" className="text-muted-foreground text-sm">{message}</p>}
    </CardContent>
  </Card>;

  return <Card>
    <CardHeader>
      <CardTitle>リカバリーフレーズを保管してください</CardTitle>
      <CardDescription>この表示は一度だけです。紙などに、順番どおり書き留めてください。</CardDescription>
    </CardHeader>
    <CardContent className="flex flex-col gap-4">
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {phrase.map((word, index) => (
          <li key={index} className="bg-muted flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
            <span className="text-muted-foreground w-4 text-right">{index + 1}</span>
            <span className="font-mono">{word}</span>
          </li>
        ))}
      </ol>
      <div className="flex items-center gap-2">
        <Checkbox id="phrase-confirmed" checked={confirmed} onCheckedChange={(checked) => setConfirmed(checked === true)} />
        <Label htmlFor="phrase-confirmed" className="font-normal">書き留めました。この画面を閉じると、もう表示できないことを理解しました。</Label>
      </div>
      {message && <p role="alert" className="text-muted-foreground text-sm">{message}</p>}
    </CardContent>
    <CardFooter>
      <Button disabled={!confirmed || submitting} onClick={() => void complete()}>
        {submitting ? "登録しています…" : "保管を完了する"}
      </Button>
    </CardFooter>
  </Card>;
}

function toBase64Url(value: Uint8Array): string { return btoa(String.fromCharCode(...value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", ""); }
