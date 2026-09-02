import type { SmartAccountKit } from "smart-account-kit";
import { RecoveryPhraseSetup } from "../recovery/RecoveryPhraseSetup";
import { DeviceManager } from "../recovery/DeviceManager";
import { GuardianRecoverySetup } from "../recovery/GuardianRecoverySetup";
import { addRecoveryPhraseSigner } from "../../smart-account/recoverySigners";
import { Button } from "@/components/ui/button";

interface DashboardProps {
  kit: SmartAccountKit | null;
  accountContractId: string | null;
  onLogout(): void;
}

export function Dashboard({ kit, accountContractId, onLogout }: DashboardProps): React.JSX.Element {
  const ed25519VerifierAddress = import.meta.env.VITE_ED25519_VERIFIER_ADDRESS;
  const thresholdPolicyAddress = import.meta.env.VITE_THRESHOLD_POLICY_ADDRESS;
  const registerRecoverySigner = kit && ed25519VerifierAddress && thresholdPolicyAddress
    ? (publicKey: Uint8Array) => addRecoveryPhraseSigner(
      kit,
      ed25519VerifierAddress,
      thresholdPolicyAddress,
      publicKey,
    )
    : undefined;

  return <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
    <header className="flex items-center justify-between gap-4 border-b pb-4">
      <div>
        <h1 className="text-lg font-semibold">アカウント設定</h1>
        <p className="text-muted-foreground font-mono text-sm">{accountContractId}</p>
      </div>
      <Button variant="outline" onClick={onLogout}>ログアウトする</Button>
    </header>
    <RecoveryPhraseSetup
      kit={kit}
      accountContractId={accountContractId}
      registerSigner={registerRecoverySigner}
    />
    <DeviceManager kit={kit} accountContractId={accountContractId} webauthnVerifierAddress={import.meta.env.VITE_WEBAUTHN_VERIFIER_ADDRESS} />
    <GuardianRecoverySetup
      kit={kit}
      accountContractId={accountContractId}
      webauthnVerifierAddress={import.meta.env.VITE_WEBAUTHN_VERIFIER_ADDRESS}
      thresholdPolicyAddress={import.meta.env.VITE_THRESHOLD_POLICY_ADDRESS}
      recoveryScopePolicyAddress={import.meta.env.VITE_RECOVERY_SCOPE_POLICY_ADDRESS}
    />
  </div>;
}
