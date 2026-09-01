import { describe, expect, it } from "vitest";
import { createPairingKeyPair, decryptPairingPayload, derivePairingKey, encryptPairingPayload, sas } from "./pairing";

describe("encrypted device pairing", () => {
  it("derives a matching key, SAS, and authenticated ciphertext", async () => {
    const oldDevice = createPairingKeyPair(); const newDevice = createPairingKeyPair(); const transcript = new TextEncoder().encode("session:one");
    const oldKey = await derivePairingKey(oldDevice.secretKey, newDevice.publicKey, transcript);
    const newKey = await derivePairingKey(newDevice.secretKey, oldDevice.publicKey, transcript);
    expect(oldKey).toEqual(newKey); expect(await sas(oldKey, transcript)).toEqual(await sas(newKey, transcript));
    const encrypted = encryptPairingPayload(oldKey, new TextEncoder().encode("new-passkey-public-key"), transcript);
    expect(new TextDecoder().decode(decryptPairingPayload(newKey, encrypted, transcript))).toBe("new-passkey-public-key");
  });

  it("binds the SAS to the pairing transcript", async () => {
    const first = createPairingKeyPair(); const second = createPairingKeyPair(); const key = await derivePairingKey(first.secretKey, second.publicKey, new Uint8Array([1]));
    expect(await sas(key, new Uint8Array([1]))).not.toEqual(await sas(key, new Uint8Array([2])));
  });
});
