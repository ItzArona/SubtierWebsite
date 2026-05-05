# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install            # install deps
npm run dev            # nodemon, auto-reload on changes (src/server.js)
npm start              # production mode
npm test               # node --test (no test files currently exist)
```

No linter or formatter is configured. The app uses Node's built-in `fetch` (so Node 18+ is required) and has **no separate SDKs for Resend or Microsoft OAuth**. Don't add `resend`, `passport`, etc. unless asked — both integrations are intentionally hand-rolled with `fetch`.

To exercise locally, copy `.env.example` → `.env`. The most load-bearing env vars beyond the obvious ones are `APP_BASE_URL` (used to build the email-verification link, so wrong value = broken activation), `RESEND_API_KEY` (without it, registration crashes when settings.registrationEnabled is true), and `MS_OAUTH_CLIENT_SECRET` (must be in env, never on disk).

## Architecture overview

Single Express 5 app rendering EJS server-side, backed by three JSON files in `data/`. All routes live inline in `src/server.js`; route ordering is grouped by section (`Public`, `Auth`, `Admin: dashboard`, `Admin: entries`, `Admin: categories`, `Admin: settings`, `Admin: users`).

### Bootstrap order matters (`src/server.js` → `bootstrap()`)

1. `ensureDataDir()` — creates `data/`.
2. `getSettings()` — reads or creates `data/settings.json`.
3. `getUsers()` — reads `data/users.json`; **idempotently migrates legacy rows** (role `'admin'` → `'SuperAdmin'`, fills missing `email`/`emailVerified`/`passwordResetToken`/`passwordResetExpires`/`mailCooldown`/etc.) and writes back if changed. Also seeds the bootstrap admin from `ADMIN_USERNAME`/`ADMIN_PASSWORD` env vars when the file is empty.
4. `importExcelIfNeeded()` — bootstrap-imports `1.9+Subtier Overall(1).xlsx` only when leaderboard is empty.
5. `ensureRequiredRenames()` — applies the one-time category renames (`Trident → Trident Box`, `Bed → Surface Mace`, `Manhunt → Shieldless UHC`) and flips `settings.migrations.categoryRenames_v1`. Skipped on subsequent boots.
6. `app.listen(PORT)`.

Sessions are persisted to `data/sessions.json` via `FileSessionStore` (`src/services/sessionFileStore.js`). The store auto-creates the file on first write and lazy-sweeps expired entries on `set`. Restart no longer logs everyone out — but if you delete `sessions.json` everyone is logged out on next read.

If you add another migration, follow the same pattern: gate it on a flag in `settings.migrations`, mutate via the dataStore service, flip the flag through `saveSettings`.

### Data layer (`src/services/dataStore.js`)

Three caches (`cachedLeaderboard`, `cachedUsers`, `cachedSettings`) populated lazily. **Anything that mutates `data/*.json` outside this module must call `invalidateCache()` or restart**, otherwise stale reads.

All writes go through a single-flight `writeQueue` with the `tempfile + rename` atomic pattern. Don't call `fs.writeFile` on `data/*.json` directly — use `saveLeaderboard` / `saveUsers` / `saveSettings` / `upsertUser` / `deleteUser`.

`saveSettings(partial)` deep-merges using `mergeSettings`; pass only the fields you want to change. The merge is intentionally permissive about types, so callers must pre-validate (the routes do, via zod in `src/utils/validation.js`).

Constants exported by dataStore (`SUPER_ADMIN_USERNAME`, `LEADERBOARD_FILE`, etc.) are the canonical references — don't reconstruct paths inline.

### Three-tier RBAC

Roles live on the user record: `SuperAdmin` | `Admin` | `User`.

- **SuperAdmin** — exactly one. By convention it is the user whose `username === SUPER_ADMIN_USERNAME` (driven by `ADMIN_USERNAME` env). `getUsers()` enforces the invariant: if the env-named admin exists but isn't `SuperAdmin`, it's promoted; if no SuperAdmin exists at all, the env admin is created. SuperAdmin **cannot be demoted, deleted, or renamed at runtime**; the route handlers explicitly reject attempts (`cannot_modify_super`).
- **Admin** — promoted from `User` by SuperAdmin. Demotable, deletable.
- **User** — default for self-registration and OAuth-created accounts.

Middleware in `src/middleware/auth.js`:
- `requireAuth` — must be logged in (redirects unauthenticated to `/login`, not `/admin/login`).
- `requireAdminOrAbove` — gates entry/category routes. Use this for anything that mutates leaderboard data.
- `requireSuperAdmin` — gates settings + user-management routes.

Don't sprinkle inline role checks; reuse the middleware. The 403 path renders `views/error.ejs`, not a redirect.

### Auth flow

`/admin/login` is a 302 to `/login`; the unified `/login` accepts username **or** email plus password. Successful login regenerates the session (anti-fixation) and stashes only `{ id, username, email, role }` (`publicUser`). Never put password hashes or tokens on the session object.

Registration (`POST /register`) is gated by `settings.registrationEnabled`. If disabled, the GET returns 404 and the nav hides the Register link. When enabled, registration creates a `User` row with `emailVerified: false`, generates a 32-byte hex `verifyToken` with **5-minute** expiry (`VERIFY_TTL_MS`), and sends the verification email **before** persisting the row — if the Resend call fails, no user is written. The verify endpoint (`GET /verify-email?token=...`) checks expiry and uses `timingSafeEqualString` for the comparison; on failure it renders `views/verify-result.ejs` with a "重发验证邮件" link rather than a dead-end error page.

`POST /resend-verification` re-issues a fresh token + email; `POST /forgot` issues a password-reset email; `GET /reset?token=...` + `POST /reset` consume it. Reset tokens also expire in 5 minutes (`RESET_TTL_MS`). Forgot is a no-op for SuperAdmin (cannot be reset via email — change `ADMIN_PASSWORD` env then reseed via empty `data/users.json` if you really need it).

Login refuses unverified users unless their role is `SuperAdmin` (so the bootstrap admin can always log in even if `emailVerified` somehow isn't set).

### Mail rate limiting

Two layers, both required:

- **IP rate limit** (`mailIpLimiter`): 4 mail-sending POSTs per 60s per IP (covers `/register`, `/forgot`, `/resend-verification`). `validate: { trustProxy: false }` is set so `app.set('trust proxy', true)` (kept for Cloudflare Tunnel) doesn't trip the validator. If you ever expose the app directly to the internet, narrow `trust proxy` to a specific hop count or CIDR.
- **Per-user, per-operation cooldown** (`src/services/mailCooldown.js`): 30s between sends of the same operation on the same user. Tracked in `user.mailCooldown[op]` (ISO timestamp). Helpers: `isCooledDown(user, op)` (true means the cooldown has elapsed and a new send is allowed), `remainingCooldownSeconds(user, op)`, `stampMailSent(user, op)`. Always check before send and stamp after a successful send.

The naming of `isCooledDown` is counter-intuitive — read it as "has cooled down enough" / "is ready to send again", not "is currently in cooldown". Routes use `if (!isCooledDown(...)) return 429`.

### Microsoft OAuth (login + linking)

Two flows share `oauthService.js` but use **separate callback URLs** to avoid mode-confusion in `req.session.oauthState`:

- **Login flow**: `GET /auth/microsoft` → Microsoft → `GET /auth/microsoft/callback`. Matches user by `oauthSubject`, falls back to email; creates a new `User` row with `passwordHash: null` if neither matches.
- **Link flow**: `GET /account/link/microsoft` (auth required) → Microsoft → `GET /account/link/microsoft/callback`. Refuses if the Microsoft `subject` is already bound to another local account (`error=subject_taken`). Sets `oauthProvider: 'microsoft'`, `oauthSubject`, and forces `emailVerified: true` on the current user.
- **Unlink**: `POST /account/unlink/microsoft`. Refuses with `error=needs_password` when the user has no `passwordHash` (would lock them out). Clears provider/subject only.

`buildAuthUrl({ baseUrl, mode })` picks the right `redirect_uri` based on `mode` (`'login'` or `'link'`). The session stash records the mode and the callback validates it — a state with the wrong mode is rejected as if it were missing.

Both flows are gated by `isMicrosoftEnabled()` (settings toggle + client_id present anywhere + `MS_OAUTH_CLIENT_SECRET` in env). When unavailable, login flow routes 404, link flow redirects back to `/account?error=oauth_disabled`, and the buttons on `/login` and `/account` are hidden.

### Entry data

```
{ id, position, player, rank, points, testServer, categories: { [name]: string|null }, createdAt, updatedAt }
```

`testServer` is an optional string field (e.g., "Pico Test #3"); empty string normalizes to `null`. `position` is **not** unique and **not** the key — always look up by `id`.

There are two write endpoints per entry on purpose:
- `POST /admin/entries/:id/update` — full replace, including categories (uses `parseCategoryPayload` to harvest `category__*` fields).
- `POST /admin/entries/:id/quick` — partial patch of `{ points, rank, testServer }` only. Only the fields actually present in the body are updated; categories are untouched. The quick-edit form on the dashboard sends all three but the route is robust to subsets.

When adding more entry fields, prefer extending the quick-edit shape (and `quickEditSchema`) rather than overloading the full update.

### Category management

Categories are the union of keys present in `entry.categories` across all entries (no separate registry). Mutations live in `src/services/categoryService.js` and **walk every entry**:

- `addCategory(name)` — sets `categories[name] = null` on every entry. Rejects duplicates.
- `renameCategory(from, to)` — copies value, deletes old key. Rejects when target exists.
- `deleteCategory(name)` — removes key from every entry.

Errors are thrown with `error.code` of `CATEGORY_EXISTS` or `CATEGORY_NOT_FOUND`; routes redirect with the code in the query string and the view maps to user-facing strings. Keep this contract when adding new operations.

### CSP and front-end events

Helmet's CSP defaults are kept (script-src 'self', script-src-attr 'none'), so **inline event handlers like `onclick`/`onsubmit` are blocked**. Use the `data-confirm="..."` attribute on forms instead — `public/main.js` has a global submit listener that intercepts, runs `window.confirm`, and prevents default if cancelled. There is also a global submit handler that puts the login button into a "登录中…" state when `#loginForm` submits.

Do not relax CSP without a strong reason. If you need a one-off inline script, move it into `public/main.js` instead.

### Validation contract

All POST bodies are validated with zod schemas in `src/utils/validation.js`. On failure, admin endpoints typically redirect to `?error=<code>` and the page maps the code to a Chinese string at render time — both the route and the view must stay in sync when adding new error codes. The zod schemas use `.transform()` to normalize empty-string fields (e.g. `testServer`) to `null`; don't strip empty strings yourself.

### Things that look optional but aren't

- `APP_BASE_URL` is used to construct the verify-email link, the reset-password link, and the OAuth redirect URI. Wrong here = email links 404 and OAuth callback rejected by Microsoft.
- `EMAIL_FROM` must use the RFC 5322 form `"Display Name <addr@domain>"` and the domain must be verified in Resend, otherwise sends 4xx.
- `trust proxy` is on so the rate limiter sees real IPs from `X-Forwarded-For` (Cloudflare Tunnel deployment). Each `rateLimit()` carries `validate: { trustProxy: false }` to suppress the express-rate-limit warning. If you ever expose the app without a trusted proxy in front, narrow `trust proxy` accordingly.
- Sessions live in `data/sessions.json` (`FileSessionStore`). Restart no longer logs everyone out. The store atomically writes via tempfile+rename and serialises writes through its own queue; do not write `data/sessions.json` from anywhere else.

### Spec record

`docs/superpowers/specs/2026-05-03-subtier-revamp-design.md` captures the design rationale for the user accounts + roles + OAuth + UI revamp. Read it if you need context on why the user model has the shape it does or why the SuperAdmin invariant is enforced where it is.
