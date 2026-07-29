import { startRegistration, startAuthentication, browserSupportsWebAuthn } from "@simplewebauthn/browser";

// All passkey traffic goes to the one endpoint, selected by action - see
// api/passkeys.ts for why it is a single function.
const ENDPOINT = "/api/passkeys";

export type PasskeySummary = { id: string; label: string; createdAt: string; lastUsedAt?: string };

export function passkeysSupported(): boolean {
  return browserSupportsWebAuthn();
}

async function post(action: string, body: Record<string, unknown> = {}): Promise<unknown> {
  const res = await fetch(`${ENDPOINT}?action=${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Passkey request failed (${res.status})`);
  return data;
}

/**
 * Enrols a new passkey. Requires an existing session - the first one is
 * registered from inside the dashboard, which is what stops anyone else
 * adding their own.
 */
export async function registerPasskey(label: string): Promise<void> {
  const options = await post("register-options");
  // The authenticator prompt happens here: Face ID, Touch ID, Windows Hello
  // or a security key, depending on the device.
  const response = await startRegistration({ optionsJSON: options as never });
  await post("register-verify", { response, label });
}

/** Signs in with a passkey. Returns the address the session was issued for. */
export async function signInWithPasskey(): Promise<string> {
  const options = await post("auth-options");
  const response = await startAuthentication({ optionsJSON: options as never });
  const result = (await post("auth-verify", { response })) as { email?: string };
  return result.email ?? "";
}

export async function listPasskeys(): Promise<PasskeySummary[]> {
  const res = await fetch(`${ENDPOINT}?action=list`);
  if (!res.ok) return [];
  const data = (await res.json()) as { credentials?: PasskeySummary[] };
  return data.credentials ?? [];
}

export async function deletePasskey(id: string): Promise<void> {
  await post("delete", { id });
}
