const { getLeaderboard, saveLeaderboard, getSettings, saveSettings } = require('./dataStore');

const REQUIRED_RENAMES_V1 = [
  ['Trident', 'Trident Box'],
  ['Bed', 'Surface Mace'],
  ['Bed PvP', 'Surface Mace'],
  ['Manhunt', 'Shieldless UHC']
];

function listCategoryKeys(entries) {
  const keys = new Set();
  for (const entry of entries) {
    for (const k of Object.keys(entry.categories || {})) {
      keys.add(k);
    }
  }
  return [...keys];
}

async function listCategories() {
  const entries = await getLeaderboard();
  return listCategoryKeys(entries).sort((a, b) => a.localeCompare(b));
}

function applyRenameOnEntries(entries, fromKey, toKey) {
  for (const entry of entries) {
    if (!entry.categories) entry.categories = {};
    if (Object.prototype.hasOwnProperty.call(entry.categories, fromKey)) {
      const value = entry.categories[fromKey];
      delete entry.categories[fromKey];
      const existing = entry.categories[toKey];
      entry.categories[toKey] = value != null ? value : (existing != null ? existing : null);
    }
  }
}

function applyAddOnEntries(entries, name) {
  for (const entry of entries) {
    if (!entry.categories) entry.categories = {};
    if (!Object.prototype.hasOwnProperty.call(entry.categories, name)) {
      entry.categories[name] = null;
    }
  }
}

function applyDeleteOnEntries(entries, name) {
  for (const entry of entries) {
    if (entry.categories && Object.prototype.hasOwnProperty.call(entry.categories, name)) {
      delete entry.categories[name];
    }
  }
}

async function addCategory(name) {
  const entries = await getLeaderboard();
  const keys = new Set(listCategoryKeys(entries));
  if (keys.has(name)) {
    throw Object.assign(new Error('该细分项目已存在'), { code: 'CATEGORY_EXISTS' });
  }
  applyAddOnEntries(entries, name);
  await saveLeaderboard(entries);
}

async function renameCategory(from, to) {
  if (from === to) return;
  const entries = await getLeaderboard();
  const keys = new Set(listCategoryKeys(entries));
  if (!keys.has(from)) {
    throw Object.assign(new Error('源细分项目不存在'), { code: 'CATEGORY_NOT_FOUND' });
  }
  if (keys.has(to)) {
    throw Object.assign(new Error('目标名称已被占用'), { code: 'CATEGORY_EXISTS' });
  }
  applyRenameOnEntries(entries, from, to);
  await saveLeaderboard(entries);
}

async function deleteCategory(name) {
  const entries = await getLeaderboard();
  const keys = new Set(listCategoryKeys(entries));
  if (!keys.has(name)) {
    throw Object.assign(new Error('细分项目不存在'), { code: 'CATEGORY_NOT_FOUND' });
  }
  applyDeleteOnEntries(entries, name);
  await saveLeaderboard(entries);
}

async function ensureRequiredRenames() {
  const settings = await getSettings();
  if (settings.migrations && settings.migrations.categoryRenames_v1) return;

  const entries = await getLeaderboard();
  let mutated = false;
  for (const [from, to] of REQUIRED_RENAMES_V1) {
    const keys = new Set(listCategoryKeys(entries));
    if (keys.has(from)) {
      applyRenameOnEntries(entries, from, to);
      mutated = true;
    }
  }
  if (mutated) await saveLeaderboard(entries);
  await saveSettings({ migrations: { ...(settings.migrations || {}), categoryRenames_v1: true } });
}

module.exports = {
  listCategories,
  addCategory,
  renameCategory,
  deleteCategory,
  ensureRequiredRenames
};
