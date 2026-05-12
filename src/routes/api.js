const express = require('express');
const { getLeaderboard } = require('../services/dataStore');
const { listCategories } = require('../services/categoryService');
const { apiListPaginationSchema } = require('../utils/validation');

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

router.use((req, res) => {
  res.status(404).json({ error: 'not_found', message: `route '${req.method} ${req.originalUrl}' does not exist` });
});

// eslint-disable-next-line no-unused-vars
router.use((err, req, res, next) => {
  console.error('[api]', err && err.stack ? err.stack : err);
  res.status(500).json({ error: 'internal_error', message: 'unexpected server error' });
});

module.exports = router;
