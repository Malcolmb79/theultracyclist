import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  OAUTH_STATE_COOKIE_NAME,
  sessionCookieHeader,
  decodeIdTokenClaims,
  isAllowedEmail,
  parseCookies,
} from "./_lib/session.js";
import { passkeySignInPossible } from "./_lib/passkeys.js";

function redirectTo(res: VercelResponse, path: string) {
  res.writeHead(302, { Location: path });
  res.end();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Passkey-only means passkey-only: hiding the button while this route still
  // issued sessions left Microsoft OAuth as a second, unadvertised way in.
  // Recovery is clearing PASSKEY_ONLY in Vercel and redeploying - see
  // .env.example.
  // Same condition as auth-login: enforced only while a passkey could
  // actually be used, so an empty credential store can't lock the dashboard.
  if (process.env.PASSKEY_ONLY === "true" && (await passkeySignInPossible())) {
    redirectTo(res, "/dashboard?auth=passkey-only");
    return;
  }

  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;
  const redirectUri = process.env.AZURE_REDIRECT_URI;
  const sessionSecret = process.env.SESSION_SECRET;

  if (!clientId || !clientSecret || !redirectUri || !sessionSecret) {
    res.status(500).send("Microsoft sign-in isn't fully configured yet.");
    return;
  }

  const { code, state, error } = req.query as Record<string, string | undefined>;
  const cookies = parseCookies(req.headers.cookie);

  if (error || !code || !state || state !== cookies[OAUTH_STATE_COOKIE_NAME]) {
    redirectTo(res, "/dashboard?auth=failed");
    return;
  }

  const tokenRes = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      scope: "openid email profile",
    }),
  });

  if (!tokenRes.ok) {
    redirectTo(res, "/dashboard?auth=failed");
    return;
  }

  const tokenBody = (await tokenRes.json()) as { id_token?: string };
  const claims = tokenBody.id_token ? decodeIdTokenClaims(tokenBody.id_token, clientId) : null;
  const email = String(claims?.email ?? claims?.preferred_username ?? "").toLowerCase();

  if (!email || !isAllowedEmail(email)) {
    redirectTo(res, "/dashboard?auth=denied");
    return;
  }

  res.setHeader("Set-Cookie", [
    sessionCookieHeader(email, sessionSecret, "microsoft"),
    `${OAUTH_STATE_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
  ]);
  redirectTo(res, "/dashboard");
}
