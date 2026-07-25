import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomBytes } from "node:crypto";
import { WHOOP_OAUTH_STATE_COOKIE_NAME, getSessionEmail } from "./_lib/session.js";

const AUTHORIZE_URL = "https://api.prod.whoop.com/oauth/oauth2/auth";
// Matches what api/whoop-data.ts actually reads (recovery, cycle, sleep,
// workout) plus `offline` for a refresh token.
const SCOPES = "offline read:recovery read:cycles read:sleep read:workout";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!getSessionEmail(req)) {
    res.status(401).send("Sign in first.");
    return;
  }

  const clientId = process.env.WHOOP_CLIENT_ID;
  const redirectUri = process.env.WHOOP_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    res.status(500).send("Whoop sign-in isn't configured yet (missing WHOOP_CLIENT_ID / WHOOP_REDIRECT_URI).");
    return;
  }

  const state = randomBytes(16).toString("hex");
  res.setHeader(
    "Set-Cookie",
    `${WHOOP_OAUTH_STATE_COOKIE_NAME}=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
  );

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: SCOPES,
    state,
  });

  res.writeHead(302, { Location: `${AUTHORIZE_URL}?${params}` });
  res.end();
}
