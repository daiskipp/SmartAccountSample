import { describe, expect, it, vi } from "vitest";
import { generateRecoveryPhrase } from "../crypto/recoveryPhrase";
import { recoverPasskeyFromPhrase, type PhraseRecoveryKit } from "./phraseRecovery";

function kit(result: { success?: boolean; error?: unknown } = { success: true }): PhraseRecoveryKit {
  return {
    connectWallet: vi.fn().mockResolvedValue({}),
    disconnect: vi.fn().mockResolvedValue(undefined),
    externalSigners: {
      addEd25519FromSecret: vi.fn().mockReturnValue({ address: "GRECOVERY" }),
      remove: vi.fn(),
    },
    signers: {
      addPasskey: vi.fn().mockResolvedValue({ credentialId: "new-credential", transaction: {} }),
    },
    credentials: { delete: vi.fn().mockResolvedValue(undefined) },
    multiSigners: {
      getAvailableSigners: vi.fn().mockResolvedValue([{}]),
      buildSelectedSigners: vi.fn().mockReturnValue([{}]),
      operation: vi.fn().mockResolvedValue(result),
    },
  };
}

describe("phrase passkey recovery", () => {
  it("uses the in-memory phrase signer to add and connect a replacement passkey", async () => {
    const recoveryKit = kit();
    const phrase = await generateRecoveryPhrase(new Uint8Array(16).fill(4));
    await recoverPasskeyFromPhrase(recoveryKit, "CACCOUNT", phrase, "新しい鍵");
    expect(recoveryKit.externalSigners.addEd25519FromSecret).toHaveBeenCalledOnce();
    expect(recoveryKit.signers.addPasskey).toHaveBeenCalledWith(0, "Account Sample", "新しい鍵", { nickname: "復旧した鍵" });
    expect(recoveryKit.multiSigners.operation).toHaveBeenCalledWith({}, [{}], expect.objectContaining({ resolveContextRuleIds: expect.any(Function) }));
    expect(recoveryKit.connectWallet).toHaveBeenLastCalledWith({ contractId: "CACCOUNT", credentialId: "new-credential" });
    expect(recoveryKit.disconnect).toHaveBeenCalledTimes(1);
    expect(recoveryKit.externalSigners.remove).toHaveBeenCalledWith("GRECOVERY");
  });

  it("removes a newly-created credential when phrase authorization fails", async () => {
    const recoveryKit = kit({ success: false });
    const phrase = await generateRecoveryPhrase(new Uint8Array(16).fill(5));
    await expect(recoverPasskeyFromPhrase(recoveryKit, "CACCOUNT", phrase, "新しい鍵")).rejects.toThrow();
    expect(recoveryKit.credentials.delete).toHaveBeenCalledWith("new-credential");
    expect(recoveryKit.externalSigners.remove).toHaveBeenCalledWith("GRECOVERY");
  });

  it("resolves as connected: false when the post-success reconnect fails", async () => {
    const recoveryKit = kit();
    recoveryKit.connectWallet = vi.fn()
      .mockResolvedValueOnce({}) // initial connect with the throwaway recovery credential
      .mockRejectedValueOnce(new Error(
        "Smart account contract not found on-chain for credential new-credential. The wallet may not have been deployed yet.",
      ));
    const phrase = await generateRecoveryPhrase(new Uint8Array(16).fill(7));
    await expect(recoverPasskeyFromPhrase(recoveryKit, "CACCOUNT", phrase, "新しい鍵"))
      .resolves.toEqual({ connected: false });
    expect(recoveryKit.credentials.delete).not.toHaveBeenCalled();
  });

  it("surfaces the original failure even when cleanup delete rejects", async () => {
    const recoveryKit = kit({ success: false, error: new Error("十分な署名が集まりませんでした") });
    recoveryKit.credentials.delete = vi.fn().mockRejectedValue(
      new Error("Cannot delete a deployed credential. The wallet exists on-chain."),
    );
    const phrase = await generateRecoveryPhrase(new Uint8Array(16).fill(6));
    await expect(recoverPasskeyFromPhrase(recoveryKit, "CACCOUNT", phrase, "新しい鍵"))
      .rejects.toThrow("十分な署名が集まりませんでした");
  });
});
