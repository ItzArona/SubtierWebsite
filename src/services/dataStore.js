const fs = require('node:fs/promises');
const path = require('node:path');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.resolve(__dirname, '../../data');
const LEADERBOARD_FILE = path.join(DATA_DIR, 'leaderboard.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

const DEFAULT_ADMIN = {
  id: 'admin-1',
  username: process.env.ADMIN_USERNAME || 'admin',
  passwordHash: bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'ChangeMe_12345', 12),
  role: 'admin',
  createdAt: new Date().toISOString()
};

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readJson(filePath, fallback) {
  try {
    const text = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(text);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return fallback;
    }
    throw error;
  }
}

async function writeJson(filePath, data) {
  const tempPath = `${filePath}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf-8');
  await fs.rename(tempPath, filePath);
}

async function getLeaderboard() {
  return readJson(LEADERBOARD_FILE, []);
}

async function saveLeaderboard(entries) {
  await writeJson(LEADERBOARD_FILE, entries);
}

async function getUsers() {
  const users = await readJson(USERS_FILE, []);
  if (users.length > 0) {
    return users;
  }

  await writeJson(USERS_FILE, [DEFAULT_ADMIN]);
  return [DEFAULT_ADMIN];
}

async function findUserByUsername(username) {
  const users = await getUsers();
  return users.find((user) => user.username === username) || null;
}

module.exports = {
  ensureDataDir,
  getLeaderboard,
  saveLeaderboard,
  getUsers,
  findUserByUsername,
  LEADERBOARD_FILE
};
