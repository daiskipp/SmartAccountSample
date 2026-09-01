import * as ed from "@noble/ed25519";

const encoder = new TextEncoder();
const COMMIT_DOMAIN = encoder.encode("account-sample/l4-commit/v1");
const KEY_INFO = encoder.encode("account-sample/l4-proof/v1");
const CHALLENGE_DOMAIN = encoder.encode("account-sample/l4-challenge/v1");

export interface L4ProofMaterial {
  /** Display once and retain offline only. Never include this in an API payload. */
  secret: Uint8Array;
  proofPublicKey: Uint8Array;
  commit: Uint8Array;
}

export async function createL4ProofMaterial(contractId: string): Promise<L4ProofMaterial> {
  const secret = crypto.getRandomValues(new Uint8Array(32));
  const proofPublicKey = await deriveProofPublicKey(secret, contractId);
  return { secret, proofPublicKey, commit: await commitment(proofPublicKey, contractId) };
}

export async function deriveProofPublicKey(secret: Uint8Array, contractId: string): Promise<Uint8Array> {
  return ed.getPublicKeyAsync(await deriveProofSeed(secret, contractId));
}

export async function signRecoveryChallenge(
  secret: Uint8Array, contractId: string, network: string, challenge: Uint8Array,
): Promise<{ proofPublicKey: Uint8Array; signature: Uint8Array }> {
  if (challenge.length !== 32) throw new Error("challenge must be 32 bytes");
  const seed = await deriveProofSeed(secret, contractId);
  return { proofPublicKey: await ed.getPublicKeyAsync(seed), signature: await ed.signAsync(recoveryChallengeMessage(contractId, network, challenge), seed) };
}

export async function commitment(proofPublicKey: Uint8Array, contractId: string): Promise<Uint8Array> {
  if (proofPublicKey.length !== 32) throw new Error("proof public key must be 32 bytes");
  return new Uint8Array(await crypto.subtle.digest("SHA-256", buffer(bytes(COMMIT_DOMAIN, proofPublicKey, encoder.encode(contractId)))));
}

export function recoveryChallengeMessage(contractId: string, network: string, challenge: Uint8Array): Uint8Array {
  return bytes(CHALLENGE_DOMAIN, encoder.encode(contractId), encoder.encode(network), challenge);
}

async function deriveProofSeed(secret: Uint8Array, contractId: string): Promise<Uint8Array> {
  if (secret.length !== 32) throw new Error("L4 secret must be 256 bits");
  const hkdf = await crypto.subtle.importKey("raw", buffer(secret), "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: buffer(encoder.encode(contractId)), info: buffer(KEY_INFO) }, hkdf, 256));
}

function bytes(...parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(length); let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}
function buffer(value: Uint8Array): ArrayBuffer { return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer; }
