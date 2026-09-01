import { describe, expect, it, vi } from "vitest";
import { decodePendingRecovery, getRecoveryStatus, pendingRecoveryCopy, recoveryStatusCopy } from "./l4Status";
import { xdr } from "@stellar/stellar-sdk";

describe("public recovery status", () => {
  it("uses URL-safe route fields and soft Japanese copy", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      state: "awaiting_operator_approvals", approval_count: 1,
    }), { status: 200 }));
    const status = await getRecoveryStatus("a/b", fetcher);
    expect(fetcher).toHaveBeenCalledWith("/api/l4/status/a%2Fb");
    expect(recoveryStatusCopy(status)).not.toContain("Threshold");
    expect(recoveryStatusCopy({ state: "operator_action_submitted", approval_count: 2 })).not.toContain("Context Rule");
  });

  it("decodes public pending state and presents the approximate remaining wait", () => {
    const value = xdr.ScVal.scvMap([
      new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("valid_from_ledger"), val: xdr.ScVal.scvU32(820) }),
      new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("expires_at_ledger"), val: xdr.ScVal.scvU32(900) }),
    ]);
    expect(decodePendingRecovery(value)).toEqual({ validFromLedger: 820, expiresAtLedger: 900 });
    expect(pendingRecoveryCopy({ validFromLedger: 820, expiresAtLedger: 900, latestLedger: 100 })).toContain("約1時間");
    expect(pendingRecoveryCopy({ validFromLedger: 100, expiresAtLedger: 900, latestLedger: 100 })).toContain("終わりました");
  });
});
