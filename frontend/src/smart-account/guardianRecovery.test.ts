import { describe, expect, it, vi } from "vitest";
import { StrKey } from "@stellar/stellar-sdk";
import type { ContextRule, ContractSigner } from "smart-account-kit";
import type { GuardianEntry } from "../features/recovery/guardians";
import {
  addGuardianSigner,
  addReplacementPasskeyWithGuardians,
  installGuardianRecovery,
  recoveryScopeParams,
  removeGuardianSigner,
  updateGuardianThreshold,
  type GuardianRecoveryExecutionKit,
  type GuardianRecoveryKit,
  type GuardianRecoveryMutationKit,
} from "./guardianRecovery";

const address = (prefix: number, isContract = false): string => {
  const raw = new Uint8Array(32).fill(prefix);
  return isContract ? StrKey.encodeContract(raw) : StrKey.encodeEd25519PublicKey(raw);
};
const webauthnVerifierAddress = address(9, true);
const thresholdPolicyAddress = address(4, true);

const guardian = (seed: number): GuardianEntry => ({
  nickname: `ガーディアン${seed}`,
  passkey: { credentialId: `credential-${seed}`, publicKey: new Uint8Array(65).fill(seed) },
});
const first = guardian(1);
const second = guardian(2);

const rule = (signerCount: number): ContextRule => ({
  id: 1,
  name: "guardian-recovery",
  context_type: { tag: "Default", values: undefined } as unknown as ContextRule["context_type"],
  signers: Array.from({ length: signerCount }, () => ({ tag: "External", values: [webauthnVerifierAddress, new Uint8Array(0)] } as unknown as ContractSigner)),
  signer_ids: [],
  policies: [],
  policy_ids: [],
  valid_until: undefined,
});

describe("guardian recovery rule", () => {
  it("installs threshold and Rule#0-only scope policies before submitting", async () => {
    const add = vi.fn().mockResolvedValue("tx");
    const signAndSubmit = vi.fn().mockResolvedValue({});
    const kit: GuardianRecoveryKit = {
      rules: { add }, signAndSubmit,
      convertPolicyParams: vi.fn().mockReturnValue("threshold-params"),
    };
    await installGuardianRecovery(kit, { guardians: [first, second], threshold: 2 }, {
      accountContractId: address(3, true),
      webauthnVerifierAddress,
      thresholdPolicyAddress,
      recoveryScopePolicyAddress: address(5, true),
    });
    expect(add).toHaveBeenCalledOnce();
    const [, name, signers, policies] = add.mock.calls[0] as [unknown, string, ContractSigner[], Map<string, unknown>];
    expect(name).toBe("guardian-recovery");
    expect(signers).toHaveLength(2);
    expect(signers.every((signer) => signer.tag === "External")).toBe(true);
    expect(policies.size).toBe(2);
    expect(signAndSubmit).toHaveBeenCalledWith("tx");
  });

  it("encodes the scope policy parameter for Rule#0", () => {
    const entries = recoveryScopeParams(address(3, true)).map();
    const entry = entries?.[0];
    expect(entry?.key().sym().toString()).toBe("target_rule_id");
    expect(entry?.val().u32()).toBe(0);
    expect(entries).toHaveLength(4);
    expect(entries?.[1]?.key().sym().toString()).toBe("allowed_contract");
  });

  it("adds a guardian signer and re-asserts the threshold on the refreshed rule", async () => {
    const list = vi.fn().mockResolvedValueOnce([rule(2)]).mockResolvedValueOnce([rule(3)]);
    const addBatch = vi.fn().mockResolvedValue("add-tx");
    const setThreshold = vi.fn().mockResolvedValue("threshold-tx");
    const signAndSubmit = vi.fn().mockResolvedValue({});
    const kit: GuardianRecoveryMutationKit = {
      rules: { list },
      signers: { addBatch, remove: vi.fn() },
      policyClients: { threshold: vi.fn().mockReturnValue({ setThreshold }) },
      signAndSubmit,
    };
    await addGuardianSigner(kit, webauthnVerifierAddress, thresholdPolicyAddress, guardian(3), 2);
    expect(addBatch).toHaveBeenCalledWith(1, expect.any(Array), { existingSignerCount: 2 });
    expect(setThreshold).toHaveBeenCalledWith(2, expect.objectContaining({ signers: expect.arrayContaining([expect.anything()]) }));
    expect(signAndSubmit).toHaveBeenCalledTimes(2);
  });

  it("removes a guardian signer without touching the threshold", async () => {
    const list = vi.fn().mockResolvedValue([rule(3)]);
    const remove = vi.fn().mockResolvedValue("remove-tx");
    const signAndSubmit = vi.fn().mockResolvedValue({});
    const kit: GuardianRecoveryMutationKit = {
      rules: { list },
      signers: { addBatch: vi.fn(), remove },
      policyClients: { threshold: vi.fn() },
      signAndSubmit,
    };
    const signer = rule(3).signers[0]!;
    await removeGuardianSigner(kit, signer);
    expect(remove).toHaveBeenCalledWith(1, signer);
    expect(signAndSubmit).toHaveBeenCalledWith("remove-tx");
  });

  it("rejects a threshold update that would exceed the current signer count", async () => {
    const list = vi.fn().mockResolvedValue([rule(2)]);
    const kit: GuardianRecoveryMutationKit = {
      rules: { list },
      signers: { addBatch: vi.fn(), remove: vi.fn() },
      policyClients: { threshold: vi.fn() },
      signAndSubmit: vi.fn(),
    };
    await expect(updateGuardianThreshold(kit, thresholdPolicyAddress, 3)).rejects.toThrow("必要な承認数");
  });

  it("uses the multi-signer path to add a replacement Rule#0 passkey", async () => {
    const operation = vi.fn().mockResolvedValue({});
    const kit: GuardianRecoveryExecutionKit = {
      signers: { addPasskey: vi.fn().mockResolvedValue({ transaction: "replacement-tx" }) },
      multiSigners: {
        buildSelectedSigners: vi.fn().mockReturnValue(["guardian-one", "guardian-two"]),
        operation,
      },
    };
    await expect(addReplacementPasskeyWithGuardians(kit, [] as never[], "新しい端末")).resolves.toBe(2);
    expect(operation).toHaveBeenCalledWith("replacement-tx", ["guardian-one", "guardian-two"]);
  });

  it("does not construct a recovery transaction without a locally available guardian", async () => {
    const kit: GuardianRecoveryExecutionKit = {
      signers: { addPasskey: vi.fn() },
      multiSigners: { buildSelectedSigners: vi.fn().mockReturnValue([]), operation: vi.fn() },
    };
    await expect(addReplacementPasskeyWithGuardians(kit, [] as never[], "新しい端末")).rejects.toThrow("署名できる");
  });
});
