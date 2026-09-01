import {
  createPairingKeyPair,
  decryptPairingPayload,
  derivePairingKey,
  encryptPairingPayload,
  sas,
  type PairingKeyPair,
} from "../../crypto/pairing";
import {
  createPairingSession,
  getPairingOutcome,
  getPairingPayload,
  getRelayedPairingPayload,
  relayPairingPayload,
  setPairingOutcome,
} from "./pairingRelay";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const OFFER_AAD = encoder.encode("account-sample/l2/offer/v1");
const RESPONSE_AAD = encoder.encode("account-sample/l2/response/v1");
const SAS_AAD = encoder.encode("account-sample/l2/sas/v1");

interface Offer {
  sessionId: string;
  oldPublicKey: string;
}

interface Invite {
  token: string;
  transportKey: string;
}

export interface ExistingPairing {
  inviteCode: string;
  keyPair: PairingKeyPair;
  sessionId: string;
  expiresAt: number;
}

export interface NewPairing {
  existingPublicKey: Uint8Array;
  keyPair: PairingKeyPair;
  sessionId: string;
  token: string;
}

export interface PairedPasskey {
  credentialId: string;
  publicKey: Uint8Array;
}

export interface JoinPairingOptions {
  passkey?: PairedPasskey;
  nickname?: string;
}

export interface ExistingConfirmation {
  sas: string;
  passkey?: PairedPasskey;
  nickname?: string;
}

/** A human must verify the SAS on both devices before the existing device adds a signer. */
export function canAddPairedPasskey(passkey: PairedPasskey | null, sasConfirmed: boolean): boolean {
  return sasConfirmed && passkey !== null;
}

export async function beginPairing(apiBaseUrl: string, fetcher: typeof fetch = fetch): Promise<ExistingPairing> {
  const keyPair = createPairingKeyPair();
  const transportKey = crypto.getRandomValues(new Uint8Array(32));
  const sessionId = base64Url(crypto.getRandomValues(new Uint8Array(16)));
  const offer: Offer = { sessionId, oldPublicKey: base64Url(keyPair.publicKey) };
  const payload = pack(encryptPairingPayload(transportKey, encoder.encode(JSON.stringify(offer)), OFFER_AAD));
  const session = await createPairingSession(apiBaseUrl, payload, fetcher);
  return {
    keyPair,
    sessionId,
    expiresAt: session.expiresAt,
    inviteCode: base64Url(encoder.encode(JSON.stringify({ token: session.token, transportKey: base64Url(transportKey) } satisfies Invite))),
  };
}

export async function joinPairing(apiBaseUrl: string, inviteCode: string, options: JoinPairingOptions = {}, fetcher: typeof fetch = fetch): Promise<NewPairing> {
  const { passkey, nickname } = options;
  const invite = decodeInvite(inviteCode);
  const transportKey = fromBase64Url(invite.transportKey);
  const encryptedOffer = await getPairingPayload(apiBaseUrl, invite.token, fetcher);
  const offer = JSON.parse(decoder.decode(decryptPairingPayload(transportKey, unpack(encryptedOffer), OFFER_AAD))) as Offer;
  const existingPublicKey = fromBase64Url(offer.oldPublicKey);
  if (existingPublicKey.length !== 32 || !offer.sessionId) throw new Error("ペアリングコードを確認してください");
  const keyPair = createPairingKeyPair();
  if (passkey && (passkey.publicKey.length !== 65 || !passkey.credentialId)) throw new Error("新しい端末の鍵を確認してください");
  const response = pack(encryptPairingPayload(
    transportKey,
    encoder.encode(JSON.stringify({
      sessionId: offer.sessionId,
      newPublicKey: base64Url(keyPair.publicKey),
      passkey: passkey && { credentialId: passkey.credentialId, publicKey: base64Url(passkey.publicKey) },
      nickname: nickname?.trim() || undefined,
    })),
    RESPONSE_AAD,
  ));
  await relayPairingPayload(apiBaseUrl, invite.token, response, fetcher);
  return { existingPublicKey, keyPair, sessionId: offer.sessionId, token: invite.token };
}

export async function confirmNewPairing(pairing: NewPairing): Promise<string> {
  const sharedKey = await derivePairingKey(pairing.keyPair.secretKey, pairing.existingPublicKey, transcript(pairing.sessionId));
  return sas(sharedKey, SAS_AAD);
}

export async function confirmExistingPairing(apiBaseUrl: string, pairing: ExistingPairing, fetcher: typeof fetch = fetch): Promise<ExistingConfirmation> {
  const invite = decodeInvite(pairing.inviteCode);
  const transportKey = fromBase64Url(invite.transportKey);
  const response = JSON.parse(decoder.decode(decryptPairingPayload(
    transportKey,
    unpack(await getRelayedPairingPayload(apiBaseUrl, invite.token, fetcher)),
    RESPONSE_AAD,
  ))) as { sessionId: string; newPublicKey: string; passkey?: { credentialId: string; publicKey: string }; nickname?: string };
  if (response.sessionId !== pairing.sessionId) throw new Error("ペアリング情報が一致しません");
  const sharedKey = await derivePairingKey(pairing.keyPair.secretKey, fromBase64Url(response.newPublicKey), transcript(pairing.sessionId));
  const passkey = response.passkey && { credentialId: response.passkey.credentialId, publicKey: fromBase64Url(response.passkey.publicKey) };
  if (passkey && (passkey.publicKey.length !== 65 || !passkey.credentialId)) throw new Error("新しい端末の鍵を確認してください");
  return { sas: await sas(sharedKey, SAS_AAD), passkey, nickname: response.nickname };
}

/** Lets the new device stop waiting once the existing device finishes (or gives up on) adding it on-chain. */
export async function reportPairingOutcome(apiBaseUrl: string, pairing: ExistingPairing, success: boolean, fetcher: typeof fetch = fetch): Promise<void> {
  const invite = decodeInvite(pairing.inviteCode);
  await setPairingOutcome(apiBaseUrl, invite.token, success, fetcher);
}

export async function pollPairingOutcome(apiBaseUrl: string, pairing: NewPairing, fetcher: typeof fetch = fetch): Promise<boolean | null> {
  return getPairingOutcome(apiBaseUrl, pairing.token, fetcher);
}

function decodeInvite(value: string): Invite {
  const invite = JSON.parse(decoder.decode(fromBase64Url(value))) as Invite;
  if (!invite.token || fromBase64Url(invite.transportKey).length !== 32) throw new Error("ペアリングコードを確認してください");
  return invite;
}

function transcript(sessionId: string): Uint8Array { return encoder.encode(`account-sample/l2/session/v1:${sessionId}`); }
function pack(payload: { nonce: Uint8Array; ciphertext: Uint8Array }): Uint8Array { const output = new Uint8Array(payload.nonce.length + payload.ciphertext.length); output.set(payload.nonce); output.set(payload.ciphertext, payload.nonce.length); return output; }
function unpack(payload: Uint8Array): { nonce: Uint8Array; ciphertext: Uint8Array } { if (payload.length < 29) throw new Error("ペアリング情報を確認してください"); return { nonce: payload.slice(0, 12), ciphertext: payload.slice(12) }; }
function base64Url(value: Uint8Array): string { return btoa(String.fromCharCode(...value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", ""); }
function fromBase64Url(value: string): Uint8Array { const decoded = atob(value.replaceAll("-", "+").replaceAll("_", "/")); return Uint8Array.from(decoded, (character) => character.charCodeAt(0)); }
