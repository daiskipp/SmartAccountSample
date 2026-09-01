import * as ed from "@noble/ed25519";
import { entropyToMnemonic, mnemonicToEntropy } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

const ENCODER = new TextEncoder();
const KEY_INFO = ENCODER.encode("account-sample/recovery-phrase/ed25519/v1");

export type RecoveryPhrase = readonly string[];

/** Generates a BIP-39 mnemonic (12 English words) encoding 128 bits of entropy. */
export async function generateRecoveryPhrase(random: Uint8Array = crypto.getRandomValues(new Uint8Array(16))): Promise<RecoveryPhrase> {
  if (random.length !== 16) throw new Error("recovery phrase entropy must be 128 bits");
  return entropyToMnemonic(random, wordlist).split(" ");
}

export async function deriveRecoveryPublicKey(phrase: RecoveryPhrase): Promise<Uint8Array> {
  const seed = await deriveRecoverySigningSeed(phrase);
  try {
    return await ed.getPublicKeyAsync(seed);
  } finally {
    seed.fill(0);
  }
}

/** Derives the in-memory Ed25519 seed used only while completing L1 recovery. */
export async function deriveRecoverySigningSeed(phrase: RecoveryPhrase): Promise<Uint8Array> {
  const entropy = decodeAndValidate(phrase);
  const normalized = phrase.join(" ").normalize("NFKD");
  const ikm = ENCODER.encode(normalized);
  const hkdf = await crypto.subtle.importKey("raw", asBuffer(ikm), "HKDF", false, ["deriveBits"]);
  const seed = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: asBuffer(entropy), info: asBuffer(KEY_INFO) }, hkdf, 256);
  return new Uint8Array(seed);
}

export function discardPhrase(phrase: string[]): void {
  phrase.fill("");
}

function decodeAndValidate(phrase: RecoveryPhrase): Uint8Array {
  try {
    return mnemonicToEntropy(phrase.join(" "), wordlist);
  } catch {
    throw new Error("recovery phrase checksum does not match");
  }
}

function asBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
