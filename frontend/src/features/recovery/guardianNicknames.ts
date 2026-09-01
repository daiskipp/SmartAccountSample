const STORAGE_KEY = "account-sample/guardian-nicknames/v1";

export function saveGuardianNickname(credentialId: string, nickname: string): void {
  const trimmed = nickname.trim();
  if (!trimmed) return;
  const all = readAll();
  all[credentialId] = trimmed;
  writeAll(all);
}

export function getGuardianNickname(credentialId: string): string | undefined {
  return readAll()[credentialId];
}

function readAll(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* per-browser convenience only; a full/unavailable store just loses the label */
  }
}
