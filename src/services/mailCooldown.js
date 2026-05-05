const { upsertUser } = require('./dataStore');
const { MAIL_COOLDOWN_MS } = require('./emailService');

function getCooldownEnds(user, op) {
  const cooldowns = (user && user.mailCooldown) || {};
  const stamp = cooldowns[op];
  if (!stamp) return 0;
  const last = new Date(stamp).getTime();
  if (!Number.isFinite(last)) return 0;
  return last + MAIL_COOLDOWN_MS;
}

function isCooledDown(user, op) {
  return getCooldownEnds(user, op) <= Date.now();
}

function remainingCooldownSeconds(user, op) {
  const ends = getCooldownEnds(user, op);
  const ms = ends - Date.now();
  return ms > 0 ? Math.ceil(ms / 1000) : 0;
}

async function stampMailSent(user, op, updates = {}) {
  const next = {
    ...user,
    ...updates,
    mailCooldown: { ...(user.mailCooldown || {}), [op]: new Date().toISOString() }
  };
  await upsertUser(next);
  return next;
}

module.exports = {
  isCooledDown,
  remainingCooldownSeconds,
  stampMailSent,
  MAIL_COOLDOWN_MS
};
