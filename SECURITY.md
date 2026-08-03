# Security

## What runs, and when

| Layer | Tool | When | Where findings go |
|---|---|---|---|
| SAST | CodeQL (`security-and-quality`) | push, PR, weekly | Security → Code scanning |
| SCA | `npm audit` + OSV-Scanner | push, PR, weekly | Actions run summary |
| SCA (fixes) | Dependabot | weekly, grouped | Pull requests |
| Secrets | Gitleaks, full history | push, PR, weekly | Actions run summary |
| DAST | ZAP baseline | monthly, manual | Auto-filed issue |

All free, and free specifically because **this repository is public** — CodeQL
would need GitHub Advanced Security on a private repo.

Nothing blocks a push. This is a one-person project preparing a record
attempt; a scanner that fails the build over a moderate advisory in a
transitive dev dependency gets switched off within a week, and a switched-off
scanner finds nothing. Findings are reported to be read, not to gate.

## Why DAST is monthly and passive

The baseline scan spiders and passively inspects responses — headers, cookies,
information disclosure. It does not send attack payloads.

A full active scan would, and the public endpoints here write to the tracker
database. `api/ingest.ts` is bearer-token protected, but pointing an active
scanner at the record's own data is a poor trade for findings a baseline
already surfaces.

**Don't run it during the attempt.** The target is a live page people are
watching.

## Current dependency findings, and why they stand

13 advisories, last triaged 3 Aug 2026. **Twelve are dev-only.**

`@vercel/node` is a devDependency, used for its types and local emulation.
Everything under it — `@vercel/build-utils`, `@vercel/python-analysis`,
`js-yaml`, `minimatch`, `smol-toml`, `path-to-regexp`, `ajv`,
`@vercel/static-config`, `brace-expansion`, `undici` — runs at build time and
is never shipped. The advisories are denial-of-service and ReDoS classes:
real, and reachable only by an attacker who already controls this machine's
build inputs, at which point the advisory is not the problem.

The thirteenth is production and worth stating plainly:

**`react-router` — RSC Mode CSRF Bypass Allows Action Execution (high).**
The advisory covers `7.12.0 – 8.2.0`. There is no patched release in that
range yet; npm's only offered "fix" is a downgrade to 7.11.0, which is
breaking. It is left in place because **the vulnerable path is not reachable
here**: the site is a plain Vite SPA on `createBrowserRouter`, with no React
Server Components, no RSC mode, and no server actions. Kept at the newest
7.18.2 so the patch is picked up the moment it ships — Dependabot will raise
it.

Re-triage this list rather than trusting it. Reachability is a judgement made
against the code as it was on the date above, and it stops being true the day
the app starts doing something new.

## Secrets

Two secrets live outside git and must stay there. Both are on a **public**
repository, so a single `git add -f` publishes them to the world:

- `connectiq/edge-tracker/source/Secrets.mc` — the ingest token. It authorises
  writes to the record's own database.
- `connectiq/visibility-test/developer_key.der` / `.pem` — the Connect IQ
  signing key.

Each is covered by a nested `.gitignore` beside it, verified with
`git check-ignore`. Gitleaks scans full history on every push, because a
secret committed and later removed is still in the history and still valid
until it is rotated.

If the ingest token is ever exposed, rotating it means changing **both**
sides: `INGEST_TOKEN` in Vercel and `Secrets.mc`, then rebuilding and
sideloading the Connect IQ app. They are compared for exact equality, so a
mismatch rejects every batch with a 401 — and that failure is invisible from
the device, which reports only a Bluetooth error. See the tracker README.

## Reporting

Not a product and has no users to speak of, but if you find something:
open an issue without exploit details and it'll be picked up.
