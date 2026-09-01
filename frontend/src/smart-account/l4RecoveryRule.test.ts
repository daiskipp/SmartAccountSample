import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { describe, expect, it, vi } from "vitest";
import { installL4RecoveryRule, timeDelayParams, type L4RecoveryRuleKit } from "./l4RecoveryRule";

const contract = (value: number): string => StrKey.encodeContract(new Uint8Array(32).fill(value));
const publicKey = (value: number): Uint8Array => Keypair.fromRawEd25519Seed(new Uint8Array(32).fill(value)).rawPublicKey();

describe("L4 recovery rule", () => {
  it("installs the fixed 2-of-3 operator rule with delay and scope policies", async () => {
    const add = vi.fn().mockResolvedValue("tx");
    const kit: L4RecoveryRuleKit = {
      rules: { add, list: vi.fn().mockResolvedValue([{ id: 9, name: "operator-recovery-finalize" }]) }, signAndSubmit: vi.fn().mockResolvedValue({}),
      convertPolicyParams: vi.fn().mockReturnValue("threshold"),
    };
    const operator = Keypair.fromRawEd25519Seed(new Uint8Array(32).fill(9)).publicKey();
    await installL4RecoveryRule(kit, {
      accountContractId: contract(1), operatorAddress: operator, ed25519VerifierAddress: contract(2),
      thresholdPolicyAddress: contract(3), recoveryScopePolicyAddress: contract(4),
      timeDelayPolicyAddress: contract(5), delayLedgers: 100,
    }, publicKey(6), publicKey(7));
    expect(add).toHaveBeenCalledTimes(3);
    const [, name, signers, policies] = add.mock.calls[0] as [unknown, string, unknown[], Map<string, unknown>];
    expect(name).toBe("operator-recovery-finalize");
    expect(signers).toHaveLength(3);
    expect(policies).toHaveLength(3);
    const [, initiationName, initiationSigners, initiationPolicies] = add.mock.calls[1] as [unknown, string, unknown[], Map<string, unknown>];
    expect(initiationName).toBe("operator-recovery-initiate");
    expect(initiationSigners).toHaveLength(3);
    expect(initiationPolicies).toHaveLength(2);
    const [, selfRecoveryName, selfRecoverySigners, selfRecoveryPolicies] = add.mock.calls[2] as [unknown, string, unknown[], Map<string, unknown>];
    expect(selfRecoveryName).toBe("operator-recovery-self");
    expect(selfRecoverySigners).toHaveLength(2);
    expect(selfRecoveryPolicies).toHaveLength(2);
  });

  it("rejects reuse of the phrase-derived public key as the second factor", async () => {
    const kit = { rules: { add: vi.fn(), list: vi.fn() }, signAndSubmit: vi.fn(), convertPolicyParams: vi.fn() } as L4RecoveryRuleKit;
    await expect(installL4RecoveryRule(kit, {
      accountContractId: contract(1), operatorAddress: Keypair.random().publicKey(), ed25519VerifierAddress: contract(2),
      thresholdPolicyAddress: contract(3), recoveryScopePolicyAddress: contract(4), timeDelayPolicyAddress: contract(5), delayLedgers: 1,
    }, publicKey(6), publicKey(6))).rejects.toThrow("別にしてください");
  });

  it("encodes the configured delay installation parameters", () => {
    const values = timeDelayParams(Keypair.random().publicKey(), 72).map();
    expect(values).toHaveLength(2);
  });
});
