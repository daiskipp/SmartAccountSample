import { describe, expect, it } from "vitest";
import * as ed from "@noble/ed25519";
import { commitment, deriveProofPublicKey, recoveryChallengeMessage, signRecoveryChallenge } from "./l4Proof";

describe("L4 proof material", () => {
  it("derives a contract-bound proof public key and commitment", async () => {
    const secret = new Uint8Array(32).fill(9);
    const key = await deriveProofPublicKey(secret, "contract-a");
    expect(await commitment(key, "contract-a")).not.toEqual(await commitment(key, "contract-b"));
    expect(key).not.toEqual(await deriveProofPublicKey(secret, "contract-b"));
  });

  it("signs a contract, network, and challenge-bound proof", async () => {
    const secret = new Uint8Array(32).fill(4); const challenge = new Uint8Array(32).fill(8);
    const proof = await signRecoveryChallenge(secret, "contract", "network", challenge);
    expect(proof.signature).toHaveLength(64);
    expect(await ed.verifyAsync(proof.signature, recoveryChallengeMessage("contract", "network", challenge), proof.proofPublicKey)).toBe(true);
    expect(await ed.verifyAsync(proof.signature, recoveryChallengeMessage("contract", "other-network", challenge), proof.proofPublicKey)).toBe(false);
  });
});
