import { Link, useNavigate } from "@tanstack/react-router";
import type { SmartAccountKit } from "smart-account-kit";
import { PasskeyAccountSetup } from "../recovery/PasskeyAccountSetup";
import { canCreateSmartAccount } from "../../smart-account/config";

interface LoginScreenProps {
  kit: SmartAccountKit | null;
  onLogin(contractId: string): void;
}

export function LoginScreen({ kit, onLogin }: LoginScreenProps): React.JSX.Element {
  const navigate = useNavigate();
  const canCreate = canCreateSmartAccount(import.meta.env);

  return <section className="flex min-h-svh flex-col items-center justify-center gap-4 p-6">
    <PasskeyAccountSetup
      kit={kit}
      canCreate={canCreate}
      onCreated={(contractId) => {
        onLogin(contractId);
        void navigate({ to: "/app" });
      }}
    />
    <p className="text-muted-foreground text-sm">
      ログインできない場合は<Link to="/recovery" className="text-primary underline underline-offset-4">こちらからアカウントを復旧</Link>できます。
    </p>
  </section>;
}
