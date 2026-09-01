import { useState } from "react";
import type { SmartAccountKit } from "smart-account-kit";
import { recoverPasskeyFromPhrase } from "../../smart-account/phraseRecovery";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function PhraseRecovery({ kit }: { kit: SmartAccountKit | null }): React.JSX.Element {
  const [account, setAccount] = useState("");
  const [phrase, setPhrase] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [recovering, setRecovering] = useState(false);

  const recover = async (): Promise<void> => {
    if (!kit) return;
    setRecovering(true);
    try {
      const { connected } = await recoverPasskeyFromPhrase(kit, account, phrase.normalize("NFKD").trim().split(/\s+/), name);
      setPhrase("");
      setMessage(connected
        ? "新しいパスキーを登録しました。このままアカウントを使えます。"
        : "新しいパスキーを登録しました。もう一度ログインし直してください。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "リカバリーフレーズでの復旧を完了できませんでした");
    } finally {
      setRecovering(false);
    }
  };

  return <section className="flex min-h-svh flex-col items-center justify-center gap-4 p-6">
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>リカバリーフレーズで復旧する</CardTitle>
        <CardDescription>
          控えていたリカバリーフレーズを使って、この端末に新しいパスキーを登録します。リカバリーフレーズそのものは送信されません。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-2">
          <Label htmlFor="phrase-recovery-account">アカウントID</Label>
          <Input id="phrase-recovery-account" value={account} onChange={(event) => setAccount(event.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="phrase-recovery-name">新しいパスキーの名前</Label>
          <Input id="phrase-recovery-name" value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="phrase-recovery-phrase">リカバリーフレーズ</Label>
          <Textarea id="phrase-recovery-phrase" value={phrase} onChange={(event) => setPhrase(event.target.value)} autoComplete="off" />
        </div>
        {!kit && <p className="text-muted-foreground text-sm">接続先の設定を確認してください。</p>}
        {message && <p role="alert" className="text-muted-foreground text-sm">{message}</p>}
      </CardContent>
      <CardFooter>
        <Button disabled={!kit || !account || !name || !phrase || recovering} onClick={() => void recover()}>
          {recovering ? "パスキーを登録しています…" : "新しいパスキーを登録する"}
        </Button>
      </CardFooter>
    </Card>
  </section>;
}
