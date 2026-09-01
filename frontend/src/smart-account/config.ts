import { IndexedDBStorage, SmartAccountKit, type SmartAccountConfig } from "smart-account-kit";

const REQUIRED = [
  "VITE_SMART_ACCOUNT_RPC_URL",
  "VITE_SMART_ACCOUNT_NETWORK_PASSPHRASE",
  "VITE_SMART_ACCOUNT_WASM_HASH",
  "VITE_WEBAUTHN_VERIFIER_ADDRESS",
] as const;

/** Account deployment uses the SDK's shared deployer and therefore needs a fee sponsor. */
export function canCreateSmartAccount(env: Record<string, string | boolean | undefined>): boolean {
  return !REQUIRED.some((key) => typeof env[key] !== "string" || !env[key])
    && typeof env.VITE_SMART_ACCOUNT_RELAYER_URL === "string"
    && env.VITE_SMART_ACCOUNT_RELAYER_URL.length > 0;
}

export function configuredSmartAccountKit(env: Record<string, string | boolean | undefined>): SmartAccountKit | null {
  if (REQUIRED.some((key) => typeof env[key] !== "string" || !env[key])) return null;
  const rpcUrl = String(env.VITE_SMART_ACCOUNT_RPC_URL);
  if (rpcUrl.startsWith("http://")) return null;
  const config: SmartAccountConfig = {
    rpcUrl,
    networkPassphrase: String(env.VITE_SMART_ACCOUNT_NETWORK_PASSPHRASE),
    accountWasmHash: String(env.VITE_SMART_ACCOUNT_WASM_HASH),
    webauthnVerifierAddress: String(env.VITE_WEBAUTHN_VERIFIER_ADDRESS),
    storage: new IndexedDBStorage(),
  };
  const relayerUrl = env.VITE_SMART_ACCOUNT_RELAYER_URL;
  if (typeof relayerUrl === "string" && relayerUrl) config.relayerUrl = relayerUrl;
  const ed25519VerifierAddress = env.VITE_ED25519_VERIFIER_ADDRESS;
  if (typeof ed25519VerifierAddress === "string" && ed25519VerifierAddress) {
    config.ed25519VerifierAddress = ed25519VerifierAddress;
  }
  return new SmartAccountKit(config);
}
