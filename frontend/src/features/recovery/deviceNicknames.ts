const STORAGE_KEY = "account-sample/device-nicknames/v1";

export function saveDeviceNickname(publicKey: Uint8Array, nickname: string): void {
  const trimmed = nickname.trim();
  if (!trimmed) return;
  const all = readAll();
  all[keyFor(publicKey)] = trimmed;
  writeAll(all);
}

export function getDeviceNickname(publicKey: Uint8Array): string | undefined {
  return readAll()[keyFor(publicKey)];
}

function keyFor(publicKey: Uint8Array): string {
  return btoa(String.fromCharCode(...publicKey)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
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
