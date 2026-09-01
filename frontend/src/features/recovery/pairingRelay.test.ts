import { describe, expect, it, vi } from "vitest";
import {
  createPairingSession,
  getPairingOutcome,
  getPairingPayload,
  getRelayedPairingPayload,
  relayPairingPayload,
  setPairingOutcome,
} from "./pairingRelay";

describe("pairing relay client", () => {
  it("sends only base64url ciphertext when creating and relaying", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: "once", expires_at: 123 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ accepted: true }), { status: 200 }));
    const session = await createPairingSession("https://api.example", new Uint8Array([255, 0]), fetcher);
    await relayPairingPayload("https://api.example", session.token, new Uint8Array([1]), fetcher);
    expect(fetcher).toHaveBeenNthCalledWith(1, "https://api.example/api/pairing/sessions", expect.objectContaining({ body: '{"encrypted_payload":"_wA"}' }));
    expect(fetcher).toHaveBeenNthCalledWith(2, "https://api.example/api/pairing/sessions/once/relay", expect.objectContaining({ body: '{"encrypted_payload":"AQ"}' }));
  });

  it("forwards ttl_seconds only when the caller supplies one", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: "t", expires_at: 1 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: "t", expires_at: 1 }), { status: 200 }));
    await createPairingSession("https://api.example", new Uint8Array([1]), fetcher, 259200);
    expect(fetcher).toHaveBeenCalledWith("https://api.example/api/pairing/sessions", expect.objectContaining({ body: '{"encrypted_payload":"AQ","ttl_seconds":259200}' }));

    await createPairingSession("https://api.example", new Uint8Array([1]), fetcher);
    expect(fetcher).toHaveBeenLastCalledWith("https://api.example/api/pairing/sessions", expect.objectContaining({ body: '{"encrypted_payload":"AQ"}' }));
  });

  it("fails closed when the relay rejects a request", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("", { status: 410 }));
    await expect(relayPairingPayload("https://api.example", "expired", new Uint8Array([1]), fetcher)).rejects.toThrow();
  });

  it("returns opaque payloads and leaves one-time delivery to the relay", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ encrypted_payload: "_wA" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ encrypted_payload: "AQ" }), { status: 200 }));

    await expect(getPairingPayload("https://api.example", "once", fetcher)).resolves.toEqual(new Uint8Array([255, 0]));
    await expect(getRelayedPairingPayload("https://api.example", "once", fetcher)).resolves.toEqual(new Uint8Array([1]));
    expect(fetcher).toHaveBeenNthCalledWith(1, "https://api.example/api/pairing/sessions/once");
    expect(fetcher).toHaveBeenNthCalledWith(2, "https://api.example/api/pairing/sessions/once/relay");
  });

  it("lets the new device poll for the outcome the existing device reports", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ accepted: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ outcome: true }), { status: 200 }));
    await setPairingOutcome("https://api.example", "once", true, fetcher);
    await expect(getPairingOutcome("https://api.example", "once", fetcher)).resolves.toBe(true);
    expect(fetcher).toHaveBeenNthCalledWith(1, "https://api.example/api/pairing/sessions/once/complete", expect.objectContaining({ body: '{"success":true}' }));
    expect(fetcher).toHaveBeenNthCalledWith(2, "https://api.example/api/pairing/sessions/once/complete");
  });
});
