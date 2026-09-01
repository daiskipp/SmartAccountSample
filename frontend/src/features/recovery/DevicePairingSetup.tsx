import { useEffect, useRef, useState } from "react";
import type { SmartAccountKit } from "smart-account-kit";
import { addPairedPasskeySigner } from "../../smart-account/recoverySigners";
import { saveDeviceNickname } from "./deviceNicknames";
import { renderPairingQrCode, scanPairingQrCode, type QrScanner } from "./qrPairingCode";
import {
  beginPairing,
  canAddPairedPasskey,
  confirmExistingPairing,
  confirmNewPairing,
  joinPairing,
  pollPairingOutcome,
  reportPairingOutcome,
  type ExistingPairing,
  type NewPairing,
  type PairedPasskey,
} from "./pairingSession";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "";
const POLL_INTERVAL_MS = 2000;

interface DevicePairingSetupProps {
  kit: SmartAccountKit | null;
  webauthnVerifierAddress?: string;
  /** Skips this component's own Card chrome when a parent already provides it. */
  embedded?: boolean;
  /** Called once the existing device has finished adding the new device's signer on-chain. */
  onDeviceAdded?: () => void;
}

export function DevicePairingSetup({ kit, webauthnVerifierAddress, embedded, onDeviceAdded }: DevicePairingSetupProps): React.JSX.Element {
  const [role, setRole] = useState<"existing" | "new">("existing");
  const [existing, setExisting] = useState<ExistingPairing | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [newPairing, setNewPairing] = useState<NewPairing | null>(null);
  const [inviteCode, setInviteCode] = useState("");
  const [joinNickname, setJoinNickname] = useState("");
  const [scanning, setScanning] = useState(false);
  const [sas, setSas] = useState<string | null>(null);
  const [sasConfirmed, setSasConfirmed] = useState(false);
  const [pairedPasskey, setPairedPasskey] = useState<PairedPasskey | null>(null);
  const [peerNickname, setPeerNickname] = useState("");
  const [newDeviceStatus, setNewDeviceStatus] = useState<"waiting" | "success" | "failure" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

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

  // The new device cannot tell on its own whether the existing device finished adding it on-chain, so it polls for that outcome.
  useEffect(() => {
    if (!newPairing || newDeviceStatus !== "waiting") return;
    let stopped = false;
    const timer = setInterval(() => {
      pollPairingOutcome(apiBaseUrl, newPairing)
        .then((outcome) => {
          if (stopped || outcome === null) return;
          clearInterval(timer);
          setNewDeviceStatus(outcome ? "success" : "failure");
        })
        .catch(() => {
          if (stopped) return;
          clearInterval(timer);
          setNewDeviceStatus("failure");
        });
    }, POLL_INTERVAL_MS);
    return () => { stopped = true; clearInterval(timer); };
  }, [newPairing, newDeviceStatus]);

  const start = async (): Promise<void> => {
    try {
      const pairing = await beginPairing(apiBaseUrl);
      setExisting(pairing);
      setQrDataUrl(await renderPairingQrCode(pairing.inviteCode));
      setSas(null);
      setSasConfirmed(false);
      setMessage("QRコードを新しい端末で読み取ってください。5分以内に使えます。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "招待を始められませんでした");
    }
  };

  const startScan = (): void => {
    setMessage(null);
    setScanning(true);
  };

  useEffect(() => {
    if (!scanning || !videoRef.current) return;
    const scanner = scanPairingQrCode(
      videoRef.current,
      (text) => { setInviteCode(text); setScanning(false); },
      (error) => { setMessage(error.message); setScanning(false); },
    );
    return () => scanner.stop();
  }, [scanning]);

  const join = async (): Promise<void> => {
    try {
      const credential = kit ? await kit.credentials.create({ nickname: joinNickname.trim() || "新しい端末" }) : undefined;
      // Only this device can label itself in its own device list; the pairing
      // partner separately learns this nickname over the encrypted channel.
      if (credential) saveDeviceNickname(credential.publicKey, joinNickname.trim() || "この端末");
      const pairing = await joinPairing(apiBaseUrl, inviteCode.trim(), {
        passkey: credential && { credentialId: credential.credentialId, publicKey: credential.publicKey },
        nickname: joinNickname,
      });
      setNewPairing(pairing);
      setSas(await confirmNewPairing(pairing));
      setNewDeviceStatus("waiting");
      setMessage("2つの端末に表示される6桁が同じか確認してください。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "招待コードを確認してください");
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
      <Tabs value={role} onValueChange={(value) => setRole(value as "existing" | "new")}>
        <TabsList className="w-full">
          <TabsTrigger value="existing">今使っている端末</TabsTrigger>
          <TabsTrigger value="new">新しい端末</TabsTrigger>
        </TabsList>
        <TabsContent value="existing" className="flex flex-col gap-4 pt-4">
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
                <Label htmlFor="peer-nickname">この端末の呼び名</Label>
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
        </TabsContent>
        <TabsContent value="new" className="flex flex-col gap-4 pt-4">
          <div className="grid gap-2">
            <Label htmlFor="join-nickname">この端末の呼び名（任意）</Label>
            <Input id="join-nickname" value={joinNickname} onChange={(event) => setJoinNickname(event.target.value)} placeholder="例：会社のMac" />
          </div>
          {scanning ? <div className="flex flex-col gap-2">
            <video ref={videoRef} className="w-full rounded-md border" muted playsInline />
            <Button variant="outline" onClick={() => setScanning(false)}>読み取りをやめる</Button>
          </div> : <Button variant="outline" onClick={startScan}>QRコードを読み取る</Button>}
          <details className="text-muted-foreground text-sm">
            <summary className="cursor-pointer">QRを読み取れない場合はコードを貼り付ける</summary>
            <Textarea aria-label="招待コード" value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} rows={4} className="mt-2 font-mono text-xs" />
          </details>
          <Button disabled={!inviteCode.trim() || !!newPairing} onClick={() => void join()}>この端末を準備する</Button>
          {newDeviceStatus === "waiting" && <p className="text-muted-foreground text-sm">既存の端末での確認を待っています…</p>}
          {newDeviceStatus === "success" && <p className="text-sm">この端末を追加しました。次からこの端末でも開けます。</p>}
          {newDeviceStatus === "failure" && <p role="alert" className="text-muted-foreground text-sm">追加できませんでした。もう一度やり直してください。</p>}
        </TabsContent>
      </Tabs>
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
