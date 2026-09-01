import { describe, expect, it, vi } from "vitest";
import { addPairedPasskeySigner, addRecoveryPhraseSigner, getRecoveryPhrasePublicKey, hasRecoveryPhraseSigner } from "./recoverySigners";

const verifier = "CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526";
const webauthnVerifier = "CBBQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526";

describe("recovery signer registration", () => {
  it("adds the public key to Rule#0 while retaining the existing signer", async () => {
    const threshold = {};
    const transaction = {};
    const signAndSubmit = vi.fn().mockResolvedValue({ success: true });
    const addPolicy = vi.fn().mockResolvedValue(threshold);
    const convertPolicyParams = vi.fn().mockReturnValue({});
    const addBatch = vi.fn().mockResolvedValue(transaction);
    await addRecoveryPhraseSigner(
      { signers: { addBatch }, policies: { add: addPolicy }, convertPolicyParams, signAndSubmit },
      verifier,
      verifier,
      new Uint8Array(32),
    );
    expect(addPolicy).toHaveBeenCalledWith(0, verifier, expect.anything());
    expect(addBatch).toHaveBeenCalledWith(0, expect.any(Array), { existingSignerCount: 1 });
    expect(signAndSubmit).toHaveBeenNthCalledWith(1, threshold);
    expect(signAndSubmit).toHaveBeenNthCalledWith(2, transaction);
  });

  it("rejects a missing verifier or invalid key before submitting", async () => {
    const addBatch = vi.fn();
    const signAndSubmit = vi.fn();
    const kit = { signers: { addBatch }, policies: { add: vi.fn() }, convertPolicyParams: vi.fn(), signAndSubmit };
    await expect(addRecoveryPhraseSigner(kit, "invalid", verifier, new Uint8Array(32))).rejects.toThrow();
    await expect(addRecoveryPhraseSigner(kit, verifier, "invalid", new Uint8Array(32))).rejects.toThrow();
    await expect(addRecoveryPhraseSigner(kit, verifier, verifier, new Uint8Array(31))).rejects.toThrow();
    expect(addBatch).not.toHaveBeenCalled();
    expect(signAndSubmit).not.toHaveBeenCalled();
  });

  it("adds a paired passkey with the current Rule#0 signer count", async () => {
    const transaction = {};
    const addBatch = vi.fn().mockResolvedValue(transaction);
    const signAndSubmit = vi.fn().mockResolvedValue({ success: true, hash: "abc" });
    const get = vi.fn().mockResolvedValue({ result: { signers: [{}, {}] } });
    await addPairedPasskeySigner(
      { signers: { addBatch }, signAndSubmit, rules: { get } },
      verifier,
      new Uint8Array(65),
      "credential",
    );
    expect(addBatch).toHaveBeenCalledWith(0, expect.any(Array), { existingSignerCount: 2 });
    expect(signAndSubmit).toHaveBeenCalledWith(transaction);
  });

  it("throws when signAndSubmit resolves with a failure instead of rejecting", async () => {
    const addPolicy = vi.fn().mockResolvedValue({});
    const signAndSubmit = vi.fn().mockResolvedValue({ success: false, error: { message: "simulation failed" } });
    await expect(addRecoveryPhraseSigner(
      { signers: { addBatch: vi.fn() }, policies: { add: addPolicy }, convertPolicyParams: vi.fn(), signAndSubmit },
      verifier,
      verifier,
      new Uint8Array(32),
    )).rejects.toThrow("simulation failed");

    const get = vi.fn().mockResolvedValue({ result: { signers: [{}] } });
    await expect(addPairedPasskeySigner(
      { signers: { addBatch: vi.fn().mockResolvedValue({}) }, signAndSubmit, rules: { get } },
      verifier,
      new Uint8Array(65),
      "credential",
    )).rejects.toThrow("simulation failed");
  });
});

describe("hasRecoveryPhraseSigner", () => {
  it("is true when Rule#0 has an Ed25519 (32-byte) external signer", async () => {
    const get = vi.fn().mockResolvedValue({
      result: { signers: [{ tag: "External", values: [verifier, new Uint8Array(32)] }] },
    });
    await expect(hasRecoveryPhraseSigner({ rules: { get } })).resolves.toBe(true);
  });

  it("is false when Rule#0 only has passkey/Stellar-account signers", async () => {
    const get = vi.fn().mockResolvedValue({
      result: {
        signers: [
          { tag: "External", values: [webauthnVerifier, new Uint8Array(65 + 16)] },
          { tag: "Delegated", values: ["GABCXYZ"] },
        ],
      },
    });
    await expect(hasRecoveryPhraseSigner({ rules: { get } })).resolves.toBe(false);
  });
});

describe("getRecoveryPhrasePublicKey", () => {
  it("returns the 32-byte key of Rule#0's Ed25519 signer", async () => {
    const key = new Uint8Array(32).fill(7);
    const get = vi.fn().mockResolvedValue({
      result: { signers: [{ tag: "External", values: [verifier, key] }] },
    });
    await expect(getRecoveryPhrasePublicKey({ rules: { get } })).resolves.toEqual(key);
  });

  it("returns null when Rule#0 has no Ed25519 signer", async () => {
    const get = vi.fn().mockResolvedValue({
      result: {
        signers: [
          { tag: "External", values: [webauthnVerifier, new Uint8Array(65 + 16)] },
          { tag: "Delegated", values: ["GABCXYZ"] },
        ],
      },
    });
    await expect(getRecoveryPhrasePublicKey({ rules: { get } })).resolves.toBeNull();
  });
});
