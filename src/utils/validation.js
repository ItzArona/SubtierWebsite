const { z } = require('zod');

const leaderboardSchema = z.object({
  position: z.coerce.number().int().min(1).max(9999),
  player: z.string().trim().min(1).max(32),
  rank: z.string().trim().min(1).max(64),
  points: z.coerce.number().int().min(0).max(9999)
});

const loginSchema = z.object({
  username: z.string().trim().min(3).max(32),
  password: z.string().min(8).max(128)
});

function parseCategoryPayload(body) {
  const categories = {};

  for (const [key, value] of Object.entries(body)) {
    if (key.startsWith('category__')) {
      const categoryName = key.replace('category__', '').trim();
      if (!categoryName) {
        continue;
      }

      const normalized = String(value || '').trim();
      categories[categoryName] = normalized.length > 0 ? normalized : null;
    }
  }

  return categories;
}

module.exports = {
  leaderboardSchema,
  loginSchema,
  parseCategoryPayload
};
