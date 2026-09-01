import { describe, expect, it, vi } from "vitest";
import { beginPairing, joinPairing } from "./pairingSession";
import {
  beginGuardianInvite,
  canAddGuardianCandidate,
  confirmJoiningGuardian,
  confirmOwnerInvite,
  joinGuardianInvite,
} from "./guardianPairingSession";

function fakeRelay(): { fetcher: typeof fetch; initialPayload: () => string; relayedPayload: () => string } {
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
  }) as unknown as typeof fetch;
  return { fetcher, initialPayload: () => initialPayload, relayedPayload: () => relayedPayload };
}

describe("guardian pairing session", () => {
  it("does not permit adding a guardian before the owner confirms the matching SAS", () => {
    const candidate = { credentialId: "credential", publicKey: new Uint8Array(65) };
    expect(canAddGuardianCandidate(candidate, false)).toBe(false);
    expect(canAddGuardianCandidate(null, true)).toBe(false);
    expect(canAddGuardianCandidate(candidate, true)).toBe(true);
  });

  it("keeps the owner's account contract id and the guardian's passkey encrypted while both derive one SAS", async () => {
    const relay = fakeRelay();
    const owner = await beginGuardianInvite("https://api.example", "CACCOUNT", "本人", relay.fetcher);
    const candidate = { credentialId: "credential", publicKey: new Uint8Array(65).fill(7) };
    const guardian = await joinGuardianInvite("https://api.example", owner.inviteCode, { candidate, nickname: "あきら" }, relay.fetcher);

    expect(guardian.accountContractId).toBe("CACCOUNT");
    await expect(confirmOwnerInvite("https://api.example", owner, relay.fetcher)).resolves.toEqual({
      sas: await confirmJoiningGuardian(guardian), candidate, nickname: "あきら",
    });
    expect(relay.initialPayload()).not.toContain("CACCOUNT");
    expect(relay.initialPayload()).not.toContain("sessionId");
    expect(relay.relayedPayload()).not.toContain("guardianPublicKey");
    expect(relay.relayedPayload()).not.toContain("credential");
    expect(relay.relayedPayload()).not.toContain("あきら");
  });

  it("rejects an invite whose offer decrypts under the L2 device-pairing protocol instead of L3", async () => {
    const relay = fakeRelay();
    // An L2 device-pairing invite, decoded as if it were an L3 guardian invite:
    // the AAD domain differs, so decryption must fail rather than silently
    // succeed with garbage fields.
    const l2Existing = await beginPairing("https://api.example", relay.fetcher);
    await expect(joinGuardianInvite("https://api.example", l2Existing.inviteCode, {
      candidate: { credentialId: "c", publicKey: new Uint8Array(65) },
    }, relay.fetcher)).rejects.toThrow();
  });

  it("rejects an L2 join against an L3 guardian invite", async () => {
    const relay = fakeRelay();
    const owner = await beginGuardianInvite("https://api.example", "CACCOUNT", undefined, relay.fetcher);
    await expect(joinPairing("https://api.example", owner.inviteCode, {}, relay.fetcher)).rejects.toThrow();
  });
});
