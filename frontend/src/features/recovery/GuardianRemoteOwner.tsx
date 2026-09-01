import { useEffect, useState } from "react";
import type { GuardianEntry } from "./guardians";
import type { PendingGuardian } from "./GuardianRecoverySetup";
import {
  beginGuardianInvite,
  canAddGuardianCandidate,
  confirmOwnerInvite,
  type GuardianCandidate,
  type OwnerGuardianInvite,
} from "./guardianPairingSession";
import { renderPairingQrCode } from "./qrPairingCode";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "";
const POLL_INTERVAL_MS = 2000;

interface GuardianRemoteOwnerProps {
  accountContractId: string;
  ownerNickname?: string;
  onCandidate(pending: PendingGuardian): void;
}

/** Owner-side half of the remote invite: creates an ECDH+SAS session relayed
 * through the server (same primitives as L2 device pairing), auto-polls for
 * the friend's response, and requires an SAS match before the candidate can
 * be added — protects against a compromised relay swapping in another key. */
export function GuardianRemoteOwner({ accountContractId, ownerNickname, onCandidate }: GuardianRemoteOwnerProps): React.JSX.Element {
  const [invite, setInvite] = useState<OwnerGuardianInvite | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [sas, setSas] = useState<string | null>(null);
  const [sasConfirmed, setSasConfirmed] = useState(false);
  const [candidate, setCandidate] = useState<GuardianCandidate | null>(null);
  const [nickname, setNickname] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!invite || sas) return;
    let stopped = false;
    const timer = setInterval(() => {
      if (Date.now() > invite.expiresAt * 1000) {
        clearInterval(timer);
        if (!stopped) setMessage("招待の期限が切れました。もう一度作り直してください。");
        return;
      }
      confirmOwnerInvite(apiBaseUrl, invite)
        .then((confirmation) => {
          if (stopped) return;
          clearInterval(timer);
          setSas(confirmation.sas);
          setSasConfirmed(false);
          setCandidate(confirmation.candidate);
          setNickname(confirmation.nickname ?? "");
          setMessage("2つの画面に表示される6桁が同じか確認してください。");
        })
        .catch(() => { /* the friend has not answered yet */ });
    }, POLL_INTERVAL_MS);
    return () => { stopped = true; clearInterval(timer); };
  }, [invite, sas]);

  const start = async (): Promise<void> => {
    setMessage(null);
    try {
      const created = await beginGuardianInvite(apiBaseUrl, accountContractId, ownerNickname);
      setInvite(created);
      setQrDataUrl(await renderPairingQrCode(created.inviteCode));
      setSas(null);
      setSasConfirmed(false);
      setMessage("招待コードを友人に送ってください。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "招待を作れませんでした");
    }
  };

  const add = (): void => {
    if (!invite || !candidate || !nickname.trim() || !canAddGuardianCandidate(candidate, sasConfirmed)) return;
    const entry: GuardianEntry = { nickname: nickname.trim(), passkey: candidate };
    onCandidate({ entry, remoteInvite: invite });
    setInvite(null);
    setQrDataUrl(null);
    setSas(null);
    setCandidate(null);
    setNickname("");
    setMessage("ガーディアンを追加しました。オンチェーンへの反映後に結果が友人へ伝わります。");
  };

  return <div className="flex flex-col gap-4">
    <Button onClick={() => void start()}>招待コードを作る</Button>
    {invite && <div className="flex flex-col gap-4">
      {qrDataUrl && !sas && <div className="flex flex-col items-center gap-2">
        <img src={qrDataUrl} alt="招待用QRコード" className="rounded-md border bg-white p-2" width={192} height={192} />
        <p className="text-muted-foreground text-sm">友人からの応答を待っています…</p>
      </div>}
      <details className="text-muted-foreground text-sm">
        <summary className="cursor-pointer">QRを渡せない場合はコードで渡す</summary>
        <Textarea readOnly value={invite.inviteCode} rows={4} className="mt-2 font-mono text-xs" />
      </details>
      {sas && candidate && <div className="flex flex-col gap-3">
        <div className="grid gap-2">
          <Label htmlFor="remote-owner-nickname">この人の呼び名</Label>
          <Input id="remote-owner-nickname" value={nickname} onChange={(event) => setNickname(event.target.value)} placeholder="例：あきら" />
        </div>
        <div className="flex items-center gap-2">
          <Checkbox id="remote-owner-sas-confirmed" checked={sasConfirmed} onCheckedChange={(checked) => setSasConfirmed(checked === true)} />
          <Label htmlFor="remote-owner-sas-confirmed" className="font-normal">友人の画面にも同じ確認コードが出たことを確かめました。</Label>
        </div>
        <Button disabled={!canAddGuardianCandidate(candidate, sasConfirmed) || !nickname.trim()} onClick={add}>
          確認コードが一致したので、ガーディアンに追加する
        </Button>
      </div>}
    </div>}
    {sas && <p aria-label="確認コード" className="text-center text-2xl font-mono tracking-widest"><output>{sas}</output></p>}
    {message && <p role="alert" className="text-muted-foreground text-sm">{message}</p>}
  </div>;
}
