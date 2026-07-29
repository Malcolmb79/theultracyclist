import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { getSessionEmail, isAllowedEmail, sessionCookieHeader } from "./_lib/session.js";
import {
  CLEAR_CHALLENGE_COOKIE,
  addCredential,
  challengeCookie,
  listCredentials,
  readChallenge,
  relyingParty,
  removeCredential,
  touchCredential,
} from "./_lib/passkeys.js";

/**
 * One route for the whole passkey lifecycle, selected by `action`, rather than
 * six separate functions - keeps the serverless function count down and keeps
 * the flow readable in one file.
 *
 * Enrolling requires an existing session: the first passkey is registered
 * from inside the dashboard after signing in the old way. That is what stops
 * anyone who reaches this endpoint from simply adding their own credential.
 */

type Action = "register-options" | "register-verify" | "auth-options" | "auth-verify" | "list" | "delete";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const sessionSecret = process.env.SESSION_SECRET;
  const { rpID, origin, rpName } = relyingParty();

  if (!sessionSecret || !rpID || !origin) {
    res.status(500).json({ error: "Passkeys are not configured (needs SESSION_SECRET and PASSKEY_RP_ID)." });
    return;
  }

  const action = ((req.query.action as string) ?? (req.body as { action?: string } | undefined)?.action ?? "") as Action;
  const email = getSessionEmail(req);

  try {
    switch (action) {
      // ---- Enrolment: signed-in only -------------------------------------
      case "register-options": {
        if (!email) return unauthorized(res);
        const existing = await listCredentials();

        const options = await generateRegistrationOptions({
          rpName,
          rpID,
          userName: email,
          userDisplayName: email,
          // Prevents registering the same authenticator twice, which would
          // otherwise look like two devices and give false confidence about
          // how many ways back in there are.
          excludeCredentials: existing.map((c) => ({ id: c.id, transports: c.transports as never })),
          authenticatorSelection: {
            residentKey: "required",
            userVerification: "preferred",
          },
        });

        res.setHeader("Set-Cookie", challengeCookie(options.challenge, sessionSecret));
        res.status(200).json(options);
        return;
      }

      case "register-verify": {
        if (!email) return unauthorized(res);
        const expectedChallenge = readChallenge(req, sessionSecret);
        res.setHeader("Set-Cookie", CLEAR_CHALLENGE_COOKIE);
        if (!expectedChallenge) {
          res.status(400).json({ error: "Registration timed out - start again." });
          return;
        }

        const body = req.body as { response?: unknown; label?: string };
        const verification = await verifyRegistrationResponse({
          response: body.response as never,
          expectedChallenge,
          expectedOrigin: origin,
          expectedRPID: rpID,
        });

        if (!verification.verified || !verification.registrationInfo) {
          res.status(400).json({ error: "Could not verify that passkey." });
          return;
        }

        const { credential } = verification.registrationInfo;
        await addCredential({
          id: credential.id,
          publicKey: Buffer.from(credential.publicKey).toString("base64url"),
          counter: credential.counter,
          transports: credential.transports,
          label: (body.label ?? "").trim() || "Passkey",
          createdAt: new Date().toISOString(),
          email,
        });

        res.status(200).json({ ok: true });
        return;
      }

      // ---- Sign-in: deliberately open, that is the point of a login ------
      case "auth-options": {
        const options = await generateAuthenticationOptions({
          rpID,
          // No allowCredentials: discoverable (resident) keys let the
          // authenticator offer the right passkey without the site first
          // revealing which credentials exist.
          userVerification: "preferred",
        });
        res.setHeader("Set-Cookie", challengeCookie(options.challenge, sessionSecret));
        res.status(200).json(options);
        return;
      }

      case "auth-verify": {
        const expectedChallenge = readChallenge(req, sessionSecret);
        if (!expectedChallenge) {
          res.setHeader("Set-Cookie", CLEAR_CHALLENGE_COOKIE);
          res.status(400).json({ error: "Sign-in timed out - try again." });
          return;
        }

        const body = req.body as { response?: { id?: string } };
        const credentialId = body.response?.id;
        const stored = (await listCredentials()).find((c) => c.id === credentialId);
        if (!stored) {
          res.setHeader("Set-Cookie", CLEAR_CHALLENGE_COOKIE);
          res.status(401).json({ error: "That passkey isn't registered." });
          return;
        }

        const verification = await verifyAuthenticationResponse({
          response: body.response as never,
          expectedChallenge,
          expectedOrigin: origin,
          expectedRPID: rpID,
          credential: {
            id: stored.id,
            publicKey: new Uint8Array(Buffer.from(stored.publicKey, "base64url")),
            counter: stored.counter,
            transports: stored.transports as never,
          },
        });

        if (!verification.verified) {
          res.setHeader("Set-Cookie", CLEAR_CHALLENGE_COOKIE);
          res.status(401).json({ error: "Could not verify that passkey." });
          return;
        }

        // The allowlist still governs who gets a session, so revoking an
        // address locks out its passkeys without having to find and delete
        // each credential.
        if (!isAllowedEmail(stored.email)) {
          res.setHeader("Set-Cookie", CLEAR_CHALLENGE_COOKIE);
          res.status(403).json({ error: "That account is no longer allowed." });
          return;
        }

        await touchCredential(stored.id, verification.authenticationInfo.newCounter);

        res.setHeader("Set-Cookie", [sessionCookieHeader(stored.email, sessionSecret), CLEAR_CHALLENGE_COOKIE]);
        res.status(200).json({ ok: true, email: stored.email });
        return;
      }

      // ---- Management: signed-in only ------------------------------------
      case "list": {
        if (!email) return unauthorized(res);
        const credentials = await listCredentials();
        // Public keys are not secret, but there is no reason to hand them out
        // either - only what the management UI needs to show.
        res.status(200).json({
          credentials: credentials.map((c) => ({
            id: c.id,
            label: c.label,
            createdAt: c.createdAt,
            lastUsedAt: c.lastUsedAt,
          })),
        });
        return;
      }

      case "delete": {
        if (!email) return unauthorized(res);
        const id = (req.body as { id?: string } | undefined)?.id;
        if (!id) {
          res.status(400).json({ error: "Which passkey?" });
          return;
        }
        const remaining = (await listCredentials()).filter((c) => c.id !== id);
        // Refusing to remove the last one only matters once Microsoft sign-in
        // is switched off - at that point it is the difference between a
        // tidy-up and locking yourself out for good.
        if (remaining.length === 0 && process.env.PASSKEY_ONLY === "true") {
          res.status(409).json({
            error: "That's your only passkey, and passkey-only sign-in is on. Register another first.",
          });
          return;
        }
        await removeCredential(id);
        res.status(200).json({ ok: true });
        return;
      }

      default:
        res.status(400).json({ error: "Unknown action." });
    }
  } catch (error) {
    console.error("passkeys", action, error);
    res.status(500).json({ error: "Passkey request failed." });
  }
}

function unauthorized(res: VercelResponse) {
  res.status(401).json({ error: "Unauthorized" });
}
