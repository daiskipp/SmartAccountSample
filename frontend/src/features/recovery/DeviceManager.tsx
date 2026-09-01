import { useEffect, useState } from "react";
import { formatSignerForDisplay, getCredentialIdFromSigner, type ContractSigner, type SmartAccountKit } from "smart-account-kit";
import { removeDeviceSigner } from "../../smart-account/deviceSigners";
import { getDeviceNickname, saveDeviceNickname } from "./deviceNicknames";
import { DevicePairingSetup } from "./DevicePairingSetup";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface DeviceManagerProps {
  kit: SmartAccountKit | null;
  webauthnVerifierAddress?: string;
}

interface DeviceRow {
  signer: ContractSigner;
  publicKey: Uint8Array;
  credentialId: string;
}

/**
 * A passkey is identified by its credential ID; the WebAuthn key data is a
 * 65-byte secp256r1 public key followed by that credential ID, and nicknames
 * are keyed by the public key. Non-passkey Rule#0 signers (the L1
 * recovery-phrase key) are not "devices" and are excluded from this list.
 */
function toDeviceRow(signer: ContractSigner, webauthnVerifierAddress?: string): DeviceRow | null {
  if (signer.tag !== "External") return null;
  const credentialId = getCredentialIdFromSigner(signer);
  if (!credentialId) return null;
  if (webauthnVerifierAddress && signer.values[0] !== webauthnVerifierAddress) return null;
  return { signer, publicKey: new Uint8Array(signer.values[1].subarray(0, 65)), credentialId };
}

export function DeviceManager({ kit, webauthnVerifierAddress }: DeviceManagerProps): React.JSX.Element {
  const [view, setView] = useState<"list" | "add">("list");
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const load = async (): Promise<void> => {
    if (!kit) return;
    try {
      const rule = await kit.rules.get(0);
      setDevices(
        rule.result.signers
          .map((signer) => toDeviceRow(signer, webauthnVerifierAddress))
          .filter((row): row is DeviceRow => row !== null),
      );
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "端末の一覧を読み込めませんでした");
    }
  };

  useEffect(() => { void load(); }, [kit]);

  const remove = async (row: DeviceRow): Promise<void> => {
    if (!kit) return;
    try {
      await removeDeviceSigner(kit, row.signer);
      setConfirmingId(null);
      await load();
      setMessage("この端末の鍵を外しました。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "端末を外せませんでした");
    }
  };

  const startRename = (row: DeviceRow): void => {
    setRenamingId(row.credentialId);
    setRenameValue(getDeviceNickname(row.publicKey) ?? "");
  };

  const saveRename = (row: DeviceRow): void => {
    const trimmed = renameValue.trim();
    if (trimmed) saveDeviceNickname(row.publicKey, trimmed);
    setRenamingId(null);
    setRenameValue("");
  };

  if (!kit) return <Card>
    <CardHeader>
      <CardTitle>端末の管理</CardTitle>
      <CardDescription>アカウントを開くと、ここで端末を確認できます。</CardDescription>
    </CardHeader>
  </Card>;

  if (view === "add") {
    return <Card>
      <CardHeader>
        <CardTitle>もう1台の端末をつなぐ</CardTitle>
        <CardDescription>QRコードで端末同士をつなぎ、両方の画面に出る6桁が同じか確認します。</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Button variant="outline" size="sm" className="self-start" onClick={() => setView("list")}>← 一覧に戻る</Button>
        <DevicePairingSetup
          kit={kit}
          webauthnVerifierAddress={webauthnVerifierAddress}
          embedded
          onDeviceAdded={() => { setView("list"); void load(); }}
        />
      </CardContent>
    </Card>;
  }

  return <Card>
    <CardHeader>
      <CardTitle>端末の管理</CardTitle>
      <CardDescription>使わなくなった端末の鍵を外せます。最後の1つは外せません。</CardDescription>
    </CardHeader>
    <CardContent className="flex flex-col gap-3">
      {devices.length > 0 && <ul className="flex flex-col gap-2">
        {devices.map((row) => {
          const nickname = getDeviceNickname(row.publicKey);
          const isThisDevice = row.credentialId === kit.credentialId;
          const isRenaming = renamingId === row.credentialId;
          const isConfirming = confirmingId === row.credentialId;
          return <li key={row.credentialId} className="flex flex-col gap-2 rounded-md border px-3 py-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              {isRenaming ? <div className="flex flex-1 items-center gap-2">
                <Input
                  autoFocus
                  aria-label="端末の呼び名"
                  value={renameValue}
                  onChange={(event) => setRenameValue(event.target.value)}
                  placeholder="例：iPhone"
                />
                <Button size="sm" onClick={() => saveRename(row)}>保存</Button>
                <Button variant="outline" size="sm" onClick={() => setRenamingId(null)}>やめる</Button>
              </div> : <>
                <span className="truncate">
                  {nickname ?? formatSignerForDisplay(row.signer).display}
                  {isThisDevice && <span className="text-muted-foreground ml-2 text-xs">（この端末）</span>}
                </span>
                <div className="flex shrink-0 gap-2">
                  <Button variant="outline" size="sm" onClick={() => startRename(row)}>名前を変更</Button>
                  {isConfirming ? <Button variant="destructive" size="sm" onClick={() => void remove(row)}>本当に外す</Button>
                    : <Button variant="outline" size="sm" onClick={() => setConfirmingId(row.credentialId)}>この端末を外す</Button>}
                </div>
              </>}
            </div>
            {isConfirming && <p role="alert" className="text-muted-foreground text-xs">
              {isThisDevice ? "この端末を外すと、この画面でログアウトされます。よろしいですか？" : "本当にこの端末の鍵を外しますか？"}
              {" "}
              <button type="button" className="underline" onClick={() => setConfirmingId(null)}>やめる</button>
            </p>}
          </li>;
        })}
      </ul>}
      <Button variant="outline" onClick={() => setView("add")}>＋ 端末を追加する</Button>
      {message && <p role="alert" className="text-muted-foreground text-sm">{message}</p>}
    </CardContent>
  </Card>;
}
