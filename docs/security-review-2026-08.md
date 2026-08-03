# Security review — 3 August 2026

Manual review of the whole application, alongside the automated tooling added
in `5b73770`. Verified against the code rather than assumed; every claim below
was checked.

Scope: 38 API routes, the React front end, the Connect IQ tracker, session and
authentication, secret handling, and the deployment configuration.

---

## Summary

| | |
|---|---|
| **High** | 1 — the live-page visibility toggle does not cover the raw feeds |
| **Medium** | 1 — no security response headers |
| **Low** | 2 — no rate limiting; `strava-activities` is public |
| **Informational** | dependency advisories (triaged in `SECURITY.md`) |
| **Verified sound** | SQL handling, XSS surface, secret storage, session design, authorisation |

The two findings worth acting on are configuration-level. Nothing in the
application logic is exploitable as written.

---

## HIGH — "Show live page to visitors" doesn't hide the position feeds

Settings has a toggle that hides the public `/live` page. `api/live-tracker.ts`
honours it: with `visible: false`, `configured` comes back false for anyone who
isn't the owner and the page renders nothing.

**Two other endpoints serve the same data and ignore it entirely.**

| Endpoint | Respects toggle | Exposes |
|---|---|---|
| `api/live-tracker.ts` | yes | position, layout |
| `api/live.json.ts` | **no** | live lat/lon, speed, HR, power, distance, clocks |
| `api/history.json.ts` | **no** | the full decimated GPS track, up to 2000 points |

Both also send `Access-Control-Allow-Origin: *`, so any site can read them from
a browser.

Why it matters here specifically: this is a real person's live location, and
the route begins and ends near home — established earlier when the
snap-to-nearest-vertex bug reported 74 km covered while stationary in the
kitchen. Someone who has seen the URL once keeps a working position feed after
the toggle is switched off, and the interface says otherwise.

The toggle is most likely to be used exactly when this matters: before the
attempt, after it, or to take the page down mid-ride.

**Fix:** apply the same `visible` check in both routes — read the config,
return an empty or "hidden" payload for non-owners. Roughly ten lines, mirroring
what `live-tracker.ts` already does.

---

## MEDIUM — No security response headers

`vercel.json` sets rewrites, functions and crons, but no `headers` block. The
site therefore sends no CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy`
or frame-ancestors policy.

Consequences, in order of how much they matter here:

- **No CSP.** The strongest mitigation against XSS, which matters because the
  progress-photo feature stores `data:` URLs and writes them into `<img src>`.
  That input is regex-validated to jpeg/png/webp base64 and is authenticated, so
  it isn't currently exploitable — but CSP is what contains the class rather
  than the instance.
- **No HSTS.** Vercel serves HTTPS and redirects, but the header is what stops
  a first-visit downgrade.
- **No `Referrer-Policy`.** Outbound links leak the full URL, including the
  `/live` path.
- **No `X-Content-Type-Options: nosniff`.**

Note the tension worth resolving deliberately: `GarminLiveTrackCard` embeds
Garmin's LiveTrack page in an iframe, so a `frame-src` policy has to permit
`livetrack.garmin.com`, and the map loads CARTO tiles, so `img-src` must allow
those. A copy-pasted strict CSP will break both.

---

## LOW — No rate limiting

No endpoint implements rate limiting. Assessed as low rather than ignored:

- `api/ingest.ts` and `api/traccar-osmand.ts` are bearer-token protected, and
  the token is 48 random characters.
- Read endpoints are edge-cached (`s-maxage`), so volume is absorbed before it
  reaches a function.
- The authentication routes aren't guessable-credential surfaces: passkeys are
  challenge-response, and Microsoft OAuth is delegated.

The residual risk is cost rather than compromise — an uncached route being
hammered bills Vercel and Neon.

## LOW — `api/strava-activities.ts` is unauthenticated

Serves athlete profile and up to 200 rides publicly, cached 15 minutes. It's
consumed by the public site's Strava feed, so this is intentional. Flagged only
because the same route is used by the authenticated Trends page with
`?count=200`, which makes the exposure larger than the public feed needs.

---

## Verified sound

**SQL injection — not present.** Every query in `api/_lib/trackerDb.ts` uses
`$n` placeholders with a values array. The one interpolated statement builds
`INSERT INTO samples (${columns.join(", ")})` from a hardcoded array and
generated `$n` placeholders; no user input reaches the string.

**XSS — no sinks.** No `dangerouslySetInnerHTML`, no `innerHTML`, anywhere in
`src/`. React escapes by default. The one place untrusted-shaped data becomes
markup is the progress-photo `data:` URL, which is validated against
`/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/` and length-capped.

**Secrets — correctly handled.** The ingest token and the Connect IQ signing key
live in nested `.gitignore`s, confirmed with `git check-ignore`, on a public
repository. The token does not appear anywhere in git history. Gitleaks now
scans full history on every push.

**Session design — sound.** HMAC-signed, `HttpOnly`, `Secure`, `SameSite=Lax`,
no `Max-Age` so it dies with the browser session. Signature comparison uses
`timingSafeEqual`. Sliding idle timeout under a 12-hour absolute cap that
renewal cannot extend, because `iat` is carried through unchanged.

**Authorisation — correctly tiered.** Microsoft sign-in is allowlisted by email.
Coaching additionally requires a passkey-authenticated session, enforced
server-side on all four coaching routes rather than by hiding the page. A cookie
predating the `amr` field is treated as the weaker method, so no existing
session was silently upgraded.

**Webhook verification — correct.** `api/whatsapp-webhook.ts` validates the
`X-Twilio-Signature` header with `twilio.validateRequest` before acting.

---

## Recommended order

1. Close the visibility gap in `live.json` and `history.json` — it's the only
   finding where the interface currently tells you something untrue.
2. Add security headers, with `frame-src` and `img-src` written against what the
   site actually loads.
3. Leave rate limiting unless the bill says otherwise.
