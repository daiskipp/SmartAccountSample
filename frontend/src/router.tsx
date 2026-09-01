import {
  Outlet,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import type { SmartAccountKit } from "smart-account-kit";
import type { AuthState } from "./auth";
import { LoginScreen } from "./features/login/LoginScreen";
import { Dashboard } from "./features/dashboard/Dashboard";
import { RecoveryEntry } from "./features/recovery/RecoveryEntry";
import { PhraseRecovery } from "./features/recovery/PhraseRecovery";
import { GuardianRecoveryExecute } from "./features/recovery/GuardianRecoveryExecute";
import { GuardianJoin } from "./features/recovery/GuardianJoin";

export interface RouterContext {
  kit: SmartAccountKit | null;
  auth: AuthState;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: () => <main><Outlet /></main>,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => { throw redirect({ to: "/app" }); },
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  beforeLoad: ({ context }) => {
    if (context.auth.contractId) throw redirect({ to: "/app" });
  },
  component: () => {
    const { kit, auth } = loginRoute.useRouteContext();
    return <LoginScreen kit={kit} onLogin={auth.login} />;
  },
});

// Pathless layout route: gates every child behind a logged-in contractId.
const authenticatedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "_authenticated",
  beforeLoad: ({ context }) => {
    if (!context.auth.contractId) throw redirect({ to: "/login" });
  },
});

const appRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: "/app",
  component: () => {
    const { kit, auth } = appRoute.useRouteContext();
    const navigate = useNavigate();
    const handleLogout = () => {
      void kit?.disconnect();
      auth.logout();
      // The already-resolved /app match's cached context and beforeLoad
      // guard don't re-run just because `auth` changed (RouterProvider's
      // `context` prop update doesn't invalidate matches) -- an explicit
      // navigation is required, mirroring LoginScreen's post-login navigate.
      void navigate({ to: "/login" });
    };
    return <Dashboard kit={kit} accountContractId={auth.contractId} onLogout={handleLogout} />;
  },
});

const recoveryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/recovery",
  component: RecoveryEntry,
});

const recoveryPhraseRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/recovery/phrase",
  component: () => {
    const { kit } = recoveryPhraseRoute.useRouteContext();
    return <PhraseRecovery kit={kit} />;
  },
});

const recoveryGuardianRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/recovery/guardian",
  validateSearch: (search: Record<string, unknown>): { account?: string } => ({
    account: typeof search.account === "string" ? search.account : undefined,
  }),
  component: () => {
    const { kit } = recoveryGuardianRoute.useRouteContext();
    const { account } = recoveryGuardianRoute.useSearch();
    return <GuardianRecoveryExecute kit={kit} accountContractId={account} />;
  },
});

const guardianJoinRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/guardian/join",
  validateSearch: (search: Record<string, unknown>): { invite?: string } => ({
    invite: typeof search.invite === "string" ? search.invite : undefined,
  }),
  component: () => {
    const { kit } = guardianJoinRoute.useRouteContext();
    const { invite } = guardianJoinRoute.useSearch();
    return <GuardianJoin kit={kit} initialInviteCode={invite} />;
  },
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  authenticatedRoute.addChildren([appRoute]),
  recoveryRoute,
  recoveryPhraseRoute,
  recoveryGuardianRoute,
  guardianJoinRoute,
]);

export const router = createRouter({ routeTree, context: { kit: null, auth: undefined! } });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
