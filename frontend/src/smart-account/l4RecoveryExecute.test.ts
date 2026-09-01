import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { describe, expect, it, vi } from "vitest";
import { generateRecoveryPhrase } from "../crypto/recoveryPhrase";
import {
  cancelL4Recovery,
  cancelConfiguredL4Recovery,
  finalizeL4Recovery,
  initiateL4Recovery,
  type L4RecoveryCancellationKit,
  type L4RecoveryInitiationKit,
} from "./l4RecoveryExecute";

const contract = (value: number): string => StrKey.encodeContract(new Uint8Array(32).fill(value));

describe("L4 recovery initiation", () => {
  it("uses the initiation-only context rule for a two-signer delay proposal", async () => {
    const execute = vi.fn().mockResolvedValue("initiation-tx");
    const operation = vi.fn().mockResolvedValue({});
    const kit: L4RecoveryInitiationKit = {
      execute,
      multiSigners: { buildSelectedSigners: vi.fn().mockReturnValue(["operator", "owner"]), operation },
    };
    await initiateL4Recovery(kit, {
      accountContractId: contract(1), timeDelayPolicyAddress: contract(2), initiationRuleId: 8,
      finalizationRuleId: 7, operatorAddress: Keypair.random().publicKey(), signers: [] as never[],
      proposalHash: new Uint8Array(32), expiresAtLedger: 100,
    });
    expect(execute).toHaveBeenCalledWith(contract(2), "initiate_recovery", expect.any(Array));
    expect(operation).toHaveBeenCalledWith("initiation-tx", ["operator", "owner"], {
      resolveContextRuleIds: expect.any(Function),
    });
    expect(operation.mock.calls[0][2].resolveContextRuleIds()).toEqual([8]);
  });

  it("refuses an under-signed or malformed initiation request", async () => {
    const kit: L4RecoveryInitiationKit = {
      execute: vi.fn(), multiSigners: { buildSelectedSigners: vi.fn().mockReturnValue(["one"]), operation: vi.fn() },
    };
    const request = {
      accountContractId: contract(1), timeDelayPolicyAddress: contract(2), initiationRuleId: 8,
      finalizationRuleId: 7, operatorAddress: Keypair.random().publicKey(), signers: [] as never[],
      proposalHash: new Uint8Array(32), expiresAtLedger: 100,
    };
    await expect(initiateL4Recovery(kit, request)).rejects.toThrow("2人分");
    await expect(initiateL4Recovery(kit, { ...request, proposalHash: new Uint8Array(31) })).rejects.toThrow("復旧内容");
  });

  it("uses the connected default-rule credential to cancel a pending recovery", async () => {
    const execute = vi.fn().mockResolvedValue("cancel-tx");
    const signAndSubmit = vi.fn().mockResolvedValue({});
    const kit: L4RecoveryCancellationKit = { execute, signAndSubmit };
    await cancelL4Recovery(kit, contract(1), contract(2), 7);
    expect(execute).toHaveBeenCalledWith(contract(2), "cancel_recovery", expect.any(Array));
    expect(signAndSubmit).toHaveBeenCalledWith("cancel-tx");
    await expect(cancelL4Recovery(kit, contract(1), contract(2), 0)).rejects.toThrow("設定");
  });

  it("finds the final recovery rule before cancelling with the connected wallet", async () => {
    const execute = vi.fn().mockResolvedValue("cancel-tx");
    const signAndSubmit = vi.fn().mockResolvedValue({});
    const rules = { list: vi.fn().mockResolvedValue([{ id: 3, name: "other" }, { id: 7, name: "operator-recovery-finalize" }]) };
    await cancelConfiguredL4Recovery({ execute, signAndSubmit, rules }, contract(1), contract(2));
    expect(execute).toHaveBeenCalledWith(contract(2), "cancel_recovery", expect.any(Array));
    expect(signAndSubmit).toHaveBeenCalledWith("cancel-tx");
    await expect(cancelConfiguredL4Recovery(
      { execute, signAndSubmit, rules: { list: vi.fn().mockResolvedValue([]) } },
      contract(1),
      contract(2),
    )).rejects.toThrow("見つかりません");
  });

  it("uses the two user-held L4 signers to add a replacement passkey after the delay", async () => {
    const externalSigners = {
      addEd25519FromSecret: vi.fn()
        .mockReturnValueOnce({ address: "GPHRASE" })
        .mockReturnValueOnce({ address: "GSECOND" }),
      remove: vi.fn(),
    };
    const operation = vi.fn().mockResolvedValue({ success: true });
    const kit = {
      connectWallet: vi.fn(), disconnect: vi.fn(), externalSigners,
      credentials: { delete: vi.fn() },
      rules: {
        list: vi.fn().mockResolvedValue([{ id: 7, name: "operator-recovery-finalize" }]),
        get: vi.fn().mockResolvedValue({ result: { signers: [{}, {}, {}] } }),
      },
      signers: { addPasskey: vi.fn().mockResolvedValue({ credentialId: "new-credential", transaction: "final-tx" }) },
      multiSigners: { buildSelectedSigners: vi.fn().mockReturnValue([{}, {}]), operation },
    };
    const phrase = await generateRecoveryPhrase(new Uint8Array(16).fill(6));
    await finalizeL4Recovery(kit, contract(1), phrase, Keypair.random().secret(), "新しい鍵");
    expect(externalSigners.addEd25519FromSecret).toHaveBeenCalledTimes(2);
    expect(operation).toHaveBeenCalledWith("final-tx", [{}, {}], {
      resolveContextRuleIds: expect.any(Function),
    });
    expect(operation.mock.calls[0][2].resolveContextRuleIds()).toEqual([7]);
    expect(externalSigners.remove).toHaveBeenCalledWith("GPHRASE");
    expect(externalSigners.remove).toHaveBeenCalledWith("GSECOND");
    expect(kit.connectWallet).toHaveBeenLastCalledWith({ contractId: contract(1), credentialId: "new-credential" });
    expect(kit.disconnect).toHaveBeenCalledTimes(1);
  });
});
