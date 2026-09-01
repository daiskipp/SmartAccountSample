import { useState } from "react";
import type { SmartAccountKit } from "smart-account-kit";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface PasskeyAccountSetupProps {
  kit: SmartAccountKit | null;
  canCreate: boolean;
  onCreated(contractId: string): void;
}

export function PasskeyAccountSetup({ kit, canCreate, onCreated }: PasskeyAccountSetupProps): React.JSX.Element {
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const create = async (): Promise<void> => {
    if (!kit || !canCreate || !name.trim()) return;
    setCreating(true);
    setMessage(null);
    try {
      const wallet = await kit.createWallet("Account Sample", name.trim(), {
        nickname: "メインのパスキー",
        autoSubmit: true,
      });
      if (wallet.submitResult?.success !== true) {
        const reason = wallet.submitResult?.success === false
          ? wallet.submitResult.error.message
          : "送信結果を受け取れませんでした";
        throw new Error("アカウントの作成トランザクションを完了できませんでした: " + reason);
      }
      onCreated(wallet.contractId);
      setMessage(`アカウントを作成しました。アカウントID: ${wallet.contractId}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "アカウントを作成できませんでした");
    } finally {
      setCreating(false);
    }
  };

  const connect = async (): Promise<void> => {
    if (!kit) return;
    setCreating(true);
    setMessage(null);
    try {
      const wallet = await kit.connectWallet({ fresh: true });
      if (!wallet) throw new Error("この端末で使えるアカウントが見つかりませんでした");
      onCreated(wallet.contractId);
      setMessage(`ログインしました。アカウントID: ${wallet.contractId}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "ログインできませんでした");
    } finally {
      setCreating(false);
    }
  };

  if (!kit) {
    return <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>ログイン</CardTitle>
        <CardDescription>この画面を使うには、接続先と確認用コントラクトの設定が必要です。</CardDescription>
      </CardHeader>
    </Card>;
  }

  return <Card className="w-full max-w-sm">
    <CardHeader>
      <CardTitle>アカウント</CardTitle>
      <CardDescription>この端末のパスキーで、アカウントを作成またはログインします。</CardDescription>
    </CardHeader>
    <CardContent>
      <Tabs defaultValue="login">
        <TabsList className="w-full">
          <TabsTrigger value="login">ログイン</TabsTrigger>
          <TabsTrigger value="signup">新規登録</TabsTrigger>
        </TabsList>
        <TabsContent value="login" className="flex flex-col gap-4 pt-4">
          <p className="text-muted-foreground text-sm">登録済みのパスキーでログインします。</p>
          <Button disabled={creating} onClick={() => void connect()}>
            {creating ? "ログインしています…" : "パスキーでログイン"}
          </Button>
        </TabsContent>
        <TabsContent value="signup" className="flex flex-col gap-4 pt-4">
          <div className="grid gap-2">
            <Label htmlFor="signup-name">表示名</Label>
            <Input
              id="signup-name"
              autoComplete="username"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <Button disabled={!canCreate || !name.trim() || creating} onClick={() => void create()}>
            {creating ? "アカウントを作成しています…" : "パスキーで新規登録"}
          </Button>
          {!canCreate && <p className="text-muted-foreground text-sm">新しいアカウントを作るための送信先が、まだ用意されていません。</p>}
        </TabsContent>
      </Tabs>
      {message && <p role="alert" className="text-muted-foreground mt-4 text-sm">{message}</p>}
    </CardContent>
  </Card>;
}
