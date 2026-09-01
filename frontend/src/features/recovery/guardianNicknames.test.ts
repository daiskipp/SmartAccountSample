import { beforeEach, describe, expect, it } from "vitest";
import { getGuardianNickname, saveGuardianNickname } from "./guardianNicknames";

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

describe("guardian nicknames", () => {
  beforeEach(() => localStorage.clear());

  it("remembers a nickname per credential id across reads", () => {
    expect(getGuardianNickname("credential-a")).toBeUndefined();
    saveGuardianNickname("credential-a", "  あきら  ");
    expect(getGuardianNickname("credential-a")).toBe("あきら");
  });

  it("ignores a blank nickname", () => {
    saveGuardianNickname("credential-b", "   ");
    expect(getGuardianNickname("credential-b")).toBeUndefined();
  });

  it("keeps distinct guardians separate", () => {
    saveGuardianNickname("credential-a", "あきら");
    saveGuardianNickname("credential-b", "ゆい");
    expect(getGuardianNickname("credential-a")).toBe("あきら");
    expect(getGuardianNickname("credential-b")).toBe("ゆい");
  });
});
