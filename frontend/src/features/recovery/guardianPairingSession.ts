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
const OFFER_AAD = encoder.encode("account-sample/l3/offer/v1");
const RESPONSE_AAD = encoder.encode("account-sample/l3/response/v1");
const SAS_AAD = encoder.encode("account-sample/l3/sas/v1");

/** A guardian invite may sit unopened far longer than a live device-pairing QR. */
const INVITE_TTL_SECONDS = 72 * 3600;

interface GuardianOffer {
  sessionId: string;
  ownerPublicKey: string;
  accountContractId: string;
  ownerNickname?: string;
}

interface GuardianInvite { token: string; transportKey: string }

export interface OwnerGuardianInvite {
  inviteCode: string;
  keyPair: PairingKeyPair;
  sessionId: string;
  expiresAt: number;
}

export interface JoiningGuardian {
  ownerPublicKey: Uint8Array;
  accountContractId: string;
  keyPair: PairingKeyPair;
  sessionId: string;
  token: string;
}

export interface GuardianCandidate {
  credentialId: string;
  publicKey: Uint8Array;
}

export interface JoinGuardianInviteOptions {
  candidate: GuardianCandidate;
  nickname?: string;
}

export interface OwnerInviteConfirmation {
  sas: string;
  candidate: GuardianCandidate | null;
  nickname?: string;
}

/** A human must verify the SAS on both devices before the owner adds a guardian signer. */
export function canAddGuardianCandidate(candidate: GuardianCandidate | null, sasConfirmed: boolean): boolean {
  return sasConfirmed && candidate !== null;
}

export async function beginGuardianInvite(apiBaseUrl: string, accountContractId: string, ownerNickname: string | undefined, fetcher: typeof fetch = fetch): Promise<OwnerGuardianInvite> {
  const keyPair = createPairingKeyPair();
  const transportKey = crypto.getRandomValues(new Uint8Array(32));
  const sessionId = base64Url(crypto.getRandomValues(new Uint8Array(16)));
  const offer: GuardianOffer = { sessionId, ownerPublicKey: base64Url(keyPair.publicKey), accountContractId, ownerNickname };
  const payload = pack(encryptPairingPayload(transportKey, encoder.encode(JSON.stringify(offer)), OFFER_AAD));
  const session = await createPairingSession(apiBaseUrl, payload, fetcher, INVITE_TTL_SECONDS);
  return {
    keyPair,
    sessionId,
    expiresAt: session.expiresAt,
    inviteCode: base64Url(encoder.encode(JSON.stringify({ token: session.token, transportKey: base64Url(transportKey) } satisfies GuardianInvite))),
  };
}

export async function joinGuardianInvite(apiBaseUrl: string, inviteCode: string, options: JoinGuardianInviteOptions, fetcher: typeof fetch = fetch): Promise<JoiningGuardian> {
  const { candidate, nickname } = options;
  const invite = decodeInvite(inviteCode);
  const transportKey = fromBase64Url(invite.transportKey);
  const encryptedOffer = await getPairingPayload(apiBaseUrl, invite.token, fetcher);
  const offer = JSON.parse(decoder.decode(decryptPairingPayload(transportKey, unpack(encryptedOffer), OFFER_AAD))) as GuardianOffer;
  const ownerPublicKey = fromBase64Url(offer.ownerPublicKey);
  if (ownerPublicKey.length !== 32 || !offer.sessionId || !offer.accountContractId) throw new Error("招待コードを確認してください");
  if (candidate.publicKey.length !== 65 || !candidate.credentialId) throw new Error("パスキーの情報を確認してください");
  const keyPair = createPairingKeyPair();
  const response = pack(encryptPairingPayload(
    transportKey,
    encoder.encode(JSON.stringify({
      sessionId: offer.sessionId,
      guardianPublicKey: base64Url(keyPair.publicKey),
      candidate: { credentialId: candidate.credentialId, publicKey: base64Url(candidate.publicKey) },
      nickname: nickname?.trim() || undefined,
    })),
    RESPONSE_AAD,
  ));
  await relayPairingPayload(apiBaseUrl, invite.token, response, fetcher);
  return { ownerPublicKey, accountContractId: offer.accountContractId, keyPair, sessionId: offer.sessionId, token: invite.token };
}

export async function confirmJoiningGuardian(pairing: JoiningGuardian): Promise<string> {
  const sharedKey = await derivePairingKey(pairing.keyPair.secretKey, pairing.ownerPublicKey, transcript(pairing.sessionId));
  return sas(sharedKey, SAS_AAD);
}

export async function confirmOwnerInvite(apiBaseUrl: string, pairing: OwnerGuardianInvite, fetcher: typeof fetch = fetch): Promise<OwnerInviteConfirmation> {
  const invite = decodeInvite(pairing.inviteCode);
  const transportKey = fromBase64Url(invite.transportKey);
  const response = JSON.parse(decoder.decode(decryptPairingPayload(
    transportKey,
    unpack(await getRelayedPairingPayload(apiBaseUrl, invite.token, fetcher)),
    RESPONSE_AAD,
  ))) as { sessionId: string; guardianPublicKey: string; candidate?: { credentialId: string; publicKey: string }; nickname?: string };
  if (response.sessionId !== pairing.sessionId) throw new Error("招待の情報が一致しません");
  const sharedKey = await derivePairingKey(pairing.keyPair.secretKey, fromBase64Url(response.guardianPublicKey), transcript(pairing.sessionId));
  const candidate = response.candidate && { credentialId: response.candidate.credentialId, publicKey: fromBase64Url(response.candidate.publicKey) };
  if (candidate && (candidate.publicKey.length !== 65 || !candidate.credentialId)) throw new Error("ガーディアンのパスキー情報を確認してください");
  return { sas: await sas(sharedKey, SAS_AAD), candidate: candidate ?? null, nickname: response.nickname };
}

/** Lets the joining guardian stop waiting once the owner finishes (or gives up on) adding the signer on-chain. */
export async function reportGuardianOutcome(apiBaseUrl: string, pairing: OwnerGuardianInvite, success: boolean, fetcher: typeof fetch = fetch): Promise<void> {
  const invite = decodeInvite(pairing.inviteCode);
  await setPairingOutcome(apiBaseUrl, invite.token, success, fetcher);
}

export async function pollGuardianOutcome(apiBaseUrl: string, pairing: JoiningGuardian, fetcher: typeof fetch = fetch): Promise<boolean | null> {
  return getPairingOutcome(apiBaseUrl, pairing.token, fetcher);
}

function decodeInvite(value: string): GuardianInvite {
  const invite = JSON.parse(decoder.decode(fromBase64Url(value))) as GuardianInvite;
  if (!invite.token || fromBase64Url(invite.transportKey).length !== 32) throw new Error("招待コードを確認してください");
  return invite;
}

function transcript(sessionId: string): Uint8Array { return encoder.encode(`account-sample/l3/session/v1:${sessionId}`); }
function pack(payload: { nonce: Uint8Array; ciphertext: Uint8Array }): Uint8Array { const output = new Uint8Array(payload.nonce.length + payload.ciphertext.length); output.set(payload.nonce); output.set(payload.ciphertext, payload.nonce.length); return output; }
function unpack(payload: Uint8Array): { nonce: Uint8Array; ciphertext: Uint8Array } { if (payload.length < 29) throw new Error("招待コードを確認してください"); return { nonce: payload.slice(0, 12), ciphertext: payload.slice(12) }; }
function base64Url(value: Uint8Array): string { return btoa(String.fromCharCode(...value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", ""); }
function fromBase64Url(value: string): Uint8Array { const decoded = atob(value.replaceAll("-", "+").replaceAll("_", "/")); return Uint8Array.from(decoded, (character) => character.charCodeAt(0)); }
