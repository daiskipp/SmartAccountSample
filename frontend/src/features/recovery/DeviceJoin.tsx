import { useEffect, useRef, useState } from "react";
import type { SmartAccountKit } from "smart-account-kit";
import { saveDeviceNickname } from "./deviceNicknames";
import { scanPairingQrCode, type QrScanner } from "./qrPairingCode";
import { confirmNewPairing, extractInviteCode, joinPairing, pollPairingOutcome, type NewPairing } from "./pairingSession";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "";
const POLL_INTERVAL_MS = 2000;

interface DeviceJoinProps {
  kit: SmartAccountKit | null;
  /** Pre-fills the invite code when this device arrived here via a scanned join URL. */
  initialInviteCode?: string;
}

/** Public, unauthenticated join screen for a brand-new device: it has no passkey yet, so it cannot reach `/app`. */
export function DeviceJoin({ kit, initialInviteCode }: DeviceJoinProps): React.JSX.Element {
  const [inviteCode, setInviteCode] = useState(initialInviteCode ?? "");
  const [joinNickname, setJoinNickname] = useState("");
  const [scanning, setScanning] = useState(false);
  const [newPairing, setNewPairing] = useState<NewPairing | null>(null);
  const [sas, setSas] = useState<string | null>(null);
  const [newDeviceStatus, setNewDeviceStatus] = useState<"waiting" | "success" | "failure" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!scanning || !videoRef.current) return;
    const scanner: QrScanner = scanPairingQrCode(
      videoRef.current,
      (text) => { setInviteCode(extractInviteCode(text)); setScanning(false); },
      (error) => { setMessage(error.message); setScanning(false); },
    );
    return () => scanner.stop();
  }, [scanning]);

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

  const startScan = (): void => {
    setMessage(null);
    setScanning(true);
  };

  const join = async (): Promise<void> => {
    if (!kit) return;
    try {
      const credential = await kit.credentials.create({ nickname: joinNickname.trim() || "新しい端末" });
      // Only this device can label itself in its own device list; the pairing
      // partner separately learns this nickname over the encrypted channel.
      saveDeviceNickname(credential.publicKey, joinNickname.trim() || "この端末");
      const pairing = await joinPairing(apiBaseUrl, inviteCode.trim(), {
        passkey: { credentialId: credential.credentialId, publicKey: credential.publicKey },
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

  return <div className="mx-auto flex max-w-md flex-col gap-4 p-6">
    <Card>
      <CardHeader>
        <CardTitle>この端末を追加する</CardTitle>
        <CardDescription>すでにログインしている端末で発行したQRコードまたは招待コードが必要です。</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
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
        <Button disabled={!kit || !inviteCode.trim() || !!newPairing} onClick={() => void join()}>この端末を準備する</Button>
        {sas && <p aria-label="確認コード" className="text-center text-2xl font-mono tracking-widest"><output>{sas}</output></p>}
        {newDeviceStatus === "waiting" && <p className="text-muted-foreground text-sm">既存の端末での確認を待っています…</p>}
        {newDeviceStatus === "success" && <p className="text-sm">この端末を追加しました。次からこの端末でも開けます。</p>}
        {newDeviceStatus === "failure" && <p role="alert" className="text-muted-foreground text-sm">追加できませんでした。もう一度やり直してください。</p>}
        {message && <p role="alert" className="text-muted-foreground text-sm">{message}</p>}
      </CardContent>
    </Card>
  </div>;
}
