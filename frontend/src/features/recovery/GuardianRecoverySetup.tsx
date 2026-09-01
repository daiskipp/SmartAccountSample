import { useEffect, useState } from "react";
import { formatSignerForDisplay, getCredentialIdFromSigner, type ContextRule, type ContractSigner, type SmartAccountKit } from "smart-account-kit";
import {
  addGuardianSigner,
  installGuardianRecovery,
  removeGuardianSigner,
  updateGuardianThreshold,
} from "../../smart-account/guardianRecovery";
import { validateGuardianConfiguration, type GuardianEntry } from "./guardians";
import { getGuardianNickname, saveGuardianNickname } from "./guardianNicknames";
import { reportGuardianOutcome, type OwnerGuardianInvite } from "./guardianPairingSession";
import { GuardianFaceToFaceOwner } from "./GuardianFaceToFaceOwner";
import { GuardianRemoteOwner } from "./GuardianRemoteOwner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "";
const RULE_NAME = "guardian-recovery";
const MIN_GUARDIANS = 2;
const MAX_GUARDIANS = 5;

/** A guardian collected in the add view, paired with the remote invite handle
 * (if any) so the owner can report the on-chain outcome back to the friend. */
export interface PendingGuardian {
  entry: GuardianEntry;
  remoteInvite: OwnerGuardianInvite | null;
}

interface GuardianRow {
  signer: ContractSigner;
  credentialId: string;
}

interface GuardianRecoverySetupProps {
  kit: SmartAccountKit | null;
  accountContractId: string | null;
  ownerNickname?: string;
  webauthnVerifierAddress?: string;
  thresholdPolicyAddress?: string;
  recoveryScopePolicyAddress?: string;
}

export function GuardianRecoverySetup(props: GuardianRecoverySetupProps): React.JSX.Element {
  const [view, setView] = useState<"list" | "add">("list");
  const [rule, setRule] = useState<ContextRule | null>(null);
  const [threshold, setThreshold] = useState(2);
  const [thresholdInput, setThresholdInput] = useState("2");
  const [pendingGuardians, setPendingGuardians] = useState<PendingGuardian[]>([]);
  const [addThresholdInput, setAddThresholdInput] = useState("2");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = async (): Promise<void> => {
    if (!props.kit) return;
    try {
      const rules = await props.kit.rules.list();
      const found = rules.find((candidate) => candidate.name === RULE_NAME) ?? null;
      setRule(found);
      if (found && props.thresholdPolicyAddress) {
        const current = await props.kit.policyClients.threshold(props.thresholdPolicyAddress).getThreshold(found.id);
        setThreshold(current);
        setThresholdInput(String(current));
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "ガーディアンの設定を読み込めませんでした");
    }
  };

  useEffect(() => { void load(); }, [props.kit]);

  const rows: GuardianRow[] = (rule?.signers ?? [])
    .map((signer) => {
      const credentialId = getCredentialIdFromSigner(signer);
      return credentialId ? { signer, credentialId } : null;
    })
    .filter((row): row is GuardianRow => row !== null);

  const ready = Boolean(props.kit && props.accountContractId && props.webauthnVerifierAddress && props.thresholdPolicyAddress && props.recoveryScopePolicyAddress);

  const saveThreshold = async (): Promise<void> => {
    if (!props.kit || !props.thresholdPolicyAddress) return;
    const next = Number(thresholdInput);
    setSubmitting(true);
    setMessage(null);
    try {
      await updateGuardianThreshold(props.kit, props.thresholdPolicyAddress, next);
      setMessage("必要な承認数を更新しました。");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "必要な承認数を更新できませんでした");
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (row: GuardianRow): Promise<void> => {
    if (!props.kit || !props.thresholdPolicyAddress) return;
    if (rows.length <= MIN_GUARDIANS) {
      setMessage("ガーディアンは2人未満にできません。");
      setConfirmingId(null);
      return;
    }
    setSubmitting(true);
    setMessage(null);
    try {
      const remainingCount = rows.length - 1;
      if (threshold > remainingCount) {
        await updateGuardianThreshold(props.kit, props.thresholdPolicyAddress, remainingCount);
      }
      await removeGuardianSigner(props.kit, row.signer);
      setConfirmingId(null);
      await load();
      setMessage("ガーディアンを外しました。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "ガーディアンを外せませんでした");
    } finally {
      setSubmitting(false);
    }
  };

  const startRename = (row: GuardianRow): void => {
    setRenamingId(row.credentialId);
    setRenameValue(getGuardianNickname(row.credentialId) ?? "");
  };

  const saveRename = (row: GuardianRow): void => {
    const trimmed = renameValue.trim();
    if (trimmed) saveGuardianNickname(row.credentialId, trimmed);
    setRenamingId(null);
    setRenameValue("");
  };

  const addCandidate = async (pending: PendingGuardian): Promise<void> => {
    if (!props.kit || !props.webauthnVerifierAddress || !props.thresholdPolicyAddress) return;
    saveGuardianNickname(pending.entry.passkey.credentialId, pending.entry.nickname);
    if (!rule) {
      setPendingGuardians((current) => [...current, pending]);
      setMessage(null);
      return;
    }
    setSubmitting(true);
    setMessage(null);
    try {
      await addGuardianSigner(props.kit, props.webauthnVerifierAddress, props.thresholdPolicyAddress, pending.entry, threshold);
      if (pending.remoteInvite) await reportGuardianOutcome(apiBaseUrl, pending.remoteInvite, true).catch(() => { /* best-effort notification */ });
      setView("list");
      await load();
      setMessage("ガーディアンを追加しました。");
    } catch (error) {
      if (pending.remoteInvite) await reportGuardianOutcome(apiBaseUrl, pending.remoteInvite, false).catch(() => { /* best-effort notification */ });
      setMessage(error instanceof Error ? error.message : "ガーディアンを追加できませんでした");
    } finally {
      setSubmitting(false);
    }
  };

  const removePending = (credentialId: string): void => {
    setPendingGuardians((current) => current.filter((pending) => pending.entry.passkey.credentialId !== credentialId));
  };

  const installFirstTime = async (): Promise<void> => {
    if (!props.kit || !props.accountContractId || !props.webauthnVerifierAddress || !props.thresholdPolicyAddress || !props.recoveryScopePolicyAddress) return;
    const nextThreshold = Number(addThresholdInput);
    setSubmitting(true);
    setMessage(null);
    try {
      const configuration = { guardians: pendingGuardians.map((pending) => pending.entry), threshold: nextThreshold };
      validateGuardianConfiguration(configuration);
      await installGuardianRecovery(props.kit, configuration, {
        accountContractId: props.accountContractId,
        webauthnVerifierAddress: props.webauthnVerifierAddress,
        thresholdPolicyAddress: props.thresholdPolicyAddress,
        recoveryScopePolicyAddress: props.recoveryScopePolicyAddress,
      });
      await Promise.all(pendingGuardians.map((pending) =>
        pending.remoteInvite ? reportGuardianOutcome(apiBaseUrl, pending.remoteInvite, true).catch(() => { /* best-effort notification */ }) : undefined,
      ));
      setPendingGuardians([]);
      setView("list");
      await load();
      setMessage("ガーディアンの復旧設定を保存しました。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "設定を保存できませんでした");
    } finally {
      setSubmitting(false);
    }
  };

  if (view === "add") {
    return <Card>
      <CardHeader>
        <CardTitle>ガーディアンを追加する</CardTitle>
        <CardDescription>対面ですぐに追加するか、離れた友人には招待コードを送って登録してもらえます。</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Button variant="outline" size="sm" className="self-start" onClick={() => setView("list")}>← 一覧に戻る</Button>
        {props.kit && props.accountContractId && ready && <Tabs defaultValue="faceToFace">
          <TabsList className="w-full">
            <TabsTrigger value="faceToFace">対面で追加</TabsTrigger>
            <TabsTrigger value="remote">リモートで招待する</TabsTrigger>
          </TabsList>
          <TabsContent value="faceToFace" className="pt-4">
            <GuardianFaceToFaceOwner accountContractId={props.accountContractId} ownerNickname={props.ownerNickname} onCandidate={(pending) => void addCandidate(pending)} />
          </TabsContent>
          <TabsContent value="remote" className="pt-4">
            <GuardianRemoteOwner accountContractId={props.accountContractId} ownerNickname={props.ownerNickname} onCandidate={(pending) => void addCandidate(pending)} />
          </TabsContent>
        </Tabs>}
        {!rule && <div className="flex flex-col gap-3 rounded-md border p-3">
          <p className="text-sm font-medium">初めての設定：2人以上集めてから保存します</p>
          {pendingGuardians.length > 0 && <ul className="flex flex-col gap-1 text-sm">
            {pendingGuardians.map((pending) => <li key={pending.entry.passkey.credentialId} className="flex items-center justify-between gap-2">
              <span>{pending.entry.nickname}</span>
              <Button variant="outline" size="sm" onClick={() => removePending(pending.entry.passkey.credentialId)}>削除</Button>
            </li>)}
          </ul>}
          <div className="flex items-center gap-2">
            <Label htmlFor="add-threshold">必要な承認数</Label>
            <Input id="add-threshold" type="number" min={MIN_GUARDIANS} max={MAX_GUARDIANS} value={addThresholdInput} onChange={(event) => setAddThresholdInput(event.target.value)} className="w-24" />
          </div>
          <Button disabled={submitting || pendingGuardians.length < MIN_GUARDIANS} onClick={() => void installFirstTime()}>
            {submitting ? "保存しています…" : "この内容で保存する"}
          </Button>
        </div>}
        {message && <p role="alert" className="text-muted-foreground text-sm">{message}</p>}
      </CardContent>
    </Card>;
  }

  return <Card>
    <CardHeader>
      <CardTitle>ガーディアンを設定する</CardTitle>
      <CardDescription>2〜5人の信頼できる友人に、パスキーを入れ替える復旧だけを一緒に承認してもらえます。普段の操作は任せられません。</CardDescription>
    </CardHeader>
    <CardContent className="flex flex-col gap-3">
      {rows.length > 0 && <ul className="flex flex-col gap-2">
        {rows.map((row) => {
          const nickname = getGuardianNickname(row.credentialId);
          const isRenaming = renamingId === row.credentialId;
          const isConfirming = confirmingId === row.credentialId;
          return <li key={row.credentialId} className="flex flex-col gap-2 rounded-md border px-3 py-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              {isRenaming ? <div className="flex flex-1 items-center gap-2">
                <Input autoFocus aria-label="ガーディアンの呼び名" value={renameValue} onChange={(event) => setRenameValue(event.target.value)} placeholder="例：あきら" />
                <Button size="sm" onClick={() => saveRename(row)}>保存</Button>
                <Button variant="outline" size="sm" onClick={() => setRenamingId(null)}>やめる</Button>
              </div> : <>
                <span className="truncate">{nickname ?? formatSignerForDisplay(row.signer).display}</span>
                <div className="flex shrink-0 gap-2">
                  <Button variant="outline" size="sm" onClick={() => startRename(row)}>名前を変更</Button>
                  {isConfirming ? <Button variant="destructive" size="sm" disabled={submitting} onClick={() => void remove(row)}>本当に外す</Button>
                    : <Button variant="outline" size="sm" onClick={() => setConfirmingId(row.credentialId)}>外す</Button>}
                </div>
              </>}
            </div>
            {isConfirming && <p role="alert" className="text-muted-foreground text-xs">
              本当にこのガーディアンを外しますか？ <button type="button" className="underline" onClick={() => setConfirmingId(null)}>やめる</button>
            </p>}
          </li>;
        })}
      </ul>}
      {rule && <div className="flex items-center gap-2 text-sm">
        <Label htmlFor="guardian-threshold">必要な承認数</Label>
        <Input id="guardian-threshold" type="number" min={MIN_GUARDIANS} max={rows.length} value={thresholdInput} onChange={(event) => setThresholdInput(event.target.value)} className="w-24" />
        <Button size="sm" disabled={submitting || Number(thresholdInput) === threshold} onClick={() => void saveThreshold()}>保存</Button>
      </div>}
      <Button variant="outline" disabled={!ready} onClick={() => setView("add")}>＋ ガーディアンを追加する</Button>
      {!ready && <p className="text-muted-foreground text-sm">アカウントを開くと使えます。</p>}
      {message && <p role="alert" className="text-muted-foreground text-sm">{message}</p>}
    </CardContent>
  </Card>;
}
