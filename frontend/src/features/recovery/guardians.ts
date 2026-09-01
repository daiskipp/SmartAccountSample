export interface GuardianPasskey {
  /** Base64url WebAuthn credential ID, as returned by kit.credentials.create(). */
  credentialId: string;
  /** 65-byte uncompressed secp256r1 public key. */
  publicKey: Uint8Array;
}

export interface GuardianEntry {
  /** Locally-chosen label; never sent on-chain. */
  nickname: string;
  passkey: GuardianPasskey;
}

export interface GuardianConfiguration {
  guardians: readonly GuardianEntry[];
  threshold: number;
}

/** Validates the off-chain input before the same values are submitted on-chain. */
export function validateGuardianConfiguration(configuration: GuardianConfiguration): void {
  const { guardians, threshold } = configuration;
  if (guardians.length < 2 || guardians.length > 5) throw new Error("ガーディアンは2人から5人で選んでください");
  if (!Number.isInteger(threshold) || threshold < 2 || threshold > guardians.length) throw new Error("必要な承認数を正しく設定してください");
  if (guardians.some((guardian) => !isGuardianPasskey(guardian.passkey))) throw new Error("ガーディアンのパスキー情報を確認してください");
  const credentialIds = guardians.map((guardian) => guardian.passkey.credentialId);
  if (new Set(credentialIds).size !== credentialIds.length) throw new Error("同じガーディアンを重ねて登録できません");
}

function isGuardianPasskey(passkey: GuardianPasskey): boolean {
  return Boolean(passkey.credentialId) && passkey.publicKey.length === 65;
}
