import { beforeEach, describe, expect, it } from "vitest";
import { getDeviceNickname, saveDeviceNickname } from "./deviceNicknames";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  clear(): void { this.values.clear(); }
}

globalThis.localStorage = new MemoryStorage();

describe("device nicknames", () => {
  beforeEach(() => localStorage.clear());

  it("remembers a nickname per public key across reads", () => {
    const publicKey = new Uint8Array(65).fill(3);
    expect(getDeviceNickname(publicKey)).toBeUndefined();
    saveDeviceNickname(publicKey, "  iPhone  ");
    expect(getDeviceNickname(publicKey)).toBe("iPhone");
  });

  it("ignores a blank nickname", () => {
    const publicKey = new Uint8Array(65).fill(4);
    saveDeviceNickname(publicKey, "   ");
    expect(getDeviceNickname(publicKey)).toBeUndefined();
  });

  it("keeps distinct devices separate", () => {
    const a = new Uint8Array(65).fill(1);
    const b = new Uint8Array(65).fill(2);
    saveDeviceNickname(a, "iPhone");
    saveDeviceNickname(b, "会社のMac");
    expect(getDeviceNickname(a)).toBe("iPhone");
    expect(getDeviceNickname(b)).toBe("会社のMac");
  });
});
