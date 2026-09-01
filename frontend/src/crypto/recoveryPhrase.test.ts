import { describe, expect, it } from "vitest";
import { deriveRecoveryPublicKey, generateRecoveryPhrase } from "./recoveryPhrase";

describe("recovery phrase", () => {
  it("encodes 128 bits of entropy as a 12-word BIP-39 mnemonic with a checksum", async () => {
    const phrase = await generateRecoveryPhrase(new Uint8Array(16).fill(7));
    expect(phrase).toHaveLength(12);
    await expect(deriveRecoveryPublicKey(phrase)).resolves.toHaveLength(32);
  });

  it("derives the same key for the same phrase and rejects a changed word", async () => {
    const phrase = await generateRecoveryPhrase(new Uint8Array(16).fill(3));
    await expect(deriveRecoveryPublicKey(phrase)).resolves.toEqual(await deriveRecoveryPublicKey(phrase));
    const changed = [...phrase];
    changed[1] = changed[1] === "abandon" ? "ability" : "abandon";
    await expect(deriveRecoveryPublicKey(changed)).rejects.toThrow("checksum");
  });
});
