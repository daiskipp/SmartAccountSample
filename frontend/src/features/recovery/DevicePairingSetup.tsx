import { useEffect, useState } from "react";
import type { SmartAccountKit } from "smart-account-kit";
import { addPairedPasskeySigner } from "../../smart-account/recoverySigners";
import { saveDeviceNickname } from "./deviceNicknames";
import { renderPairingQrCode } from "./qrPairingCode";
import {
  beginPairing,
  buildDeviceJoinUrl,
  canAddPairedPasskey,
  confirmExistingPairing,
  reportPairingOutcome,
  type ExistingPairing,
  type PairedPasskey,
} from "./pairingSession";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "";
const POLL_INTERVAL_MS = 2000;

interface DevicePairingSetupProps {
  kit: SmartAccountKit | null;
  accountContractId: string;
  webauthnVerifierAddress?: string;
  /** Skips this component's own Card chrome when a parent already provides it. */
  embedded?: boolean;
  /** Called once the existing device has finished adding the new device's signer on-chain. */
  onDeviceAdded?: () => void;
}

/** Host-side ("this device already has account access") half of L2 pairing. The join side lives at the public `/device/join` route, since a brand-new device has no passkey yet and cannot reach an authenticated screen. */
export function DevicePairingSetup({ kit, accountContractId, webauthnVerifierAddress, embedded, onDeviceAdded }: DevicePairingSetupProps): React.JSX.Element {
  const [existing, setExisting] = useState<ExistingPairing | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [sas, setSas] = useState<string | null>(null);
  const [sasConfirmed, setSasConfirmed] = useState(false);
  const [pairedPasskey, setPairedPasskey] = useState<PairedPasskey | null>(null);
  const [peerNickname, setPeerNickname] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  // Replaces a manual "check now" button: the existing device polls until the new device answers or the invite expires.
  useEffect(() => {
    if (!existing || sas) return;
    let stopped = false;
    const timer = setInterval(() => {
      if (Date.now() > existing.expiresAt * 1000) {
        clearInterval(timer);
        if (!stopped) setMessage("招待コードの期限が切れました。もう一度作り直してください。");
        return;
      }
      confirmExistingPairing(apiBaseUrl, existing)
        .then((confirmation) => {
          if (stopped) return;
          clearInterval(timer);
          setSas(confirmation.sas);
          setSasConfirmed(false);
          setPairedPasskey(confirmation.passkey ?? null);
          setPeerNickname(confirmation.nickname ?? "");
          setMessage("2つの端末に表示される6桁が同じか確認してください。");
        })
        .catch(() => { /* the new device has not answered yet */ });
    }, POLL_INTERVAL_MS);
    return () => { stopped = true; clearInterval(timer); };
  }, [existing, sas]);

  const start = async (): Promise<void> => {
    try {
      const pairing = await beginPairing(apiBaseUrl, accountContractId);
      setExisting(pairing);
      setQrDataUrl(await renderPairingQrCode(buildDeviceJoinUrl(window.location.origin, pairing.inviteCode)));
      setSas(null);
      setSasConfirmed(false);
      setMessage("QRコードを新しい端末で読み取ってください。5分以内に使えます。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "招待を始められませんでした");
    }
  };

  const addPasskey = async (): Promise<void> => {
    if (!kit || !webauthnVerifierAddress || !pairedPasskey || !existing) return;
    try {
      await addPairedPasskeySigner(kit, webauthnVerifierAddress, pairedPasskey.publicKey, pairedPasskey.credentialId);
      saveDeviceNickname(pairedPasskey.publicKey, peerNickname || "新しい端末");
      setMessage("新しい端末を追加しました。これからは、この端末でもアカウントを開けます。");
      setPairedPasskey(null);
      await reportPairingOutcome(apiBaseUrl, existing, true).catch(() => { /* the new device falls back to checking by logging in */ });
      onDeviceAdded?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "新しい端末を追加できませんでした");
      await reportPairingOutcome(apiBaseUrl, existing, false).catch(() => { /* best-effort notification */ });
    }
  };

  const body = <>
      <Button onClick={() => void start()}>QRコードを作る</Button>
      {existing && <div className="flex flex-col gap-4">
        {qrDataUrl && !sas && <div className="flex flex-col items-center gap-2">
          <img src={qrDataUrl} alt="ペアリング用QRコード" className="rounded-md border bg-white p-2" width={192} height={192} />
          <p className="text-muted-foreground text-sm">新しい端末からの応答を待っています…</p>
        </div>}
        <details className="text-muted-foreground text-sm">
          <summary className="cursor-pointer">QRを読み取れない場合はコードで渡す</summary>
          <Textarea readOnly value={existing.inviteCode} rows={4} className="mt-2 font-mono text-xs" />
        </details>
        {sas && pairedPasskey && kit && webauthnVerifierAddress && <div className="flex flex-col gap-3">
          <div className="grid gap-2">
            <Label htmlFor="peer-nickname">つながった端末の呼び名</Label>
            <Input id="peer-nickname" value={peerNickname} onChange={(event) => setPeerNickname(event.target.value)} placeholder="例：iPhone" />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="sas-confirmed" checked={sasConfirmed} onCheckedChange={(checked) => setSasConfirmed(checked === true)} />
            <Label htmlFor="sas-confirmed" className="font-normal">新しい端末にも同じ確認コードが出たことを確かめました。</Label>
          </div>
          <Button disabled={!canAddPairedPasskey(pairedPasskey, sasConfirmed)} onClick={() => void addPasskey()}>
            確認コードが一致したので、この端末を追加する
          </Button>
        </div>}
      </div>}
      {sas && <p aria-label="確認コード" className="text-center text-2xl font-mono tracking-widest"><output>{sas}</output></p>}
      {message && <p role="alert" className="text-muted-foreground text-sm">{message}</p>}
    </>;

  if (embedded) return <div className="flex flex-col gap-4">{body}</div>;

  return <Card>
    <CardHeader>
      <CardTitle>もう1台の端末をつなぐ</CardTitle>
      <CardDescription>QRコードで端末同士をつなぎ、両方の画面に出る6桁が同じか確認します。</CardDescription>
    </CardHeader>
    <CardContent className="flex flex-col gap-4">{body}</CardContent>
  </Card>;
}
