# Subtier revamp design (2026-05-03)

User authorized autonomous execution. This doc captures the design decisions made without an interactive review loop, so future sessions can audit what was built and why.

## Goals

1. Refresh the visual design of the public leaderboard, login, and admin pages.
2. Rename three categories: `Trident` → `Trident Box`, `Bed` → `Surface Mace`, `Manhunt` → `Shieldless UHC`.
3. Three-tier role system on user accounts:
   - **SuperAdmin** — exactly one, the bootstrap `admin` user. Cannot be created or revoked at runtime.
   - **Admin** — promoted from a `User` by the SuperAdmin. Can be demoted.
   - **User** — default for self-registered accounts. No admin UI access.
4. Self-service registration with email + password, gated behind:
   - A SuperAdmin-controlled toggle (`registrationEnabled`, default `false`).
   - Email verification via Resend before the account becomes usable.
5. Microsoft OAuth as an additional login provider, gated behind a SuperAdmin toggle and proper env config.
6. Admin-only tools for: editing/adding/deleting categories (cascades into entry data), bulk-friendly point/rank edits, and an optional "test server" tag on each entry.

## Non-goals

- No password reset flow yet (admin can manually update users.json or extend later).
- No 2FA, no audit log, no per-permission ACL — flat three-tier RBAC is sufficient.
- No public user profile page; registered users only get a "logged in" state in the header.
- No real-time updates (sockets, polling) beyond what already exists.

## Data model

### `data/users.json`
```
{
  id, username, email, passwordHash,
  role: "SuperAdmin" | "Admin" | "User",
  emailVerified: boolean,
  verifyToken: string|null,
  verifyExpires: ISO-string|null,
  oauthProvider: "microsoft" | null,
  oauthSubject: string | null,    // Microsoft tenant-stable id
  createdAt, updatedAt
}
```

Existing `admin` user is migrated in place: `role: 'admin'` → `role: 'SuperAdmin'`, `email` defaulted to a placeholder if missing, `emailVerified: true`. The `username` stays `admin`. `email` is unique among users (enforced at write time).

### `data/settings.json` (new)
```
{
  registrationEnabled: false,
  oauthEnabled: false,
  oauthMicrosoft: { clientId: "", tenant: "common" },
  migrations: { categoryRenames_v1: false, userSchema_v1: false }
}
```
Microsoft `clientSecret` lives in env, not on disk.

### `data/leaderboard.json` (entries)
Add an optional field: `testServer: string | null` (e.g., "Pico Test #3"). Existing entries get `testServer: null` on next read.

### Category storage
Stays per-entry inside `entry.categories`. The canonical key list is the union across all entries (matches today's behavior). Mutations:
- **Add**: walk all entries, set `categories[name] = null` if absent. Reject if name collides.
- **Rename**: walk all entries, copy value from old key to new key, delete old key. Reject if new name collides with another existing key.
- **Delete**: walk all entries, delete key.

The startup migration applies the three required renames once and flips `migrations.categoryRenames_v1`.

## Permissions matrix

| Action                                  | SuperAdmin | Admin | User | Anon |
| --------------------------------------- | :--------: | :---: | :--: | :--: |
| View public leaderboard                 |     ✓      |   ✓   |  ✓   |  ✓   |
| Register / log in                       |     —      |   —   |  ✓   |  ✓   |
| Add / edit / delete leaderboard entries |     ✓      |   ✓   |      |      |
| Edit player points/rank quickly         |     ✓      |   ✓   |      |      |
| Add / rename / delete categories        |     ✓      |   ✓   |      |      |
| Edit `testServer` on entries            |     ✓      |   ✓   |      |      |
| Promote/demote users (Admin)            |     ✓      |       |      |      |
| Toggle registration / OAuth             |     ✓      |       |      |      |
| Edit OAuth client id / tenant           |     ✓      |       |      |      |

## Routes (new + changed)

```
GET  /                          public leaderboard (existing, restyled)
GET  /login                     unified login page (admin password, user password, OAuth button if enabled)
POST /login                     password login (rate-limited)
GET  /register                  registration form (404 when disabled)
POST /register                  create unverified user, send verification code
GET  /verify                    verification form for emailed code
POST /verify                    consume verification code
POST /resend-verification       resend verification code for unverified user
POST /logout                    end session
GET  /auth/microsoft            redirect to Microsoft, sets PKCE/state in session
GET  /auth/microsoft/callback   complete code exchange, link or create user

GET  /admin                     dashboard (Admin+) — entries CRUD + quick edit
POST /admin/entries             create entry (Admin+)
POST /admin/entries/:id/update  full update (Admin+)
POST /admin/entries/:id/quick   quick patch: points/rank/testServer (Admin+)
POST /admin/entries/:id/delete  delete (Admin+)
GET  /admin/categories          category mgmt page (Admin+)
POST /admin/categories          add category (Admin+)
POST /admin/categories/rename   { from, to } (Admin+)
POST /admin/categories/delete   { name } (Admin+)
GET  /admin/users               user mgmt (SuperAdmin only)
POST /admin/users/:id/promote   set role=Admin (SuperAdmin)
POST /admin/users/:id/demote    set role=User (SuperAdmin)
POST /admin/users/:id/delete    delete user (SuperAdmin, cannot delete self)
GET  /admin/settings            settings page (SuperAdmin)
POST /admin/settings            save toggles + OAuth client config (SuperAdmin)
GET  /admin/export              CSV export (Admin+)
```

The legacy `/admin/login` is collapsed into `/login`. A redirect from `/admin/login` → `/login` keeps existing bookmarks working.

## Middleware

`requireAuth(req, res, next)` — must be logged in.
`requireRole(...allowedRoles)` — role gate. Use `requireRole('Admin', 'SuperAdmin')` for admin actions, `requireRole('SuperAdmin')` for sensitive ones.

## Email service (`src/services/emailService.js`)

Thin wrapper around `POST https://api.resend.com/emails`. Reads `RESEND_API_KEY` and `EMAIL_FROM` from env. Sender name "Subtier Staff", address `schale@bluearchive.site` (per spec). Exposes `sendVerificationEmail(toEmail, verifyUrl)`.

Failure handling: log error, surface a generic "邮件发送失败，请联系管理员" message. We do NOT retry; the user can request a fresh verification email from the login page.

## OAuth service (`src/services/oauthService.js`)

Microsoft identity platform v2.0, authorization code with PKCE. Reads `MS_OAUTH_CLIENT_ID` (also stored on settings.json so SuperAdmin can edit), `MS_OAUTH_CLIENT_SECRET` (env only), `MS_OAUTH_TENANT` (default `common`).

State + PKCE verifier are stashed in `req.session.oauthState`. Callback validates state, exchanges code, fetches `/v1.0/me` from Microsoft Graph for the email and `oid`. If a local user with matching email exists, link `oauthSubject`; otherwise create a new `User` with `emailVerified: true`.

If `oauthEnabled` is off OR client id/secret unset, the routes 404 and the login page hides the button.

## Token utility (`src/utils/tokens.js`)

`generateToken()` returns `crypto.randomBytes(32).toString('hex')`. Used for verify and PKCE.

## CSP and inline scripts

The current CSP forbids inline scripts. The new `login.ejs` (replaces existing) will move the spinner script into `public/main.js` so the policy stays clean. No CSP relaxation.

## CSRF

`csurf` continues to wrap everything. All new POST routes accept `_csrf`. The unified login form's password and OAuth submit both carry the token.

## UI design language

- Keep the existing dark-blue glass aesthetic but tighten it: bigger radii on the hero, cleaner table rows, accent-color underline on active nav, dedicated empty/loading states.
- Add a sticky top nav with role-aware links: SuperAdmin sees Settings + Users + Categories; Admin sees Categories + Dashboard; User sees logout.
- New shared "form-card" pattern for register/login/verify pages, reused for admin sub-pages.
- The leaderboard table gets clearer column headers, animated rank icons stay, and a small badge appears next to entries with a `testServer` tag.

## Verification

- `npm start` boots without errors, migrations run idempotently.
- All public routes return 200; admin routes return 302 → /login when unauthenticated.
- Manual smoke test against `http://localhost:<PORT>`:
  - Old `admin` login still works; sees Settings + Users + Categories.
  - With `registrationEnabled=true`, register a user, receive email (or capture log), follow link, log in.
  - Promote that user to Admin, verify Categories page accessible, Settings hidden.
  - Rename category, observe leaderboard updates.
  - OAuth path skipped unless real client id/secret available (deferred manual test).

## Risks and known limitations

- The hard-coded fallback `DEFAULT_ADMIN.username = 'adminstrator'` in source is replaced. The actual on-disk admin row stays as `username: 'admin'` (verified in `data/users.json`).
- Resend's free tier may rate-limit; we don't currently queue retries.
- Microsoft OAuth requires real client id / secret to fully work; without them the toggle becomes a no-op.
- Sessions are stored on disk via `FileSessionStore` in `data/sessions.json`. Restart keeps sessions; deleting the file logs everyone out.
- The shared Resend API key was pasted in the conversation — it lives in `.env` (gitignored) but the user should rotate it.
