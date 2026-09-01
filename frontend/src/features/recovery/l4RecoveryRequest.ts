import { signRecoveryChallenge } from "../../crypto/l4Proof";
import { base64Url } from "./l4Commit";

export interface L4RecoveryTarget {
  contractId: string;
  network: string;
}

interface ChallengeResponse {
  challenge_id: string;
  challenge: string;
}

interface ProofResponse {
  request_id: string;
  state: string;
}

/** Proves S possession locally; neither request type has a field for S. */
export async function requestL4Recovery(
  secret: Uint8Array,
  target: L4RecoveryTarget,
  fetcher: typeof fetch = fetch,
): Promise<ProofResponse> {
  const challengeResponse = await fetcher("/api/l4/challenges", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contract_id: target.contractId,
    }),
  });
  if (!challengeResponse.ok) throw new Error("確認の準備を始められませんでした");
  const challenge = await challengeResponse.json() as ChallengeResponse;
  const challengeBytes = fromBase64Url(challenge.challenge);
  const proof = await signRecoveryChallenge(
    secret,
    target.contractId,
    target.network,
    challengeBytes,
  );
  const proofResponse = await fetcher("/api/l4/proofs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      challenge_id: challenge.challenge_id,
      proof_public_key: base64Url(proof.proofPublicKey),
      signature: base64Url(proof.signature),
    }),
  });
  if (!proofResponse.ok) throw new Error("秘密を確認できませんでした");
  return await proofResponse.json() as ProofResponse;
}

export function fromBase64Url(value: string): Uint8Array {
  const decoded = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}
