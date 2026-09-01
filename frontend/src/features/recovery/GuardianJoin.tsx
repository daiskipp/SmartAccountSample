import { useEffect, useRef, useState } from "react";
import type { SmartAccountKit } from "smart-account-kit";
import {
  confirmJoiningGuardian,
  joinGuardianInvite,
  pollGuardianOutcome,
  type JoiningGuardian,
} from "./guardianPairingSession";
import { renderPairingQrCode, scanPairingQrCode } from "./qrPairingCode";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "";
const POLL_INTERVAL_MS = 2000;

interface GuardianJoinProps {
  kit: SmartAccountKit | null;
  initialInviteCode?: string;
}

/** The face-to-face handoff carries only public information (an account id, a
 * public key), so it is exchanged as plain QR-encoded JSON with no crypto —
 * the in-person camera scan is itself the authenticity channel. */
interface FaceToFaceOffer { v: 1; accountContractId: string; ownerNickname?: string }
interface FaceToFaceResponse { v: 1; credentialId: string; publicKey: string; nickname?: string }

export function GuardianJoin({ kit, initialInviteCode }: GuardianJoinProps): React.JSX.Element {
  const [mode, setMode] = useState<"faceToFace" | "remote">(initialInviteCode ? "remote" : "faceToFace");
  return <div className="mx-auto flex max-w-md flex-col gap-4 p-6">
    <Card>
      <CardHeader>
        <CardTitle>ガーディアンになる</CardTitle>
        <CardDescription>友人のアカウントの復旧を手伝います。普段の操作を代わりに行うことはできません。</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={mode} onValueChange={(value) => setMode(value as "faceToFace" | "remote")}>
          <TabsList className="w-full">
            <TabsTrigger value="faceToFace">対面で登録</TabsTrigger>
            <TabsTrigger value="remote">招待コードで登録</TabsTrigger>
          </TabsList>
          <TabsContent value="faceToFace" className="pt-4">
            <FaceToFaceJoin kit={kit} />
          </TabsContent>
          <TabsContent value="remote" className="pt-4">
            <RemoteJoin kit={kit} initialInviteCode={initialInviteCode} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  </div>;
}

function FaceToFaceJoin({ kit }: { kit: SmartAccountKit | null }): React.JSX.Element {
  const [offer, setOffer] = useState<FaceToFaceOffer | null>(null);
  const [pasted, setPasted] = useState("");
  const [scanning, setScanning] = useState(false);
  const [nickname, setNickname] = useState("");
  const [responseQr, setResponseQr] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!scanning || !videoRef.current) return;
    const scanner = scanPairingQrCode(
      videoRef.current,
      (text) => { setScanning(false); decodeOffer(text); },
      (error) => { setMessage(error.message); setScanning(false); },
    );
    return () => scanner.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanning]);

  const decodeOffer = (text: string): void => {
    try {
      const parsed = JSON.parse(text) as FaceToFaceOffer;
      if (parsed.v !== 1 || !parsed.accountContractId) throw new Error("invalid");
      setOffer(parsed);
      setMessage(null);
    } catch {
      setMessage("QRコードを確認してください");
    }
  };

  const create = async (): Promise<void> => {
    if (!kit || !offer) return;
    setMessage(null);
    try {
      const credential = await kit.credentials.create({ nickname: nickname.trim() || "ガーディアン", appName: "Account Sample recovery" });
      await kit.credentials.save({
        credentialId: credential.credentialId,
        publicKey: credential.publicKey,
        contractId: offer.accountContractId,
        isPrimary: false,
        nickname: nickname.trim() || "ガーディアン",
      });
      const response: FaceToFaceResponse = {
        v: 1,
        credentialId: credential.credentialId,
        publicKey: toBase64(credential.publicKey),
        nickname: nickname.trim() || undefined,
      };
      setResponseQr(await renderPairingQrCode(JSON.stringify(response)));
      setMessage("この画面のQRコードを、本人の端末で読み取ってもらってください。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "パスキーを作れませんでした");
    }
  };

  if (responseQr) return <div className="flex flex-col items-center gap-3">
    <img src={responseQr} alt="登録用QRコード" className="rounded-md border bg-white p-2" width={192} height={192} />
    <p className="text-muted-foreground text-center text-sm">{message}</p>
  </div>;

  if (offer) return <div className="flex flex-col gap-3">
    <p className="text-muted-foreground text-sm">
      {offer.ownerNickname ? `${offer.ownerNickname}さんのガーディアンになります。` : "このアカウントのガーディアンになります。"}
    </p>
    <div className="grid gap-2">
      <Label htmlFor="face-to-face-join-nickname">あなたの呼び名</Label>
      <Input id="face-to-face-join-nickname" value={nickname} onChange={(event) => setNickname(event.target.value)} placeholder="例：あきら" />
    </div>
    <Button disabled={!kit} onClick={() => void create()}>パスキーを作ってガーディアンになる</Button>
    {message && <p role="alert" className="text-muted-foreground text-sm">{message}</p>}
  </div>;

  return <div className="flex flex-col gap-4">
    {scanning ? <div className="flex flex-col gap-2">
      <video ref={videoRef} className="w-full rounded-md border" muted playsInline />
      <Button variant="outline" onClick={() => setScanning(false)}>読み取りをやめる</Button>
    </div> : <Button variant="outline" onClick={() => { setMessage(null); setScanning(true); }}>本人の画面のQRコードを読み取る</Button>}
    <details className="text-muted-foreground text-sm">
      <summary className="cursor-pointer">QRを読み取れない場合はコードを貼り付ける</summary>
      <Textarea aria-label="QRコードの内容" value={pasted} onChange={(event) => setPasted(event.target.value)} rows={4} className="mt-2 font-mono text-xs" />
      <Button variant="outline" size="sm" className="mt-2" onClick={() => decodeOffer(pasted)}>読み込む</Button>
    </details>
    {message && <p role="alert" className="text-muted-foreground text-sm">{message}</p>}
  </div>;
}

function RemoteJoin({ kit, initialInviteCode }: { kit: SmartAccountKit | null; initialInviteCode?: string }): React.JSX.Element {
  const [inviteCode, setInviteCode] = useState(initialInviteCode ?? "");
  const [nickname, setNickname] = useState("");
  const [pairing, setPairing] = useState<JoiningGuardian | null>(null);
  const [sas, setSas] = useState<string | null>(null);
  const [status, setStatus] = useState<"waiting" | "success" | "failure" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!pairing || status !== "waiting") return;
    let stopped = false;
    const timer = setInterval(() => {
      pollGuardianOutcome(apiBaseUrl, pairing)
        .then((outcome) => {
          if (stopped || outcome === null) return;
          clearInterval(timer);
          setStatus(outcome ? "success" : "failure");
        })
        .catch(() => {
          if (stopped) return;
          clearInterval(timer);
          setStatus("failure");
        });
    }, POLL_INTERVAL_MS);
    return () => { stopped = true; clearInterval(timer); };
  }, [pairing, status]);

  const join = async (): Promise<void> => {
    if (!kit) return;
    setMessage(null);
    try {
      const credential = await kit.credentials.create({ nickname: nickname.trim() || "ガーディアン", appName: "Account Sample recovery" });
      const joined = await joinGuardianInvite(apiBaseUrl, inviteCode.trim(), {
        candidate: { credentialId: credential.credentialId, publicKey: credential.publicKey },
        nickname: nickname.trim(),
      });
      await kit.credentials.save({
        credentialId: credential.credentialId,
        publicKey: credential.publicKey,
        contractId: joined.accountContractId,
        isPrimary: false,
        nickname: nickname.trim() || "ガーディアン",
      });
      setPairing(joined);
      setSas(await confirmJoiningGuardian(joined));
      setStatus("waiting");
      setMessage("2つの画面に表示される6桁が同じか確認してください。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "招待コードを確認してください");
    }
  };

  return <div className="flex flex-col gap-4">
    <div className="grid gap-2">
      <Label htmlFor="remote-join-nickname">あなたの呼び名</Label>
      <Input id="remote-join-nickname" value={nickname} onChange={(event) => setNickname(event.target.value)} placeholder="例：あきら" />
    </div>
    <div className="grid gap-2">
      <Label htmlFor="remote-join-code">招待コード</Label>
      <Textarea id="remote-join-code" value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} rows={4} className="font-mono text-xs" />
    </div>
    <Button disabled={!kit || !inviteCode.trim() || !!pairing} onClick={() => void join()}>パスキーを作ってガーディアンになる</Button>
    {sas && <p aria-label="確認コード" className="text-center text-2xl font-mono tracking-widest"><output>{sas}</output></p>}
    {status === "waiting" && <p className="text-muted-foreground text-sm">本人の確認を待っています…</p>}
    {status === "success" && <p className="text-sm">ガーディアンとして登録されました。</p>}
    {status === "failure" && <p role="alert" className="text-muted-foreground text-sm">登録できませんでした。もう一度やり直してください。</p>}
    {message && <p role="alert" className="text-muted-foreground text-sm">{message}</p>}
  </div>;
}

function toBase64(value: Uint8Array): string { return btoa(String.fromCharCode(...value)); }
