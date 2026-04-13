const fs = require('node:fs/promises');
const path = require('node:path');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.resolve(__dirname, '../../data');
const LEADERBOARD_FILE = path.join(DATA_DIR, 'leaderboard.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

const DEFAULT_ADMIN = {
  id: 'admin-1',
  username: process.env.ADMIN_USERNAME || 'adminstrator',
  passwordHash: bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'ChangeMe_123s45', 12),
  role: 'admin',
  createdAt: new Date().toISOString()
};

let cachedLeaderboard = null;
let cachedUsers = null;

let leaderboardPromise = null;
let usersPromise = null;

let isWriting = false;
const writeQueue = [];

async function flushWriteQueue() {
  if (isWriting || writeQueue.length === 0) return;
  isWriting = true;
  
  const { filePath, data, resolve, reject } = writeQueue.shift();
  const tempPath = `${filePath}.tmp`;
  try {
    await fs.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf-8');
    await fs.rename(tempPath, filePath);
    resolve();
  } catch (error) {
    reject(error);
  } finally {
    isWriting = false;
    flushWriteQueue();
  }
}

function writeJson(filePath, data) {
  return new Promise((resolve, reject) => {
    writeQueue.push({ filePath, data, resolve, reject });
    flushWriteQueue();
  });
}

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

async function getLeaderboard() {
  if (cachedLeaderboard) return cachedLeaderboard;
  if (!leaderboardPromise) {
    leaderboardPromise = readJson(LEADERBOARD_FILE, []).then((data) => {
      cachedLeaderboard = data;
      leaderboardPromise = null;
      return data;
    });
  }
  return leaderboardPromise;
}

async function saveLeaderboard(entries) {
  await writeJson(LEADERBOARD_FILE, entries);
  cachedLeaderboard = entries;
}

async function getUsers() {
  if (cachedUsers) return cachedUsers;
  if (!usersPromise) {
    usersPromise = (async () => {
      const users = await readJson(USERS_FILE, []);
      if (users.length > 0) {
        cachedUsers = users;
        usersPromise = null;
        return users;
      }

      await writeJson(USERS_FILE, [DEFAULT_ADMIN]);
      cachedUsers = [DEFAULT_ADMIN];
      usersPromise = null;
      return cachedUsers;
    })();
  }
  return usersPromise;
}

async function findUserByUsername(username) {
  const users = await getUsers();
  return users.find((user) => user.username === username) || null;
}

// Invalidate cache (used by excelImport or external modifications)
function invalidateCache() {
  cachedLeaderboard = null;
  cachedUsers = null;
}

module.exports = {
  ensureDataDir,
  getLeaderboard,
  saveLeaderboard,
  getUsers,
  findUserByUsername,
  invalidateCache,
  LEADERBOARD_FILE
};
