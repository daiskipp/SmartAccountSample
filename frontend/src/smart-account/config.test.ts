import { describe, expect, it } from "vitest";
import { canCreateSmartAccount, configuredSmartAccountKit } from "./config";

describe("Smart Account configuration", () => {
  it("does not create a browser kit without every deployment setting", () => {
    expect(configuredSmartAccountKit({ VITE_SMART_ACCOUNT_RPC_URL: "https://rpc.example" })).toBeNull();
  });

  it("permits direct RPC for existing-account recovery without a relayer", () => {
    expect(configuredSmartAccountKit({
      VITE_SMART_ACCOUNT_RPC_URL: "https://rpc.example",
      VITE_SMART_ACCOUNT_NETWORK_PASSPHRASE: "Standalone Network ; February 2017",
      VITE_SMART_ACCOUNT_WASM_HASH: "a".repeat(64),
      VITE_WEBAUTHN_VERIFIER_ADDRESS: "CABC",
    })).not.toBeNull();
  });

  it("requires a relayer for account deployment without exposing a fee-payer secret", () => {
    expect(canCreateSmartAccount({
      VITE_SMART_ACCOUNT_RPC_URL: "https://rpc.example",
      VITE_SMART_ACCOUNT_NETWORK_PASSPHRASE: "Standalone Network ; February 2017",
      VITE_SMART_ACCOUNT_WASM_HASH: "a".repeat(64),
      VITE_WEBAUTHN_VERIFIER_ADDRESS: "CABC",
    })).toBe(false);
  });

  it("creates a kit when a relay endpoint accompanies the deployment", () => {
    expect(configuredSmartAccountKit({
      VITE_SMART_ACCOUNT_RPC_URL: "https://rpc.example",
      VITE_SMART_ACCOUNT_NETWORK_PASSPHRASE: "Standalone Network ; February 2017",
      VITE_SMART_ACCOUNT_WASM_HASH: "a".repeat(64),
      VITE_WEBAUTHN_VERIFIER_ADDRESS: "CABC",
      VITE_SMART_ACCOUNT_RELAYER_URL: "https://relay.example/submit",
    })).not.toBeNull();
    expect(canCreateSmartAccount({
      VITE_SMART_ACCOUNT_RPC_URL: "https://rpc.example",
      VITE_SMART_ACCOUNT_NETWORK_PASSPHRASE: "Standalone Network ; February 2017",
      VITE_SMART_ACCOUNT_WASM_HASH: "a".repeat(64),
      VITE_WEBAUTHN_VERIFIER_ADDRESS: "CABC",
      VITE_SMART_ACCOUNT_RELAYER_URL: "https://relay.example/submit",
    })).toBe(true);
  });

  it("rejects insecure RPC URLs even for localnet", () => {
    const localnet = {
      VITE_SMART_ACCOUNT_RPC_URL: "http://stellar-localnet:8000/rpc",
      VITE_SMART_ACCOUNT_NETWORK_PASSPHRASE: "Standalone Network ; February 2017",
      VITE_SMART_ACCOUNT_WASM_HASH: "a".repeat(64),
      VITE_WEBAUTHN_VERIFIER_ADDRESS: "CABC",
      VITE_SMART_ACCOUNT_RELAYER_URL: "https://relay.example/submit",
    };
    expect(configuredSmartAccountKit(localnet)).toBeNull();
  });
});
