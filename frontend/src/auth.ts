import { useMemo, useState } from "react";
import { flushSync } from "react-dom";

export interface AuthState {
  contractId: string | null;
  login(contractId: string): void;
  logout(): void;
}

export function useAuth(): AuthState {
  const [contractId, setContractId] = useState<string | null>(null);
  return useMemo(() => ({
    contractId,
    // flushSync forces the router's context to re-sync (RouterProvider
    // re-renders synchronously) before callers navigate right afterwards —
    // otherwise the beforeLoad auth guard on /app can still see the stale
    // (logged-out) context and bounce back to /login.
    login: (id) => flushSync(() => setContractId(id)),
    logout: () => flushSync(() => setContractId(null)),
  }), [contractId]);
}
