# Deploy Tarjuman to Vercel

This is the canonical deploy guide. The app is hosted on Vercel with the
GitHub integration: every push to `main` builds and deploys production.

- **Production app:** https://tarjuman.live (canonical; `www` 308-redirects
  to the bare domain. The original `live-transcribe-tarjuman-2ngq.vercel.app`
  still resolves to the same deployment.)
- **Convex prod deployment:** `opulent-parakeet-508`
- **Convex dev deployment:** `ardent-mockingbird-866`
- **GitHub repo:** `abdullah-diallo/live-transcribe--tarjuman-`

## Why Vercel works (the server.js caveat)

`server.js` (the Deepgram WebSocket proxy at `/api/deepgram-ws`) is
**dev-only, and Deepgram-only**. It exists to get around networks that
block browser WebSockets to `wss://api.deepgram.com`. In production,
`src/app/api/deepgram/route.ts` detects Vercel (`VERCEL === "1"` or
`NODE_ENV === "production"`), mints a short-lived Deepgram key via the
management API, and the browser opens the WebSocket to Deepgram
directly — no persistent Node process needed. Vercel never runs
`server.js`; it builds with `next build` and serves routes as serverless
functions.

Note that the **primary** engine is Speechmatics, which has no proxy on
either side: `/api/speechmatics` mints a JWT and the browser connects
straight to `wss://global.rt.speechmatics.com/v2` in dev and prod alike.
If a venue's network ever blocks that handshake the way one did for
Deepgram, the fix is an equivalent proxy in `server.js` — not a silent
fallback.

## How the build works

Vercel runs `bun run build`, which is:

```bash
convex deploy --cmd 'bunx convex codegen && next build'
```

`bunx`, not `npx`. **npm is not installed on the dev machine** — bun is the only
package manager here — and Vercel installs from `bun.lock`, so the bun binary is
guaranteed on the build PATH. `npx` would depend on a package manager this project
no longer uses.

One command does both deploys: it pushes `convex/` functions to the
**prod** Convex deployment, then runs the Next build with
`NEXT_PUBLIC_CONVEX_URL` automatically injected (pointing at
`https://opulent-parakeet-508.convex.cloud`). You do not set
`NEXT_PUBLIC_CONVEX_URL` in Vercel yourself.

This requires `CONVEX_DEPLOY_KEY` in Vercel's env (see below).

> **Footgun:** scope `CONVEX_DEPLOY_KEY` to the **Production**
> environment only. If it's available to Preview builds, every preview
> branch will deploy its `convex/` code to PROD Convex. Preview deploys
> will fail without a key — that's the safe default. (Convex preview
> deployments exist if you ever want working previews, but they need a
> separate preview deploy key.)

## One-time setup

### 1. Create the Vercel project

Vercel dashboard → **Add New → Project** → import
`abdullah-diallo/live-transcribe--tarjuman-`. Framework preset:
Next.js. Build command: leave default (`bun run build`). No
`vercel.json` is needed.

**Package manager.** Vercel picks it from the committed lockfile. This repo
ships `bun.lock` and no `package-lock.json`, so Vercel installs with
`bun install` — nothing to configure, but do not commit a second lockfile or
the detection becomes ambiguous.

`package.json` carries a `trustedDependencies` list because bun, unlike npm,
blocks dependency install scripts by default. `@sentry/cli` (prod source-map
upload), `esbuild` and `unrs-resolver` (native binaries for vitest/eslint)
and `sharp` (Next's image optimizer) all need theirs. Without that list the
install looks clean and then fails at build time — so if you add a dependency
that ships a postinstall, add it there too.

### 2. Set environment variables

Project → **Settings → Environment Variables**. All of these are
server-side unless marked `NEXT_PUBLIC_`:

```
CONVEX_DEPLOY_KEY      (Production only — from Convex dashboard →
                        opulent-parakeet-508 → Settings → Deploy key)
SPEECHMATICS_API_KEY   your Speechmatics key — REQUIRED. This is the
                        primary STT engine; without it every recording
                        fails with a 500 from /api/speechmatics.
ANTHROPIC_API_KEY      sk-ant-api03-...
NEXT_PUBLIC_APP_URL    https://tarjuman.live
DEEPGRAM_API_KEY       your Deepgram key   (optional — fallback engine only,
                        used when STT_PROVIDER is flipped to "deepgram")
DEEPGRAM_PROJECT_ID    Deepgram project id (optional)
SUNNAH_API_KEY         sunnah.com key      (optional)
NEXT_PUBLIC_SENTRY_DSN your Sentry DSN     (optional; empty = Sentry off)
```

> `SPEECHMATICS_API_KEY` **is already set** in the live project — verified
> 2026-08-29 by an unauthenticated `POST /api/speechmatics`, which returns
> 401 (auth check) rather than 500 (missing key). It is listed here because
> this guide previously omitted it, so a from-scratch redeploy following
> these steps would have shipped an app that could not record.

### Speechmatics concurrency — a launch constraint, not a config step

The Speechmatics **free tier allows 2 concurrent realtime sessions across
the entire app**. The third simultaneous recorder anywhere gets
`quota_exceeded`. Upgrade the plan (Pro raises it to 50) before any real
multi-user usage. `/dev/stt-compare` consumes **two** of those slots per
run, which is why `NEXT_PUBLIC_STT_COMPARE` must stay unset in prod.

Also enable **Settings → Environment Variables → Automatically expose
System Environment Variables** so `NEXT_PUBLIC_VERCEL_ENV` is available
(`src/lib/sentry.ts` uses it to tag the Sentry environment).

**Env vars only apply to new builds.** After adding or changing one:
Deployments → ⋯ on the latest deployment → **Redeploy**.

### 3. Set Convex prod env vars

These live in Convex itself (`convex/` code runs in Convex's runtime,
not Vercel's). Set via dashboard or:

```bash
bunx convex env set --prod KEY value
```

| Var | Purpose |
|---|---|
| `JWT_PRIVATE_KEY`, `JWKS` | Convex Auth session signing — set automatically by `bunx @convex-dev/auth` |
| `SITE_URL` | The canonical app URL (`https://tarjuman.live`) — Convex Auth redirects |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | Google OAuth — required for Google sign-in |
| `RESEND_API_KEY` | Password-reset email sender (`convex/passwordReset.ts`) |
| `RESEND_FROM` | "From" address — set to `Tarjuman <no-reply@tarjuman.live>` |

> **Resend:** `tarjuman.live` is verified in Resend and `RESEND_FROM` is set,
> so password-reset emails deliver to any user. If `RESEND_FROM` is ever
> unset, sends fall back to Resend's test sender, which only delivers to the
> Resend account owner's own inbox.

(`LOOPS_API_KEY` / `LOOPS_PASSWORD_RESET_ID` in the Convex env are
leftovers from the old Loops integration — unused since the switch to
Resend; safe to delete.)

### 4. Google OAuth URLs

In the Google Cloud console, the OAuth client needs:

- **Authorized redirect URI** (Convex handles the callback, so this is
  the Convex site URL, not the Vercel one):
  ```
  https://opulent-parakeet-508.convex.site/api/auth/callback/google
  ```
  (and `https://ardent-mockingbird-866.convex.site/api/auth/callback/google`
  if you want Google sign-in to work in local dev too)
- **Authorized JavaScript origin:**
  ```
  https://tarjuman.live
  ```
  (`http://localhost:3000` too, for local dev)

### 5. Verify

Open https://tarjuman.live and try:
- [ ] Sign up with email + password → land on `/record`
- [ ] Sign in with Google → land on `/record`
- [ ] Tap record → grant mic → speak Arabic → see transcript + translation
      (confirms temp-key minting + direct Deepgram WS works on Vercel)
- [ ] Stop → Generate Summary → summary appears
- [ ] Read-aloud speaks the translation via the browser's Web Speech voice
      (male voice only; silent if no male voice is installed for the language)
- [ ] History tab shows the session
- [ ] Tap session → detail page loads with transcript + summary
- [ ] Sign out → Sign back in → history persists
- [ ] Sign out → Forgot password → reset email arrives via Resend → reset
- [ ] Account menu → Delete account → all sessions removed
- [ ] `/privacy` and `/terms` reachable without auth
- [ ] Hit `/api/translate` from curl with no auth → 401 (not 200)

## Subsequent deploys

Push to `main`. Vercel builds and deploys automatically; the build step
also deploys `convex/` to prod. Branch pushes get preview URLs (but see
the `CONVEX_DEPLOY_KEY` footgun above — previews build against whatever
Convex URL they can resolve, and fail without a deploy key).

There is no Vercel CLI installed locally and none is required. If you
want one: `npm i -g vercel`, then `vercel link` in the project root.

## Custom domain

The canonical domain is **`tarjuman.live`** (added in Vercel → Settings →
Domains; `www` 308-redirects to the bare domain; Vercel auto-provisioned the
cert). The four pinned-URL spots are all updated to it:

1. Vercel env `NEXT_PUBLIC_APP_URL` = `https://tarjuman.live` (needs a redeploy)
2. Convex prod env `SITE_URL` = `https://tarjuman.live`
3. Google OAuth authorized JavaScript origin includes `https://tarjuman.live`
4. Resend domain `tarjuman.live` verified, `RESEND_FROM` = `Tarjuman <no-reply@tarjuman.live>`

To move to a different domain later, repeat those four steps with the new
value. The Google OAuth **redirect URI** never changes — it's on the Convex
domain (`https://opulent-parakeet-508.convex.site/api/auth/callback/google`),
not the app domain.

## Rollback

Deployments → pick a previous known-good deployment → ⋯ → **Instant
Rollback** (or "Promote to Production"). Note this rolls back the Next
app only — if the bad deploy also changed `convex/` functions or
schema, redeploy a good commit instead so Convex rolls back with it.

## Health monitoring

Vercel's dashboard shows per-route invocations, errors, and durations
(Observability tab). Sentry captures unhandled errors from route
handlers and React components once `NEXT_PUBLIC_SENTRY_DSN` is set.
Convex function logs/errors: Convex dashboard → opulent-parakeet-508 →
Logs.

## Env var reference

| Var | Where | Purpose |
|---|---|---|
| `CONVEX_DEPLOY_KEY` | Vercel (Production only) | Lets the build deploy `convex/` to prod and injects `NEXT_PUBLIC_CONVEX_URL` |
| `DEEPGRAM_API_KEY` | Vercel | Mints temp Deepgram keys for the browser WS + REST preflight |
| `DEEPGRAM_PROJECT_ID` | Vercel (optional) | Skips the project-discovery REST call when minting temp keys |
| `ANTHROPIC_API_KEY` | Vercel | `/api/translate`, `/api/summarize`, `/api/verify-citations` |
| `SUNNAH_API_KEY` | Vercel (optional) | Hadith citation enrichment in translate/verify-citations. Unset → silently skipped |
| `NEXT_PUBLIC_APP_URL` | Vercel | sitemap.ts / robots.ts canonical URL (`https://tarjuman.live`) |
| `NEXT_PUBLIC_SENTRY_DSN` | Vercel (optional) | Empty = Sentry off; non-empty = enabled |
| `NEXT_PUBLIC_CONVEX_URL` | — (auto) | Injected by `convex deploy --cmd` during the Vercel build; do not set manually |
| `NEXT_PUBLIC_VERCEL_ENV` | — (auto) | Vercel system var (needs "expose system env vars" on); Sentry environment tag |

Convex prod env vars are listed in step 3 above. Local dev reads
`.env.local` (same server keys, plus `CONVEX_DEPLOYMENT` /
`NEXT_PUBLIC_CONVEX_URL` pointing at the dev deployment) and runs
`bun run dev`, which starts `server.js` with the WebSocket proxy.

Note the split: **bun is the package manager and script runner, Node is still
the runtime.** `dev` and `start` deliberately stay `node server.js` — Next's
dev server and the `ws` proxy rely on Node internals that Bun's runtime does
not fully implement, and the Convex CLI reads `process.versions.node` when it
bundles `"use node"` actions. Use `bun install` / `bun run`, not `bun server.js`.
