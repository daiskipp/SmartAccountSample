import { describe, expect, it, vi } from "vitest";
import { buildDeviceJoinUrl, canAddPairedPasskey, confirmExistingPairing, confirmNewPairing, beginPairing, extractInviteCode, joinPairing } from "./pairingSession";

describe("pairing session", () => {
  it("does not permit signer addition before the user confirms the matching SAS", () => {
    const passkey = { credentialId: "credential", publicKey: new Uint8Array(65) };
    expect(canAddPairedPasskey(passkey, false)).toBe(false);
    expect(canAddPairedPasskey(null, true)).toBe(false);
    expect(canAddPairedPasskey(passkey, true)).toBe(true);
  });

  it("keeps ECDH public-key exchange encrypted while both devices derive one SAS", async () => {
    let initialPayload = "";
    let relayedPayload = "";
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/pairing/sessions")) {
        initialPayload = JSON.parse(String(init?.body)).encrypted_payload;
        return new Response(JSON.stringify({ token: "once", expires_at: 1 }), { status: 200 });
      }
      if (url.endsWith("/once") && !url.endsWith("/relay")) return new Response(JSON.stringify({ encrypted_payload: initialPayload }), { status: 200 });
      if (init?.method === "POST") {
        relayedPayload = JSON.parse(String(init.body)).encrypted_payload;
        return new Response(JSON.stringify({ accepted: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ encrypted_payload: relayedPayload }), { status: 200 });
    });

    const existing = await beginPairing("https://api.example", fetcher);
    const passkey = { credentialId: "credential", publicKey: new Uint8Array(65).fill(7) };
    const newcomer = await joinPairing("https://api.example", existing.inviteCode, { passkey, nickname: "iPhone" }, fetcher);

    await expect(confirmExistingPairing("https://api.example", existing, fetcher)).resolves.toEqual({
      sas: await confirmNewPairing(newcomer), passkey, nickname: "iPhone",
    });
    expect(initialPayload).not.toContain("sessionId");
    expect(relayedPayload).not.toContain("newPublicKey");
    expect(relayedPayload).not.toContain("credential");
    expect(relayedPayload).not.toContain("iPhone");
  });

  it("builds a join URL a phone's camera can open directly, and extracts the invite code back out of it", () => {
    const url = buildDeviceJoinUrl("https://example.com", "abc123");
    expect(url).toBe("https://example.com/device/join?invite=abc123");
    expect(extractInviteCode(url)).toBe("abc123");
  });

  it("falls back to treating scanned text as a bare invite code when it is not a URL", () => {
    expect(extractInviteCode("abc123")).toBe("abc123");
  });
});
