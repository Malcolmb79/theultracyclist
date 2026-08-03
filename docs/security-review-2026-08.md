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

**Fixed in `b7503d3`.** Detail kept below because the shape of the mistake is
worth remembering.

Settings has a toggle that hides the public `/live` page. Three endpoints can
answer "where is he", and the toggle reached none of them properly.

| Endpoint | Respected toggle | Exposed |
|---|---|---|
| `api/live-tracker.ts` | partly — see below | position, 3000 track points |
| `api/live.json.ts` | **no** | live lat/lon, speed, HR, power, distance, clocks |
| `api/history.json.ts` | **no** | the full decimated GPS track, up to 2000 points |

The last two also send `Access-Control-Allow-Origin: *`, so any site could read
them from a visitor's browser.

`live-tracker.ts` was the one I first read as correct, and it wasn't. It sets
`configured: false` when hidden, which stops the page drawing anything — but it
went on returning `position` and the full `history` array in the same response.
That hides the map from a browser and from nothing else. The lesson is the
usual one: hiding is a rendering decision, and the payload is the actual
boundary.

Why it matters here specifically: this is a real person's live location, and
the route begins and ends near home — established earlier when the
snap-to-nearest-vertex bug reported 74 km covered while stationary in the
kitchen. Someone who has seen the URL once keeps a working position feed after
the toggle is switched off, and the interface says otherwise.

The toggle is most likely to be used exactly when this matters: before the
attempt, after it, or to take the page down mid-ride.

**What was done:** one helper, `api/_lib/liveVisibility.ts`, used by all three.
It reads the toggle with `readJSON` rather than `getJSON`, so an unreachable
Redis fails closed instead of reading as "no config, therefore visible" —
which would have served position data during exactly the outage nobody is
watching. That costs nothing real, because the same failed read already leaves
the page with no route to draw.

Hidden now means: `live.json` and `history.json` return 403, and
`live-tracker.ts` withholds position, history, route URL and the tracking state
(whether he is on the road right now is itself worth not publishing). The owner
still sees everything, so the page can be previewed while hidden.

One subtlety that came with the fix: these responses now vary by session, and
they were edge-cached by URL. Without care, a single owner request while the
page was hidden would be cached and then handed to every visitor — the fix
becoming the leak. Owner responses are therefore `private, no-store`.

---

## MEDIUM — No security response headers

**Fixed in `b7503d3`.**

`vercel.json` set rewrites, functions and crons, but no `headers` block. The
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

**The policy, and where it is deliberately loose.** It was written against
what the site actually loads, not copied:

- `script-src 'self' https://www.instagram.com https://*.cdninstagram.com` —
  the only third-party script is the Instagram embed, injected by
  `useInstagramEmbedProcess`. `index.html` has no inline script, so no
  `'unsafe-inline'` is needed here, which is the whole point of the exercise.
- `style-src` keeps `'unsafe-inline'`. Leaflet positions everything by writing
  to `element.style`; without it the map does not work at all.
- `frame-src` lists `livetrack.garmin.com` (the LiveTrack card) and
  `www.instagram.com` (embeds).
- `img-src ... https:` and `connect-src 'self' https:` are the loose ones, on
  purpose. `gpxUrl` is a URL you paste into Settings and the browser fetches it
  directly, so pinning the list would break the day you use a route host I
  didn't predict — during the attempt, silently. Weather, reverse geocoding and
  FX are three more hosts on the same argument.
- `geolocation=(self)` in `Permissions-Policy`, because `ThemeContext` and
  `WeatherCard` both ask for position.

Two things to eyeball on the deployed site, since neither can be verified from
a local build: the **Instagram section** on the home page, and the **Garmin
LiveTrack card** on the dashboard. If either is blank, the browser console will
name the blocked host, and it's a one-line addition to the policy.

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

## LOW — `api/history.json.ts` has no consumer

Nothing in the repository fetches it; the map track comes from
`live-tracker.ts`. It is a public endpoint serving the whole GPS track that
exists only for third parties. Now behind the visibility toggle, but worth
deciding whether it should exist at all.

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

## Status

1. ~~Close the visibility gap~~ — done, across all three endpoints.
2. ~~Add security headers~~ — done; verify the two embeds on the deployed site.
3. Rate limiting: left alone. Revisit if the bill says otherwise.

Unrelated to the review, still outstanding: the ingest token was pasted into a
chat transcript and should be rotated in both Vercel and `Secrets.mc`.
