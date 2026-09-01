import { describe, expect, it, vi } from "vitest";
import { base64Url } from "./l4Commit";
import { requestL4Recovery } from "./l4RecoveryRequest";

describe("L4 recovery request", () => {
  it("uses S only for a local signature", async () => {
    const secret = new Uint8Array(32).fill(7);
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({
        challenge_id: "challenge", challenge: base64Url(new Uint8Array(32).fill(3)),
      }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({
        request_id: "request", state: "awaiting_operator_approvals",
      }) });

    await expect(requestL4Recovery(secret, {
      contractId: "contract", network: "network",
    }, fetcher)).resolves.toEqual({ request_id: "request", state: "awaiting_operator_approvals" });

    const requestBodies = fetcher.mock.calls.map(([, init]) => String(init.body));
    expect(requestBodies.join()).not.toContain(base64Url(secret));
    expect(JSON.parse(requestBodies[0])).toEqual({
      contract_id: "contract",
    });
    expect(JSON.parse(requestBodies[1])).toEqual(expect.objectContaining({
      challenge_id: "challenge",
      proof_public_key: expect.any(String),
      signature: expect.any(String),
    }));
  });
});
