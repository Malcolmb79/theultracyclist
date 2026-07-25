import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomBytes } from "node:crypto";
import { OAUTH_STATE_COOKIE_NAME } from "./_lib/session.js";

export default async function handler(_req: VercelRequest, res: VercelResponse) {
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
