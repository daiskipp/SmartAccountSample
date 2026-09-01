import { describe, expect, it, vi } from "vitest";
import {
  base64Url,
  createL4CommitRequest,
  discardL4Secret,
  registerL4Commit,
} from "./l4Commit";

describe("L4 commitment registration", () => {
  it("creates a request that contains no L4 secret", async () => {
    const { material, request } = await createL4CommitRequest("contract");

    expect(request).toEqual(expect.objectContaining({
      contract_id: "contract",
    }));
    expect(Object.keys(request)).not.toContain("secret");
    expect(JSON.stringify(request)).not.toContain(base64Url(material.secret));
    expect(request.commit).toHaveLength(43);
    discardL4Secret(material);
    expect(material.secret).toEqual(new Uint8Array(32));
  });

  it("posts only the commitment request", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ registered: true }) });
    const request = {
      contract_id: "contract",
      proof_public_key: "public-key", commit: "commit",
    };

    await registerL4Commit(request, fetcher);

    expect(fetcher).toHaveBeenCalledWith("/api/l4/commit", expect.objectContaining({
      method: "POST", body: JSON.stringify(request),
    }));
  });
});
