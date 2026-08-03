import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomBytes } from "node:crypto";
import { OAUTH_STATE_COOKIE_NAME } from "./_lib/session.js";
import { passkeySignInPossible } from "./_lib/passkeys.js";

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  // Refused outright when passkeys are the only permitted login, so the OAuth
  // flow can't be started just by visiting this URL. auth-callback.ts refuses
  // too: blocking only the entry point would leave the callback usable on its
  // own, which is the half-measure this replaces.
  // Only enforced while a passkey could actually be used - see
  // passkeySignInPossible. With the flag set and no credentials registered,
  // refusing here would leave no way in at all.
  if (process.env.PASSKEY_ONLY === "true" && (await passkeySignInPossible())) {
    res.status(403).send("Microsoft sign-in is disabled - this dashboard uses passkeys.");
    return;
  }

  const clientId = process.env.AZURE_CLIENT_ID;
  const redirectUri = process.env.AZURE_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    res.status(500).send("Microsoft sign-in isn't configured yet (missing AZURE_CLIENT_ID / AZURE_REDIRECT_URI).");
    return;
  }

  const state = randomBytes(16).toString("hex");
  res.setHeader(
    "Set-Cookie",
    `${OAUTH_STATE_COOKIE_NAME}=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
  );

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: "openid email profile",
    state,
  });

  res.writeHead(302, { Location: `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}` });
  res.end();
}
