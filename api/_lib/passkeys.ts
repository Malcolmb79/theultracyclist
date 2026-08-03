import { createHmac, timingSafeEqual } from "node:crypto";
import type { VercelRequest } from "@vercel/node";
import { getJSON, readJSON, setJSON } from "./kvStore.js";
import { parseCookies } from "./session.js";

/**
 * Passkey (WebAuthn) credentials for the dashboard.
 *
 * Stored in the same KV as everything else: a handful of public keys, which
 * are not secret - a stolen credential record cannot be used to sign in,
 * since the private key never leaves the authenticator.
 */

const KV_KEY = "PASSKEY_CREDENTIALS";

export const CHALLENGE_COOKIE_NAME = "pk_challenge";
// Long enough for Face ID / a security key tap, short enough that a captured
// challenge is useless by the time it could be replayed.
const CHALLENGE_MAX_AGE_SECONDS = 300;

export type StoredCredential = {
  /** base64url credential ID, as WebAuthn reports it. */
  id: string;
  /** base64url COSE public key. */
  publicKey: string;
  /** Signature counter, for cloned-authenticator detection. */
  counter: number;
  transports?: string[];
  /** Which device this is, so a lost one can be identified and removed. */
  label: string;
  createdAt: string;
  lastUsedAt?: string;
  /** The account it signs in as - the session is issued for this address. */
  email: string;
};

export async function listCredentials(): Promise<StoredCredential[]> {
  return (await getJSON<StoredCredential[]>(KV_KEY)) ?? [];
}

/**
 * Whether signing in with a passkey is actually possible right now.
 *
 * PASSKEY_ONLY turns off Microsoft sign-in. If the credential list is ever
 * empty while that flag is set, there is no way into the dashboard at all -
 * recovery means editing Vercel's environment and redeploying, which is a poor
 * position to be in the night before an attempt. The delete route already
 * refuses to remove the last passkey, but that doesn't cover a lost phone, a
 * wiped KV, or credentials invalidated by a change of domain.
 *
 * So the callers below only enforce passkey-only when a passkey could actually
 * be used. Falling back to Microsoft is a downgrade to the previous
 * authentication method - still allowlisted, still a real Microsoft account -
 * not an open door.
 *
 * readJSON rather than listCredentials, and false on error, because getJSON
 * turns an unreachable Redis into an empty list. Treating that as "no
 * passkeys" would drop the dashboard back to Microsoft sign-in for the length
 * of a transient outage - a security control switching itself off precisely
 * when something is already wrong.
 */
export async function passkeySignInPossible(): Promise<boolean> {
  try {
    const stored = await readJSON<StoredCredential[]>(KV_KEY);
    return Array.isArray(stored) && stored.length > 0;
  } catch {
    // Couldn't read. Assume credentials exist and keep passkey-only on.
    return true;
  }
}

export async function saveCredentials(credentials: StoredCredential[]): Promise<void> {
  await setJSON(KV_KEY, credentials);
}

export async function addCredential(credential: StoredCredential): Promise<void> {
  const all = await listCredentials();
  // Re-registering the same authenticator replaces rather than duplicates it,
  // so the list stays a list of devices rather than of registration attempts.
  await saveCredentials([...all.filter((c) => c.id !== credential.id), credential]);
}

export async function removeCredential(id: string): Promise<void> {
  const all = await listCredentials();
  await saveCredentials(all.filter((c) => c.id !== id));
}

export async function touchCredential(id: string, counter: number): Promise<void> {
  const all = await listCredentials();
  await saveCredentials(
    all.map((c) => (c.id === id ? { ...c, counter, lastUsedAt: new Date().toISOString() } : c)),
  );
}

/**
 * The challenge has to survive between the "options" call and the "verify"
 * call, which are separate invocations with no shared memory. It rides in a
 * signed cookie rather than KV: it is single-use, short-lived, and not
 * secret - only its authenticity matters, which an HMAC covers, and this way
 * verification needs no storage round trip.
 */
function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

/**
 * Wraps the challenge that generateRegistration/AuthenticationOptions
 * actually issued.
 *
 * It must be that exact value, not one we invented: passing a string
 * challenge into those helpers makes them treat it as UTF-8 text and
 * re-encode it, so the value the authenticator signs is not the string we
 * handed in. Verification compares against `options.challenge` verbatim, so
 * that is what gets stored - and the library picks the random bytes.
 */
export function challengeCookie(challenge: string, secret: string): string {
  const payload = Buffer.from(JSON.stringify({ challenge, exp: Date.now() + CHALLENGE_MAX_AGE_SECONDS * 1000 })).toString("base64url");
  const token = `${payload}.${sign(payload, secret)}`;
  return `${CHALLENGE_COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${CHALLENGE_MAX_AGE_SECONDS}`;
}

export function readChallenge(req: VercelRequest, secret: string): string | null {
  const token = parseCookies(req.headers.cookie)[CHALLENGE_COOKIE_NAME];
  if (!token) return null;

  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;

  const expected = sign(payload, secret);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { challenge?: string; exp?: number };
    if (!data.challenge || typeof data.exp !== "number" || data.exp < Date.now()) return null;
    return data.challenge;
  } catch {
    return null;
  }
}

// Cleared on both success and failure, so a challenge is never usable twice.
export const CLEAR_CHALLENGE_COOKIE = `${CHALLENGE_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;

/**
 * The relying party is the site itself. RP ID must be the registrable domain
 * with no scheme or port, and a credential registered against one RP ID is
 * unusable from another - which is why passkeys will not work from Vercel
 * preview URLs, only from the real domain.
 */
export function relyingParty(): { rpID: string; origin: string; rpName: string } {
  const configured = process.env.PASSKEY_RP_ID;
  const origin = process.env.PASSKEY_ORIGIN ?? (configured ? `https://${configured}` : "");
  return { rpID: configured ?? "", origin, rpName: "The Ultracyclist" };
}
