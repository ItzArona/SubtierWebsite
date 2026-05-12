const express = require('express');
const { getLeaderboard } = require('../services/dataStore');
const { listCategories } = require('../services/categoryService');
const { apiListPaginationSchema, apiTierPaginationSchema, apiGamemodeNameSchema } = require('../utils/validation');

const router = express.Router();

router.use((req, res, next) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  next();
});

function sendCached(res, body) {
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.json(body);
}

function compactPlayer(entry) {
  return {
    name: entry.player,
    points: entry.points,
    rank: entry.rank,
    position: entry.position
  };
}

const TIER_RE = /^(HT|LT)([1-5])$/i;

function parseTier(raw) {
  if (typeof raw !== 'string') return null;
  const m = TIER_RE.exec(raw.trim());
  if (!m) return null;
  const half = m[1].toUpperCase();
  const major = Number(m[2]);
  return { canonical: `${half}${major}`, half, major };
}

router.get('/gamemodes', async (req, res, next) => {
  try {
    const gamemodes = await listCategories();
    sendCached(res, { gamemodes });
  } catch (err) { next(err); }
});

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
        if (a._half !== b._half) return a._half === 'HT' ? -1 : 1;
        if (b.points !== a.points) return b.points - a.points;
        return String(a.name).localeCompare(String(b.name));
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

router.use((req, res) => {
  res.status(404).json({ error: 'not_found', message: `route '${req.method} ${req.originalUrl}' does not exist` });
});

// eslint-disable-next-line no-unused-vars
router.use((err, req, res, next) => {
  console.error('[api]', err && err.stack ? err.stack : err);
  res.status(500).json({ error: 'internal_error', message: 'unexpected server error' });
});

module.exports = router;
