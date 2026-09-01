export interface PairingSession { token: string; expiresAt: number }

/**
 * Sends only a pre-encrypted payload to the zero-knowledge pairing relay.
 * `ttlSeconds` lets a caller request a longer-lived session than the
 * server's default (e.g. an async guardian invite that may sit unopened);
 * omitted, the server keeps today's default lifetime.
 */
export async function createPairingSession(apiBaseUrl: string, encryptedPayload: Uint8Array, fetcher: typeof fetch = fetch, ttlSeconds?: number): Promise<PairingSession> {
  const response = await fetcher(`${apiBaseUrl}/api/pairing/sessions`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ encrypted_payload: base64Url(encryptedPayload), ...(ttlSeconds === undefined ? {} : { ttl_seconds: ttlSeconds }) }),
  });
  if (!response.ok) throw new Error("ペアリングの準備に失敗しました");
  const body = await response.json() as { token: string; expires_at: number };
  return { token: body.token, expiresAt: body.expires_at };
}

/** A token is single-use on the server; replay is rejected there. */
export async function relayPairingPayload(apiBaseUrl: string, token: string, encryptedPayload: Uint8Array, fetcher: typeof fetch = fetch): Promise<void> {
  const response = await fetcher(`${apiBaseUrl}/api/pairing/sessions/${encodeURIComponent(token)}/relay`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ encrypted_payload: base64Url(encryptedPayload) }),
  });
  if (!response.ok) throw new Error("ペアリング情報を届けられませんでした");
}

/** Reads the QR-bound offer. The relay returns the opaque ciphertext unchanged. */
export async function getPairingPayload(apiBaseUrl: string, token: string, fetcher: typeof fetch = fetch): Promise<Uint8Array> {
  return getPayload(`${apiBaseUrl}/api/pairing/sessions/${encodeURIComponent(token)}`, fetcher);
}

/** Delivers the new-device ciphertext once; a second read is rejected by the relay. */
export async function getRelayedPairingPayload(apiBaseUrl: string, token: string, fetcher: typeof fetch = fetch): Promise<Uint8Array> {
  return getPayload(`${apiBaseUrl}/api/pairing/sessions/${encodeURIComponent(token)}/relay`, fetcher);
}

/** Reports whether the existing device actually added the new signer on-chain, so the new device can stop waiting. */
export async function setPairingOutcome(apiBaseUrl: string, token: string, success: boolean, fetcher: typeof fetch = fetch): Promise<void> {
  const response = await fetcher(`${apiBaseUrl}/api/pairing/sessions/${encodeURIComponent(token)}/complete`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ success }),
  });
  if (!response.ok) throw new Error("結果を伝えられませんでした");
}

/** Polls for the outcome the existing device reported; null while still pending. */
export async function getPairingOutcome(apiBaseUrl: string, token: string, fetcher: typeof fetch = fetch): Promise<boolean | null> {
  const response = await fetcher(`${apiBaseUrl}/api/pairing/sessions/${encodeURIComponent(token)}/complete`);
  if (!response.ok) throw new Error("結果を確認できませんでした");
  const body = await response.json() as { outcome: boolean | null };
  return body.outcome;
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function getPayload(url: string, fetcher: typeof fetch): Promise<Uint8Array> {
  const response = await fetcher(url);
  if (!response.ok) throw new Error("ペアリング情報を受け取れませんでした");
  const body = await response.json() as { encrypted_payload: string };
  const decoded = atob(body.encrypted_payload.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}
