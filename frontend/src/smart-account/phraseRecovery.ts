import { Keypair } from "@stellar/stellar-sdk";
import { deriveRecoverySigningSeed, type RecoveryPhrase } from "../crypto/recoveryPhrase";

export interface PhraseRecoveryKit {
  connectWallet(options: { contractId: string; credentialId: string }): Promise<unknown>;
  disconnect(): Promise<void>;
  externalSigners: {
    addEd25519FromSecret(secret: string): { address: string };
    remove(address: string): void;
  };
  signers: {
    addPasskey(contextRuleId: number, appName: string, userName: string, options: { nickname: string }): Promise<{
      credentialId: string;
      transaction: unknown;
    }>;
  };
  credentials: { delete(credentialId: string): Promise<void> };
  multiSigners: {
    getAvailableSigners(): Promise<unknown[]>;
    buildSelectedSigners(signers: unknown[], activeCredentialId?: string | null): unknown[];
    operation(
      transaction: unknown,
      selectedSigners: unknown[],
      options: { resolveContextRuleIds: () => number[] },
    ): Promise<{ success?: boolean; error?: unknown }>;
  };
}

/**
 * Restores L1 access by using the phrase-derived external signer to add a new
 * passkey to Rule#0. The phrase seed and Stellar secret stay in memory only.
 */
export async function recoverPasskeyFromPhrase(
  kit: PhraseRecoveryKit,
  accountContractId: string,
  phrase: RecoveryPhrase,
  name: string,
): Promise<{ connected: boolean }> {
  if (!accountContractId || !name.trim()) throw new Error("アカウント番号と新しい鍵の名前を入力してください。");
  const seed = await deriveRecoverySigningSeed(phrase);
  const keypair = Keypair.fromRawEd25519Seed(seed);
  seed.fill(0);
  const recoveryCredentialId = `phrase-recovery-${crypto.randomUUID()}`;
  const secret = keypair.secret();
  let externalAddress: string | undefined;
  let replacementCredentialId: string | undefined;
  let connectedReplacement = false;
  try {
    // The SDK needs an in-memory wallet client to construct the operation.
    // This temporary credential is never a WebAuthn credential and is removed
    // before returning; the actual authorization is the Ed25519 signer below.
    await kit.connectWallet({ contractId: accountContractId, credentialId: recoveryCredentialId });
    externalAddress = kit.externalSigners.addEd25519FromSecret(secret).address;
    const replacement = await kit.signers.addPasskey(0, "Account Sample", name.trim(), {
      nickname: "復旧した鍵",
    });
    replacementCredentialId = replacement.credentialId;
    const available = await kit.multiSigners.getAvailableSigners();
    const selected = kit.multiSigners.buildSelectedSigners(available, null);
    const result = await kit.multiSigners.operation(replacement.transaction, selected, {
      resolveContextRuleIds: () => [0],
    });
    if (result.success === false) throw new Error(result.error instanceof Error ? result.error.message : "新しい鍵を登録できませんでした");
    // The replacement passkey is already a Rule#0 signer on-chain at this point,
    // so recovery has succeeded. Reconnecting to it is a best-effort convenience
    // (auto-login); its failure must not be reported as a recovery failure.
    try {
      await kit.disconnect();
      await kit.connectWallet({ contractId: accountContractId, credentialId: replacement.credentialId });
      connectedReplacement = true;
    } catch {
      // Ignore: the user can still log in normally with the recovered passkey.
    }
  } catch (error) {
    // Best-effort cleanup only: the SDK refuses to delete a credential whose
    // contractId already exists on-chain (true here, since it's the account
    // being recovered), so this always throws and must not shadow `error`.
    if (replacementCredentialId) await kit.credentials.delete(replacementCredentialId).catch(() => {});
    throw error;
  } finally {
    if (externalAddress) kit.externalSigners.remove(externalAddress);
    if (!connectedReplacement) await kit.disconnect();
  }
  return { connected: connectedReplacement };
}
