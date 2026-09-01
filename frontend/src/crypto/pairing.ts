import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { x25519 } from "@noble/curves/ed25519.js";

const encoder = new TextEncoder();
const INFO = encoder.encode("account-sample/pairing/v1");

export interface PairingKeyPair { secretKey: Uint8Array; publicKey: Uint8Array }
export interface EncryptedPairingPayload { nonce: Uint8Array; ciphertext: Uint8Array }

export function createPairingKeyPair(): PairingKeyPair {
  const secretKey = x25519.utils.randomSecretKey();
  return { secretKey, publicKey: x25519.getPublicKey(secretKey) };
}

export async function derivePairingKey(secretKey: Uint8Array, peerPublicKey: Uint8Array, transcript: Uint8Array): Promise<Uint8Array> {
  if (secretKey.length !== 32 || peerPublicKey.length !== 32) throw new Error("X25519 keys must be 32 bytes");
  const shared = x25519.getSharedSecret(secretKey, peerPublicKey);
  const key = await hkdf(shared, transcript);
  shared.fill(0);
  return key;
}

/** A decimal 6-digit code both devices compare after binding the transcript. */
export async function sas(sharedKey: Uint8Array, transcript: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", buffer(join(encoder.encode("sas"), sharedKey, transcript))));
  const value = new DataView(digest.buffer).getUint32(0) % 1_000_000;
  return value.toString().padStart(6, "0");
}

export function encryptPairingPayload(key: Uint8Array, plaintext: Uint8Array, transcript: Uint8Array): EncryptedPairingPayload {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  return { nonce, ciphertext: chacha20poly1305(key, nonce, transcript).encrypt(plaintext) };
}

export function decryptPairingPayload(key: Uint8Array, payload: EncryptedPairingPayload, transcript: Uint8Array): Uint8Array {
  return chacha20poly1305(key, payload.nonce, transcript).decrypt(payload.ciphertext);
}

async function hkdf(ikm: Uint8Array, salt: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", buffer(ikm), "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: buffer(salt), info: buffer(INFO) }, key, 256));
}
function join(...parts: Uint8Array[]): Uint8Array { const result = new Uint8Array(parts.reduce((n, part) => n + part.length, 0)); let offset = 0; for (const part of parts) { result.set(part, offset); offset += part.length; } return result; }
function buffer(value: Uint8Array): ArrayBuffer { return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer; }
