# Public API (/api/v1/) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four read-only JSON endpoints under `/api/v1/` so external bots can query the leaderboard without scraping EJS pages.

**Architecture:** New file `src/routes/api.js` exporting an `express.Router()`, mounted in `src/server.js` **before** `app.use(csrfProtection)`. Router has its own JSON error handler so API errors never fall through to EJS error pages. All data reads go through the existing `dataStore.getLeaderboard()` cache. Per-IP rate limit (60/min). Permissive CORS for `/api/*`.

**Tech Stack:** Express 5, `express-rate-limit@^8.3.2`, `zod@^4.3.6` (all already in `package.json`). No new dependencies. Manual `curl` verification per the spec; no automated test framework is being added.

**Spec:** [`docs/superpowers/specs/2026-05-12-public-api-design.md`](../specs/2026-05-12-public-api-design.md)

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/routes/api.js` | CREATE | Router + 4 handlers + JSON error handler. No persistence; reads via `dataStore.getLeaderboard()` and `categoryService.listCategories()`. |
| `src/server.js` | MODIFY | Define `apiLimiter` and `apiCors`; mount router at `/api/v1` before csurf. |
| `src/utils/validation.js` | MODIFY | Add 4 zod schemas for API query/path params. |
| `CLAUDE.md` | MODIFY | New section `## Public API (read-only)` covering endpoints, mount-order constraint, rate limit. |
| `README.md` | MODIFY | New section `## External API` with curl examples. |

## Workflow assumption

Throughout implementation, keep `npm run dev` running in a separate terminal. Nodemon reloads on file save. Run curl from a third terminal.

---

### Task 1: Add zod schemas for API params

**Files:**
- Modify: `src/utils/validation.js` (append before `module.exports`)
- Modify: `src/utils/validation.js` (extend the `module.exports` block)

- [ ] **Step 1: Add the four schemas above `module.exports`**

Insert this block right before the existing `module.exports = {` line:

```js
const apiListPaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0)
});

const apiTierPaginationSchema = z.object({
  count: z.coerce.number().int().min(1).max(50).default(10),
  offset: z.coerce.number().int().min(0).default(0)
});

const apiGamemodeNameSchema = z.string().trim().min(1).max(64);
const apiPlayerNameSchema = z.string().trim().min(1).max(64);
```

- [ ] **Step 2: Export them**

In the existing `module.exports = { ... };` add these four names to the exported object:

```js
  apiListPaginationSchema,
  apiTierPaginationSchema,
  apiGamemodeNameSchema,
  apiPlayerNameSchema,
```

- [ ] **Step 3: Smoke-test the schemas in a node one-liner**

Run:
```bash
node -e "
const v = require('./src/utils/validation');
console.log(v.apiListPaginationSchema.safeParse({}).data);
console.log(v.apiListPaginationSchema.safeParse({ limit: '5', offset: '10' }).data);
console.log(v.apiListPaginationSchema.safeParse({ limit: 999 }).success);
console.log(v.apiTierPaginationSchema.safeParse({}).data);
console.log(v.apiTierPaginationSchema.safeParse({ count: 51 }).success);
"
```

Expected output:
```
{ limit: 50, offset: 0 }
{ limit: 5, offset: 10 }
false
{ count: 10, offset: 0 }
false
```

- [ ] **Step 4: Commit**

```bash
git add src/utils/validation.js
git commit -m "feat(api): add zod schemas for public API pagination and path params"
```

---

### Task 2: Scaffold `src/routes/api.js` with `/gamemodes` + wire into server.js

**Files:**
- Create: `src/routes/api.js`
- Modify: `src/server.js` (add limiter + CORS + mount before csurf)

- [ ] **Step 1: Create `src/routes/api.js` with the gamemodes endpoint and error scaffolding**

Full file content:

```js
const express = require('express');
const { listCategories } = require('../services/categoryService');

const router = express.Router();

router.use((req, res, next) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  next();
});

function sendCached(res, body) {
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.json(body);
}

router.get('/gamemodes', async (req, res, next) => {
  try {
    const gamemodes = await listCategories();
    sendCached(res, { gamemodes });
  } catch (err) { next(err); }
});

// 404 inside /api/v1 — anything not matched above is unknown
router.use((req, res) => {
  res.status(404).json({ error: 'not_found', message: `route '${req.method} ${req.originalUrl}' does not exist` });
});

// JSON error handler — must have 4 args
// eslint-disable-next-line no-unused-vars
router.use((err, req, res, next) => {
  console.error('[api]', err && err.stack ? err.stack : err);
  res.status(500).json({ error: 'internal_error', message: 'unexpected server error' });
});

module.exports = router;
```

- [ ] **Step 2: In `src/server.js`, add `apiLimiter` and `apiCors`**

Insert these blocks immediately after the existing `mailIpLimiter` definition (after line 137):

```js
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
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

function apiCors(req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
}
```

- [ ] **Step 3: Mount the router BEFORE csurf**

In `src/server.js`, find these two lines:
```js
const csrfProtection = csurf();
app.use(csrfProtection);
```

Insert this **immediately above** them:
```js
app.use('/api/v1', apiCors, apiLimiter, require('./routes/api'));
```

Mount order is load-bearing: if `csurf` sees the request first, it issues a `_csrf` cookie on every GET and routes errors to the HTML handler. Mounting in front of it keeps the API stateless.

- [ ] **Step 4: Save files; verify nodemon reloads cleanly**

Watch the terminal running `npm run dev`. Expect:
```
[nodemon] restarting due to changes...
SubtierWebsite started on http://localhost:3000
```

If nodemon prints an error (e.g., `Cannot find module './routes/api'`), check file path and re-save.

- [ ] **Step 5: Verify `/gamemodes` works**

Run:
```bash
curl -s http://localhost:3000/api/v1/gamemodes
```

Expected: a JSON object whose `gamemodes` array contains entries like `"Cart"`, `"DiamondSMP"`, `"Spear"`, sorted alphabetically.

Also verify headers:
```bash
curl -sI http://localhost:3000/api/v1/gamemodes
```

Expected to include:
- `Content-Type: application/json; charset=utf-8`
- `Cache-Control: public, max-age=60`
- `RateLimit-Policy: 60;w=60`
- `RateLimit-Remaining: 59` (or lower)
- **No** `Set-Cookie: _csrf=...` line (proof we're mounted before csurf)

- [ ] **Step 6: Verify CORS preflight**

```bash
curl -sI -X OPTIONS -H 'Origin: https://example.com' -H 'Access-Control-Request-Method: GET' http://localhost:3000/api/v1/gamemodes
```

Expected: `HTTP/1.1 204 No Content`, with `Access-Control-Allow-Origin: *` present.

- [ ] **Step 7: Verify 404 for unknown sub-routes**

```bash
curl -s http://localhost:3000/api/v1/does-not-exist
```

Expected:
```json
{"error":"not_found","message":"route 'GET /api/v1/does-not-exist' does not exist"}
```

- [ ] **Step 8: Commit**

```bash
git add src/routes/api.js src/server.js
git commit -m "feat(api): add /api/v1 router with /gamemodes endpoint, CORS, rate limit"
```

---

### Task 3: Add `GET /api/v1/rankings`

**Files:**
- Modify: `src/routes/api.js` (add handler before the 404 catch-all)

- [ ] **Step 1: Add imports at the top of `src/routes/api.js`**

Change the imports block to:

```js
const express = require('express');
const { getLeaderboard } = require('../services/dataStore');
const { listCategories } = require('../services/categoryService');
const { apiListPaginationSchema } = require('../utils/validation');
```

- [ ] **Step 2: Add a small helper for the compact player object**

Insert after `function sendCached(...)`:

```js
function compactPlayer(entry) {
  return {
    name: entry.player,
    points: entry.points,
    rank: entry.rank,
    position: entry.position
  };
}
```

- [ ] **Step 3: Add the `/rankings` handler before the `router.use((req, res) => ...)` 404 catch-all**

```js
router.get('/rankings', async (req, res, next) => {
  try {
    const parsed = apiListPaginationSchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_query', message: parsed.error.issues[0].message });
    }
    const { limit, offset } = parsed.data;
    const entries = await getLeaderboard();
    const sorted = [...entries].sort((a, b) => a.position - b.position);
    const players = sorted.slice(offset, offset + limit).map(compactPlayer);
    sendCached(res, {
      total: sorted.length,
      limit,
      offset,
      players
    });
  } catch (err) { next(err); }
});
```

- [ ] **Step 4: Verify happy path**

```bash
curl -s 'http://localhost:3000/api/v1/rankings?limit=3'
```

Expected: JSON with `total` > 0, `limit: 3`, `offset: 0`, and a `players` array of length 3. Each player has exactly `name`, `points`, `rank`, `position` — and **no** `testServer`, `id`, `categories`.

- [ ] **Step 5: Verify offset works**

```bash
curl -s 'http://localhost:3000/api/v1/rankings?limit=2&offset=0' | grep -o '"name":"[^"]*"'
curl -s 'http://localhost:3000/api/v1/rankings?limit=2&offset=2' | grep -o '"name":"[^"]*"'
```

Expected: different sets of names, no overlap.

- [ ] **Step 6: Verify validation rejects bad input**

```bash
curl -s -o /dev/null -w '%{http_code}\n' 'http://localhost:3000/api/v1/rankings?limit=999'
curl -s 'http://localhost:3000/api/v1/rankings?limit=abc'
```

Expected: `400` for the first command. Second command returns `{"error":"invalid_query",...}` because `abc` fails `z.coerce.number()`.

- [ ] **Step 7: Commit**

```bash
git add src/routes/api.js
git commit -m "feat(api): add GET /api/v1/rankings (overall leaderboard)"
```

---

### Task 4: Add `GET /api/v1/rankings/:gamemode`

**Files:**
- Modify: `src/routes/api.js` (extend imports + add tier parser + handler)

- [ ] **Step 1: Extend imports**

Change the imports block to:

```js
const express = require('express');
const { getLeaderboard } = require('../services/dataStore');
const { listCategories } = require('../services/categoryService');
const { apiListPaginationSchema, apiTierPaginationSchema, apiGamemodeNameSchema } = require('../utils/validation');
```

- [ ] **Step 2: Add tier-parsing helper after `compactPlayer`**

```js
const TIER_RE = /^(HT|LT)([1-5])$/i;

function parseTier(raw) {
  if (typeof raw !== 'string') return null;
  const m = TIER_RE.exec(raw.trim());
  if (!m) return null;
  const half = m[1].toUpperCase(); // 'HT' or 'LT'
  const major = Number(m[2]);
  return { canonical: `${half}${major}`, half, major };
}
```

- [ ] **Step 3: Quick sanity check the regex with `node -e`**

```bash
node -e "const RE=/^(HT|LT)([1-5])$/i; for (const s of ['HT1','lt4','LT3','Veteran','HT6','ht 1','']) { const m=RE.exec(s); console.log(s.padEnd(10), m?[m[1].toUpperCase(),m[2]]:'null'); }"
```

Expected:
```
HT1        [ 'HT', '1' ]
lt4        [ 'LT', '4' ]
LT3        [ 'LT', '3' ]
Veteran    null
HT6        null
ht 1       null
           null
```

- [ ] **Step 4: Add the `/rankings/:gamemode` handler before the 404 catch-all**

```js
router.get('/rankings/:gamemode', async (req, res, next) => {
  try {
    const nameParse = apiGamemodeNameSchema.safeParse(req.params.gamemode);
    const queryParse = apiTierPaginationSchema.safeParse(req.query);
    if (!nameParse.success || !queryParse.success) {
      const msg = !nameParse.success ? nameParse.error.issues[0].message : queryParse.error.issues[0].message;
      return res.status(400).json({ error: 'invalid_query', message: msg });
    }
    const { count, offset } = queryParse.data;

    const allGamemodes = await listCategories();
    const requested = nameParse.data.toLowerCase();
    const canonicalName = allGamemodes.find((g) => g.toLowerCase() === requested);
    if (!canonicalName) {
      return res.status(404).json({ error: 'gamemode_not_found', message: `gamemode '${nameParse.data}' does not exist` });
    }

    const entries = await getLeaderboard();
    const buckets = { '1': [], '2': [], '3': [], '4': [], '5': [] };

    for (const entry of entries) {
      const raw = entry.categories && entry.categories[canonicalName];
      if (raw == null) continue;
      const tier = parseTier(raw);
      if (!tier) {
        console.warn(`[api] unparseable tier "${raw}" on player "${entry.player}" in gamemode "${canonicalName}"`);
        continue;
      }
      buckets[String(tier.major)].push({
        ...compactPlayer(entry),
        tier: tier.canonical,
        _half: tier.half
      });
    }

    const tiers = {};
    for (const k of Object.keys(buckets)) {
      const sorted = buckets[k].sort((a, b) => {
        if (a._half !== b._half) return a._half === 'HT' ? -1 : 1; // HT before LT
        if (b.points !== a.points) return b.points - a.points;     // points desc
        return String(a.name).localeCompare(String(b.name));        // name asc
      });
      tiers[k] = sorted.slice(offset, offset + count).map(({ _half, ...rest }) => rest);
    }

    sendCached(res, {
      gamemode: canonicalName,
      count,
      offset,
      tiers
    });
  } catch (err) { next(err); }
});
```

- [ ] **Step 5: Verify happy path with a populated gamemode**

```bash
curl -s 'http://localhost:3000/api/v1/rankings/Cart?count=3'
```

Expected: JSON with `gamemode: "Cart"`, `count: 3`, `offset: 0`, and `tiers` keys `"1"` through `"5"`. At least one bucket has players. Each player has `name`, `points`, `rank`, `position`, `tier` (formatted `"HT1"`/`"LT1"`/etc.) — **no** `_half`, `testServer`, `id`.

- [ ] **Step 6: Verify case-insensitive gamemode lookup**

```bash
curl -s 'http://localhost:3000/api/v1/rankings/cart?count=1' | grep -o '"gamemode":"[^"]*"'
curl -s 'http://localhost:3000/api/v1/rankings/CART?count=1' | grep -o '"gamemode":"[^"]*"'
```

Expected both: `"gamemode":"Cart"` (canonical case preserved).

- [ ] **Step 7: Verify 404 for missing gamemode**

```bash
curl -s -w '\n%{http_code}\n' http://localhost:3000/api/v1/rankings/NotAGamemode
```

Expected:
```
{"error":"gamemode_not_found","message":"gamemode 'NotAGamemode' does not exist"}
404
```

- [ ] **Step 8: Verify bucket structure (5 always present, even when empty)**

```bash
curl -s http://localhost:3000/api/v1/rankings/Cart | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  const o=JSON.parse(s);
  console.log('tier keys:', Object.keys(o.tiers).sort());
});"
```

Expected: `tier keys: [ '1', '2', '3', '4', '5' ]` (all five present even if some are empty arrays).

- [ ] **Step 9: Verify within-tier sort (HT before LT)**

Pick a gamemode and tier known to contain both HT and LT entries (use `DiamondSMP`, tier 3 contains HT3 and LT3 from the leaderboard data):

```bash
curl -s 'http://localhost:3000/api/v1/rankings/DiamondSMP?count=10' | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  const o=JSON.parse(s);
  console.log('tier 3:', o.tiers['3'].map(p => p.tier + ' ' + p.name));
});"
```

Expected (if data has both HT3 and LT3 in DiamondSMP): all `HT3 …` entries appear before all `LT3 …` entries in the printed list.

- [ ] **Step 10: Commit**

```bash
git add src/routes/api.js
git commit -m "feat(api): add GET /api/v1/rankings/:gamemode with 5-tier bucketing"
```

---

### Task 5: Add `GET /api/v1/players/:name`

**Files:**
- Modify: `src/routes/api.js` (extend imports + handler)

- [ ] **Step 1: Extend imports**

Change the imports line to include `apiPlayerNameSchema`:

```js
const { apiListPaginationSchema, apiTierPaginationSchema, apiGamemodeNameSchema, apiPlayerNameSchema } = require('../utils/validation');
```

- [ ] **Step 2: Add the `/players/:name` handler before the 404 catch-all**

```js
router.get('/players/:name', async (req, res, next) => {
  try {
    const nameParse = apiPlayerNameSchema.safeParse(req.params.name);
    if (!nameParse.success) {
      return res.status(400).json({ error: 'invalid_query', message: nameParse.error.issues[0].message });
    }
    const wanted = nameParse.data.toLowerCase();

    const [entries, allGamemodes] = await Promise.all([getLeaderboard(), listCategories()]);
    const entry = entries.find((e) => String(e.player || '').toLowerCase() === wanted);
    if (!entry) {
      return res.status(404).json({ error: 'not_found', message: `player '${nameParse.data}' not found` });
    }

    const categories = {};
    for (const gm of allGamemodes) {
      const raw = entry.categories && entry.categories[gm];
      categories[gm] = raw == null ? null : String(raw);
    }

    sendCached(res, {
      ...compactPlayer(entry),
      categories
    });
  } catch (err) { next(err); }
});
```

- [ ] **Step 3: Verify happy path (use a name from your leaderboard)**

```bash
curl -s http://localhost:3000/api/v1/players/SharkIrene
```

Expected: JSON with `name: "SharkIrene"`, numeric `points`, string `rank`, numeric `position`, and a `categories` object that contains **every gamemode key** (some `null`, some tier strings like `"HT3"`). **No** `testServer`, `id`, or timestamps.

- [ ] **Step 4: Verify case-insensitive lookup**

```bash
curl -s http://localhost:3000/api/v1/players/sharkirene | grep -o '"name":"[^"]*"'
curl -s http://localhost:3000/api/v1/players/SHARKIRENE | grep -o '"name":"[^"]*"'
```

Expected both: `"name":"SharkIrene"` (original case preserved from the leaderboard).

- [ ] **Step 5: Verify 404**

```bash
curl -s -w '\n%{http_code}\n' http://localhost:3000/api/v1/players/no_such_player
```

Expected:
```
{"error":"not_found","message":"player 'no_such_player' not found"}
404
```

- [ ] **Step 6: Verify all-gamemodes coverage**

Pick a gamemode you know the player does NOT have (e.g., `SharkIrene` has no `Spear`):

```bash
curl -s http://localhost:3000/api/v1/players/SharkIrene | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  const o=JSON.parse(s);
  console.log('Spear:', o.categories.Spear);
  console.log('Cart:', o.categories.Cart);
  console.log('keys:', Object.keys(o.categories).length);
});"
```

Expected: `Spear: null`, `Cart: HT3` (or whatever the data is), and `keys:` equal to the number of gamemodes returned by `/gamemodes`.

- [ ] **Step 7: Commit**

```bash
git add src/routes/api.js src/utils/validation.js
git commit -m "feat(api): add GET /api/v1/players/:name"
```

---

### Task 6: Full edge-case sweep

**Files:** none modified — verification only.

- [ ] **Step 1: Run the full curl checklist from the spec**

```bash
curl -s http://localhost:3000/api/v1/gamemodes
curl -s 'http://localhost:3000/api/v1/rankings?limit=5'
curl -s 'http://localhost:3000/api/v1/rankings/Cart?count=5'
curl -s http://localhost:3000/api/v1/players/SharkIrene
```

All four return valid JSON without `error` field.

- [ ] **Step 2: Verify all 404 paths**

```bash
curl -s -w '\n%{http_code}\n' http://localhost:3000/api/v1/rankings/NotAGamemode
curl -s -w '\n%{http_code}\n' http://localhost:3000/api/v1/players/nobody
curl -s -w '\n%{http_code}\n' http://localhost:3000/api/v1/does-not-exist
```

All three are HTTP 404 with JSON bodies.

- [ ] **Step 3: Verify 400 paths**

```bash
curl -s -w '\n%{http_code}\n' 'http://localhost:3000/api/v1/rankings?limit=999'
curl -s -w '\n%{http_code}\n' 'http://localhost:3000/api/v1/rankings/Cart?count=999'
```

Both HTTP 400 with `{"error":"invalid_query",...}`.

- [ ] **Step 4: Trigger rate limit**

```bash
for i in $(seq 1 65); do
  curl -s -o /dev/null -w "%{http_code} " http://localhost:3000/api/v1/gamemodes
done
echo
```

Expected: a long run of `200`s followed by at least a few `429`s once you cross 60 requests in the minute. Inspect one 429 response body:
```bash
curl -s http://localhost:3000/api/v1/gamemodes
```
Should be the rate_limited JSON. Wait 60 seconds or restart nodemon to reset.

- [ ] **Step 5: Confirm csurf cookie is NOT set by API calls**

```bash
curl -sI http://localhost:3000/api/v1/gamemodes | grep -i '_csrf=' && echo "FAIL: csurf cookie present" || echo "OK: no _csrf cookie"
```

Expected: `OK: no _csrf cookie`. Session middleware may emit `subtier.sid` under some conditions — that's harmless — but **no `_csrf` cookie must appear**. csurf only emits its cookie when `req.csrfToken()` is invoked, and the API never invokes it.

For contrast, confirm csurf IS active on the main app:
```bash
curl -sI http://localhost:3000/login | grep -i '_csrf='
```
Expected: a `Set-Cookie: _csrf=...` line (proves csurf is wired up correctly on non-API routes).

- [ ] **Step 6: Confirm public routes still work (no regression)**

In a browser, visit:
- `http://localhost:3000/` — leaderboard renders.
- `http://localhost:3000/login` — login form renders, `<input name="_csrf">` is in the page source.

If either is broken, the mount order is wrong. Revisit Task 2 Step 3.

---

### Task 7: Update `CLAUDE.md` with API section

**Files:**
- Modify: `CLAUDE.md` (insert new section)

- [ ] **Step 1: Find the right insertion point**

Open `CLAUDE.md`. The new section goes **between** the existing `### Validation contract` section and the existing `### Things that look optional but aren't` section. (The flow goes: validation → API → environmental gotchas → spec record.)

- [ ] **Step 2: Insert the new section**

Add this section between those two existing sections:

```markdown
### Public read-only API (`/api/v1/`)

Four GET-only JSON endpoints for external bots, defined in `src/routes/api.js`:

- `GET /api/v1/gamemodes` — array of all gamemode names (union of `entry.categories` keys).
- `GET /api/v1/rankings?limit=&offset=` — overall leaderboard. `limit` 1..200 default 50.
- `GET /api/v1/rankings/:gamemode?count=&offset=` — gamemode rankings grouped into 5 tier buckets (`"1"`..`"5"`). `count` 1..50 default 10, applied **per bucket**. HT sorts before LT within each bucket. Gamemode lookup is case-insensitive; canonical case is returned in the response. Unparseable tier strings are logged and skipped.
- `GET /api/v1/players/:name` — single player; `categories` includes **every** known gamemode key with `null` for the ones the player has no tier in. Player lookup is case-insensitive.

All responses are `application/json; charset=utf-8`. Errors use the envelope `{ error: "<code>", message: "<text>" }` — codes are `invalid_query` (400), `not_found` / `gamemode_not_found` (404), `rate_limited` (429), `internal_error` (500). The `testServer` field is intentionally **not** surfaced (it's a placeholder column).

**Mount order is load-bearing.** In `src/server.js` the API is mounted **before** `app.use(csrfProtection)`:
```js
app.use('/api/v1', apiCors, apiLimiter, require('./routes/api'));
```
Otherwise csurf issues a `_csrf` cookie on every API GET and routes API errors through the HTML error handler. The API router has its own JSON error handler at the end; do not let API errors fall through to the EJS error handler in `server.js`.

`apiLimiter` is 60 req/min per IP (separate from `loginLimiter` and `mailIpLimiter`). `apiCors` is hand-rolled (no `cors` package) and emits `Access-Control-Allow-Origin: *`, `…-Methods: GET, OPTIONS`, with `OPTIONS` short-circuited to 204.

Spec: `docs/superpowers/specs/2026-05-12-public-api-design.md`. Plan: `docs/superpowers/plans/2026-05-12-public-api.md`.
```

- [ ] **Step 3: Visually verify the section renders correctly**

```bash
grep -n '^### ' CLAUDE.md
```

Expected: the section list now contains `### Public read-only API (`/api/v1/`)` between `### Validation contract` and `### Things that look optional but aren't`.

- [ ] **Step 4: Commit**

Before committing, check the working tree:

```bash
git status
git diff CLAUDE.md
```

If `git diff` shows changes **other than** the new "Public read-only API" section (e.g., earlier un-committed edits to the auth flow / CSP paragraphs from a prior session), stash them first so this commit only contains the new section:

```bash
git stash push -m "pre-API-doc unrelated CLAUDE.md edits" -- CLAUDE.md
# re-apply just the new section by re-running Step 2's edit, OR keep your editor's buffer
```

Then:

```bash
git add CLAUDE.md
git commit -m "docs(claude): document public /api/v1/ endpoints and mount-order constraint"
```

If you stashed, restore the pre-existing edits afterwards and commit them separately (or decide to keep them stashed for later):

```bash
git stash pop
git status
```

---

### Task 8: Update `README.md`

**Files:**
- Modify: `README.md` (append new section)

- [ ] **Step 1: Append the "External API" section at the end of README.md**

Add this to the end of the file:

```markdown

## 外部 API

只读 JSON 接口，挂在 `/api/v1/` 下，公开访问、按 IP 限流（60 次/分钟）、允许跨域。详细设计见 [docs/superpowers/specs/2026-05-12-public-api-design.md](docs/superpowers/specs/2026-05-12-public-api-design.md)。

```bash
# 列出全部 gamemode
curl http://localhost:3000/api/v1/gamemodes

# 总榜（默认 50 条）
curl 'http://localhost:3000/api/v1/rankings?limit=20&offset=0'

# 单个 gamemode 的 tier 排名（5 个 tier 桶，每桶 count 条）
curl 'http://localhost:3000/api/v1/rankings/Cart?count=10&offset=0'

# 单个玩家详情（包含所有 gamemode 的 tier 段位，未上榜为 null）
curl http://localhost:3000/api/v1/players/SharkIrene
```

错误响应统一形如 `{ "error": "code", "message": "..." }`。
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(readme): document external read-only API"
```

---

## Done

All four endpoints live, documented, and manually verified. After the final commit, the working tree should be clean except for the existing un-committed `M CLAUDE.md` changes from before this session (the auth-flow / CSRF wording fixes).

Run one last sanity check:

```bash
git log --oneline | head -10
curl -s http://localhost:3000/api/v1/gamemodes | python -m json.tool
```
