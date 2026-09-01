import { describe, expect, it } from "vitest";
import { validateGuardianConfiguration, type GuardianEntry } from "./guardians";

const passkey = (seed: number): GuardianEntry => ({
  nickname: `ガーディアン${seed}`,
  passkey: { credentialId: `credential-${seed}`, publicKey: new Uint8Array(65).fill(seed) },
});
const first = passkey(1);
const second = passkey(2);

describe("guardian configuration", () => {
  it("accepts a 2-of-2 guardian configuration", () => {
    expect(() => validateGuardianConfiguration({ guardians: [first, second], threshold: 2 })).not.toThrow();
  });

  it("rejects invalid thresholds, duplicate guardians, and invalid passkeys", () => {
    expect(() => validateGuardianConfiguration({ guardians: [first, second], threshold: 1 })).toThrow();
    expect(() => validateGuardianConfiguration({ guardians: [first, first], threshold: 2 })).toThrow();
    expect(() => validateGuardianConfiguration({
      guardians: [{ nickname: "x", passkey: { credentialId: "", publicKey: new Uint8Array(65) } }, second],
      threshold: 2,
    })).toThrow();
    expect(() => validateGuardianConfiguration({
      guardians: [{ nickname: "x", passkey: { credentialId: "c", publicKey: new Uint8Array(32) } }, second],
      threshold: 2,
    })).toThrow();
  });

  it("rejects guardian counts outside 2-5", () => {
    expect(() => validateGuardianConfiguration({ guardians: [first], threshold: 2 })).toThrow();
    const six = [1, 2, 3, 4, 5, 6].map(passkey);
    expect(() => validateGuardianConfiguration({ guardians: six, threshold: 2 })).toThrow();
  });
});
