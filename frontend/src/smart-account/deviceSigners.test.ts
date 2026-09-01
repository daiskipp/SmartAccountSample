import { describe, expect, it, vi } from "vitest";
import { ensureCanRemoveSigner, removeDeviceSigner } from "./deviceSigners";

describe("device signer management", () => {
  it("prevents removal of the final signer", () => {
    expect(() => ensureCanRemoveSigner(1)).toThrow("最後のパスキー");
  });

  it("submits removal only when another signer remains", async () => {
    const signer = { tag: "Delegated", values: "G".repeat(56) } as never;
    const transaction = {};
    const remove = vi.fn().mockResolvedValue(transaction);
    const signAndSubmit = vi.fn().mockResolvedValue({ success: true, hash: "abc" });
    await removeDeviceSigner({
      rules: { get: vi.fn().mockResolvedValue({ result: { signers: [signer, signer] } }) },
      signers: { remove }, signAndSubmit,
    }, signer);
    expect(remove).toHaveBeenCalledWith(0, signer);
    expect(signAndSubmit).toHaveBeenCalledWith(transaction);
  });

  it("throws when signAndSubmit resolves with a failure instead of rejecting", async () => {
    const signer = { tag: "Delegated", values: "G".repeat(56) } as never;
    const signAndSubmit = vi.fn().mockResolvedValue({ success: false, error: { message: "simulation failed" } });
    await expect(removeDeviceSigner({
      rules: { get: vi.fn().mockResolvedValue({ result: { signers: [signer, signer] } }) },
      signers: { remove: vi.fn().mockResolvedValue({}) }, signAndSubmit,
    }, signer)).rejects.toThrow("simulation failed");
  });
});
