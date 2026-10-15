/**
 * Browser side of bring-your-own-key. The visitor's Birdeye Data key lives in
 * this module's memory only: never in localStorage, cookies or URLs, so it is
 * gone when the tab closes. It travels to this app's own API routes in a
 * request header and from there to Birdeye.
 */
export const API_KEY_HEADER = "x-birdeye-api-key";

let visitorKey = "";

export function setVisitorApiKey(key: string): void {
  visitorKey = key.trim();
}

/** The key as typed, so a feature opened later shows it as connected. */
export function visitorApiKey(): string {
  return visitorKey;
}

export function hasVisitorApiKey(): boolean {
  return visitorKey.length > 0;
}

export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (visitorKey) headers.set(API_KEY_HEADER, visitorKey);
  return fetch(path, { ...init, headers, cache: "no-store" });
}
