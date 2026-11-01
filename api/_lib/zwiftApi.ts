import { getJSON, setJSON } from "./kvStore.js";

// Zwift's own account API, signed in with the account the site already uses
// for ZwiftPower (ZWIFT_USERNAME / ZWIFT_PASSWORD) - the way Zwift's game
// signs in. The token is kept in Redis until shortly before it runs out,
// so riding doesn't mean signing in on every call.

const AUTH = "https://secure.zwift.com/auth/realms/zwift/protocol/openid-connect/token";
const API = "https://us-or-rly101.zwift.com";
const TOKEN_KEY = "zwift:api-token";
// Zwift's API answers its own clients; this is how the game introduces itself.
const HEADERS = {
  Accept: "application/json",
  Platform: "OSX",
  Source: "Game Client",
  "User-Agent": "CNL/3.44.0 (Darwin Kernel 23.2.0) zwift/1.0.122968 game/1.54.0 curl/8.4.0",
};

export class ZwiftApiUnavailable extends Error {}

async function token(): Promise<string> {
  const cached = await getJSON<{ token: string; until: number }>(TOKEN_KEY);
  if (cached && cached.until > Date.now()) return cached.token;
  const username = process.env.ZWIFT_USERNAME;
  const password = process.env.ZWIFT_PASSWORD;
  if (!username || !password) throw new ZwiftApiUnavailable("ZWIFT_USERNAME / ZWIFT_PASSWORD aren't set");
  const res = await fetch(AUTH, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ client_id: "Zwift Game Client", grant_type: "password", username, password }),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !body.access_token) throw new ZwiftApiUnavailable(body.error_description ?? `Zwift sign-in failed (${res.status})`);
  // Kept until a minute before Zwift says it expires.
  await setJSON(TOKEN_KEY, { token: body.access_token, until: Date.now() + Math.max(60, (body.expires_in ?? 600) - 60) * 1000 });
  return body.access_token;
}

export async function zwiftGet<T>(path: string): Promise<T> {
  let t = await token();
  let res = await fetch(`${API}${path}`, { headers: { ...HEADERS, Authorization: `Bearer ${t}` } });
  if (res.status === 401) {
    // Revoked early: sign in afresh, once.
    await setJSON(TOKEN_KEY, null);
    t = await token();
    res = await fetch(`${API}${path}`, { headers: { ...HEADERS, Authorization: `Bearer ${t}` } });
  }
  if (!res.ok) throw new Error(`Zwift ${path} failed (${res.status})`);
  return (await res.json()) as T;
}
