import { useEffect, useRef, useState } from "react";
import type { GuardianEntry } from "./guardians";
import type { PendingGuardian } from "./GuardianRecoverySetup";
import { renderPairingQrCode, scanPairingQrCode } from "./qrPairingCode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface FaceToFaceOffer { v: 1; accountContractId: string; ownerNickname?: string }
interface FaceToFaceResponse { v: 1; credentialId: string; publicKey: string; nickname?: string }

interface Candidate { credentialId: string; publicKey: Uint8Array }

interface GuardianFaceToFaceOwnerProps {
  accountContractId: string;
  ownerNickname?: string;
  onCandidate(pending: PendingGuardian): void;
}

/** Owner-side half of the face-to-face handoff: shows an offer QR, then scans
 * the friend's response QR. No server round trip — the in-person scan is the
 * authenticity channel, so the offer/response are plain JSON, not encrypted. */
export function GuardianFaceToFaceOwner({ accountContractId, ownerNickname, onCandidate }: GuardianFaceToFaceOwnerProps): React.JSX.Element {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [nickname, setNickname] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const offer: FaceToFaceOffer = { v: 1, accountContractId, ownerNickname };
    void renderPairingQrCode(JSON.stringify(offer)).then(setQrDataUrl);
  }, [accountContractId, ownerNickname]);

  useEffect(() => {
    if (!scanning || !videoRef.current) return;
    const scanner = scanPairingQrCode(
      videoRef.current,
      (text) => {
        setScanning(false);
        try {
          const response = JSON.parse(text) as FaceToFaceResponse;
          const publicKey = fromBase64(response.publicKey);
          if (response.v !== 1 || !response.credentialId || publicKey.length !== 65) throw new Error("invalid");
          setCandidate({ credentialId: response.credentialId, publicKey });
          setNickname(response.nickname ?? "");
          setMessage(null);
        } catch {
          setMessage("QRコードを確認してください");
        }
      },
      (error) => { setMessage(error.message); setScanning(false); },
    );
    return () => scanner.stop();
  }, [scanning]);

  const add = (): void => {
    if (!candidate || !nickname.trim()) return;
    const entry: GuardianEntry = { nickname: nickname.trim(), passkey: candidate };
    onCandidate({ entry, remoteInvite: null });
    setCandidate(null);
    setNickname("");
    setMessage("ガーディアンを追加しました。");
  };

  return <div className="flex flex-col gap-4">
    {qrDataUrl && <div className="flex flex-col items-center gap-2">
      <img src={qrDataUrl} alt="このアカウントのQRコード" className="rounded-md border bg-white p-2" width={192} height={192} />
      <p className="text-muted-foreground text-sm">このQRコードを友人の端末で読み取ってもらってください。</p>
    </div>}
    {scanning ? <div className="flex flex-col gap-2">
      <video ref={videoRef} className="w-full rounded-md border" muted playsInline />
      <Button variant="outline" onClick={() => setScanning(false)}>読み取りをやめる</Button>
    </div> : !candidate && <Button variant="outline" onClick={() => { setMessage(null); setScanning(true); }}>友人の画面のQRコードを読み取る</Button>}
    {candidate && <div className="flex flex-col gap-3">
      <div className="grid gap-2">
        <Label htmlFor="face-to-face-owner-nickname">この人の呼び名</Label>
        <Input id="face-to-face-owner-nickname" value={nickname} onChange={(event) => setNickname(event.target.value)} placeholder="例：あきら" />
      </div>
      <Button disabled={!nickname.trim()} onClick={add}>ガーディアンに追加する</Button>
    </div>}
    {message && <p role="alert" className="text-muted-foreground text-sm">{message}</p>}
  </div>;
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}
