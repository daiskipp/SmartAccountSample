import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function RecoveryEntry(): React.JSX.Element {
  return <section className="flex min-h-svh flex-col items-center justify-center gap-4 p-6">
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>アカウントを復旧する</CardTitle>
        <CardDescription>ログインに使っていたパスキーが使えなくなったときは、控えている方法を選んでください。</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-2">
          <Button asChild>
            <Link to="/recovery/phrase">リカバリーフレーズで復旧する</Link>
          </Button>
          <p className="text-muted-foreground text-sm">控えていたリカバリーフレーズを使って、この端末に新しいパスキーを登録します。</p>
        </div>
        <div className="grid gap-2">
          <Button asChild variant="outline">
            <Link to="/recovery/guardian">ガーディアンと復旧する</Link>
          </Button>
          <p className="text-muted-foreground text-sm">登録済みのガーディアンから署名を集めて、新しいパスキーを登録します。</p>
        </div>
      </CardContent>
    </Card>
  </section>;
}
