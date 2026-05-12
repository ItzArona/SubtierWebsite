# Public read-only API (`/api/v1/`)

**Date:** 2026-05-12
**Status:** Approved, ready for implementation plan
**Goal:** Expose four read-only JSON endpoints under `/api/v1/` so that external bots (Discord bots, scrapers, mirror sites) can query the leaderboard without screen-scraping the EJS pages.

## Scope

In scope:
- Four GET endpoints (gamemodes list, overall rankings, gamemode rankings grouped by tier, single player).
- Per-IP rate limiting.
- Permissive CORS (`*`).
- JSON error envelope.
- CLAUDE.md section documenting the public API.

Out of scope:
- Write endpoints. The API is strictly read-only.
- API key authentication. The data is already public on the SSR pages.
- Automated tests. Project has no test framework; verification is manual curl.
- Versioning machinery beyond the `/v1` URL prefix.

## Architecture

**New file:** `src/routes/api.js` — exports an `express.Router()`. Pulls data exclusively through `dataStore.getLeaderboard()`, so it shares the in-memory cache with the rest of the app. No new disk I/O.

**`src/server.js` changes:**

1. Define `apiLimiter` (60 req/min/IP) next to the existing `mailIpLimiter` and `loginLimiter`.
2. Define `apiCors` middleware (~10 lines, hand-written, no new dependency).
3. Mount the API router **before** `app.use(csrfProtection)`:
   ```js
   app.use('/api/v1', apiCors, apiLimiter, require('./routes/api'));
   ```
   Mounting order is load-bearing: once `csurf` runs, it issues a `_csrf` cookie on every request including GETs, and its error handler returns HTML. By mounting in front of it, the API never participates in CSRF.

**Inside `src/routes/api.js`:**
- One `router.get(...)` per endpoint.
- A dedicated 4-arg error handler at the end of the router that always returns JSON `{ error, message }`. This must be in `api.js`, not in `server.js`, so that API errors don't fall through to the HTML error handler.

**No new dependencies.** CORS is hand-written; rate limiting reuses `express-rate-limit` already in the tree; validation reuses `zod`.

## Endpoints

### 1. `GET /api/v1/gamemodes`

- **Params:** none.
- **200:**
  ```json
  { "gamemodes": ["Cart", "Creeper", "DiaCrystal", "DiamondSMP", "Elytra", "LifeStealSMP", "PIT", "Shieldless UHC", "Spear", "Spear Mace", "Speed", "Surface Mace", "Trident Box"] }
  ```
- **Source:** union of every entry's `categories` keys, sorted by `localeCompare`. Same logic as `categoryService.listCategories()` — call it directly to avoid duplication.

### 2. `GET /api/v1/rankings`

- **Query:** `limit` (1..200, default 50), `offset` (>=0, default 0).
- **200:**
  ```json
  {
    "total": 123,
    "limit": 50,
    "offset": 0,
    "players": [
      { "name": "SharkIrene", "points": 20, "rank": "SubtierCadet", "position": 1 }
    ]
  }
  ```
- **Sort:** ascending by `entry.position`.
- **400** `invalid_query` if `limit`/`offset` fail the zod check.
- **No `testServer`** in the response object — that column is a placeholder until the field gets populated.

### 3. `GET /api/v1/rankings/:gamemode`

- **Path:** `gamemode` is URL-encoded; lookup is case-insensitive against the set of existing gamemode names.
- **Query:** `count` (1..50, default 10), `offset` (>=0, default 0). `offset` applies **per-bucket**, not globally.
- **200:**
  ```json
  {
    "gamemode": "Spear",
    "count": 10,
    "offset": 0,
    "tiers": {
      "1": [
        { "name": "playerA", "points": 42, "rank": "SubtierVeteran", "position": 4, "tier": "HT1" }
      ],
      "2": [],
      "3": [],
      "4": [],
      "5": []
    }
  }
  ```
- **Tier parsing:** `/^(HT|LT)([1-5])$/i`. Match → bucket by the digit (1–5); preserve the canonical uppercase form in the `tier` field. Non-match → `console.warn` and skip the entry (defensive against future bad data).
- **Bucket sort:** HT before LT, then `points` desc, then `name` asc (`localeCompare`).
- **Empty buckets:** always present in the response with `[]` (predictable shape for bot parsers).
- **404** `gamemode_not_found` if the gamemode name doesn't match any existing gamemode (case-insensitive).

### 4. `GET /api/v1/players/:name`

- **Path:** player name, case-insensitive (matches `findUserByUsername` semantics but operates on `leaderboard.json` `player` field, not `users.json`).
- **200:**
  ```json
  {
    "name": "SharkIrene",
    "points": 20,
    "rank": "SubtierCadet",
    "position": 1,
    "categories": {
      "Spear": null,
      "Cart": "HT3",
      "DiamondSMP": "HT3"
    }
  }
  ```
- `categories` includes **every known gamemode key** (union across all entries). Player's missing entries → `null`. This guarantees bots can render a full table without an extra `/gamemodes` call.
- **404** `not_found` if no entry's `player` field matches case-insensitively.

## Cross-cutting

**Rate limit:**
```js
const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false },
  handler: (req, res) => {
    const reset = req.rateLimit && req.rateLimit.resetTime;
    const retryAfter = reset ? Math.max(1, Math.ceil((reset.getTime() - Date.now()) / 1000)) : 60;
    res.setHeader('Retry-After', String(retryAfter));
    res.status(429).json({ error: 'rate_limited', message: `too many requests, retry after ${retryAfter} seconds` });
  }
});
```

**CORS middleware:**
```js
function apiCors(req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
}
```

**Validation:** add to `src/utils/validation.js`:
- `apiListPaginationSchema` — `{ limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) }`
- `apiTierPaginationSchema` — `{ count: z.coerce.number().int().min(1).max(50).default(10), offset: z.coerce.number().int().min(0).default(0) }`
- `apiGamemodeNameSchema` — `z.string().trim().min(1).max(64)`
- `apiPlayerNameSchema` — `z.string().trim().min(1).max(64)`

**Error envelope** is uniform `{ error: "<code>", message: "<human readable>" }`. Codes:
| HTTP | error | Triggered by |
|---|---|---|
| 400 | `invalid_query` | zod parse fails on query or path params |
| 404 | `not_found` | player not found |
| 404 | `gamemode_not_found` | gamemode not found |
| 429 | `rate_limited` | IP hits the limiter |
| 500 | `internal_error` | unhandled exception (logged via `console.error`) |

**Caching headers:** `Cache-Control: public, max-age=60` on 2xx responses. The dataStore already caches in memory; this header just helps CDN/proxy layers in front of the app.

## Files touched

| File | Change |
|---|---|
| `src/routes/api.js` | **NEW.** Router + handlers + JSON error handler. |
| `src/server.js` | Add `apiLimiter`, `apiCors`, mount the router before csurf. |
| `src/utils/validation.js` | Add 4 new zod schemas listed above. |
| `CLAUDE.md` | New section `## Public API (read-only)` covering endpoint list, mount order constraint, and the rate limit. |
| `README.md` | Append a brief "External API" section with a few curl examples. |

## Manual verification

After implementation, run these from a second terminal while `npm run dev` is up:

```bash
curl -s http://localhost:3000/api/v1/gamemodes | jq
curl -s 'http://localhost:3000/api/v1/rankings?limit=5' | jq
curl -s 'http://localhost:3000/api/v1/rankings/Cart?count=5' | jq
curl -s http://localhost:3000/api/v1/players/SharkIrene | jq
# Edge cases
curl -i http://localhost:3000/api/v1/rankings/NotAGamemode    # expect 404 gamemode_not_found
curl -i http://localhost:3000/api/v1/players/nobody           # expect 404 not_found
curl -i 'http://localhost:3000/api/v1/rankings?limit=999'     # expect 400 invalid_query
for i in $(seq 1 65); do curl -s -o /dev/null -w "%{http_code} " http://localhost:3000/api/v1/gamemodes; done  # expect 429 near the end
curl -i -H 'Origin: https://example.com' http://localhost:3000/api/v1/gamemodes | grep -i 'access-control'    # CORS headers present
```

## Decisions worth recording

- **Tier bucketing is 5, not 10.** HT and LT of the same tier number share a bucket; the original `tier` string is preserved in each player object so bots that care about the HT/LT split still have it.
- **Per-bucket offset, not flat offset.** Lets bots ask for "the next 10 of each tier" without re-shuffling.
- **No `id`, `createdAt`, `updatedAt`, `testServer` in any response.** `id` is internal, timestamps are uninteresting to bots, `testServer` is unpopulated placeholder data right now.
- **Case-insensitive lookups** for both gamemode and player names. Matches the existing `findUserByUsername` lenient style.
- **Mount-before-csurf** is the linchpin of the architecture. Without it, every API GET issues a CSRF cookie, and error responses become HTML.
