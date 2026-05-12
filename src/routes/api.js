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

router.use((req, res) => {
  res.status(404).json({ error: 'not_found', message: `route '${req.method} ${req.originalUrl}' does not exist` });
});

// eslint-disable-next-line no-unused-vars
router.use((err, req, res, next) => {
  console.error('[api]', err && err.stack ? err.stack : err);
  res.status(500).json({ error: 'internal_error', message: 'unexpected server error' });
});

module.exports = router;
