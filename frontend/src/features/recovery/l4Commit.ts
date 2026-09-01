import { createL4ProofMaterial, type L4ProofMaterial } from "../../crypto/l4Proof";

export interface L4CommitRequest {
  contract_id: string;
  proof_public_key: string;
  commit: string;
}

export interface L4CommitRegistration {
  registered: boolean;
}

export async function createL4CommitRequest(
  contractId: string,
): Promise<{ material: L4ProofMaterial; request: L4CommitRequest }> {
  const material = await createL4ProofMaterial(contractId);
  return { material, request: l4CommitRequest(contractId, material) };
}

export function l4CommitRequest(
  contractId: string,
  material: L4ProofMaterial,
): L4CommitRequest {
  return {
    contract_id: contractId,
    proof_public_key: base64Url(material.proofPublicKey),
    commit: base64Url(material.commit),
  };
}

/** This boundary intentionally accepts only the public commitment request. */
export async function registerL4Commit(
  request: L4CommitRequest,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const response = await fetcher("/api/l4/commit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) throw new Error("秘密の登録を完了できませんでした");
  const result = await response.json() as L4CommitRegistration;
  if (!result.registered) throw new Error("秘密の登録を完了できませんでした");
}

export function discardL4Secret(material: L4ProofMaterial): void {
  material.secret.fill(0);
}

export function base64Url(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
