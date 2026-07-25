import type { VercelRequest, VercelResponse } from "@vercel/node";
import { WHOOP_OAUTH_STATE_COOKIE_NAME, getSessionEmail, parseCookies } from "./_lib/session.js";
import { persistWhoopRefreshToken } from "./whoop-data.js";

const TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";

type WhoopTokenResponse = { refresh_token?: string };

function redirectTo(res: VercelResponse, path: string) {
  res.writeHead(302, { Location: path });
  res.end();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!getSessionEmail(req)) {
    redirectTo(res, "/dashboard/settings?whoop=failed");
    return;
  }

  const clientId = process.env.WHOOP_CLIENT_ID;
  const clientSecret = process.env.WHOOP_CLIENT_SECRET;
  const redirectUri = process.env.WHOOP_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    redirectTo(res, "/dashboard/settings?whoop=failed");
    return;
  }

  const { code, state, error } = req.query as Record<string, string | undefined>;
  const cookies = parseCookies(req.headers.cookie);

  if (error || !code || !state || state !== cookies[WHOOP_OAUTH_STATE_COOKIE_NAME]) {
    redirectTo(res, "/dashboard/settings?whoop=failed");
    return;
  }

  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenRes.ok) {
    redirectTo(res, "/dashboard/settings?whoop=failed");
    return;
  }

  const tokenBody = (await tokenRes.json()) as WhoopTokenResponse;
  if (!tokenBody.refresh_token) {
    redirectTo(res, "/dashboard/settings?whoop=failed");
    return;
  }

  await persistWhoopRefreshToken(tokenBody.refresh_token);

  res.setHeader(
    "Set-Cookie",
    `${WHOOP_OAUTH_STATE_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
  );
  redirectTo(res, "/dashboard/settings?whoop=connected");
}
