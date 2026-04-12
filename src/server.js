require('dotenv').config();

const path = require('node:path');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const csurf = require('csurf');
const { z } = require('zod');
const { ensureDataDir, getLeaderboard, saveLeaderboard, findUserByUsername } = require('./services/dataStore');
const { importExcelIfNeeded } = require('./services/excelImport');
const { requireAuth } = require('./middleware/auth');
const { leaderboardSchema, loginSchema, parseCategoryPayload } = require('./utils/validation');

const app = express();
const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const isProduction = process.env.NODE_ENV === 'production';

const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) {
  console.warn('⚠️  SESSION_SECRET 未设置，当前使用临时密钥，重启后会失效。');
}

app.set('view engine', 'ejs');
app.set('views', path.resolve(__dirname, '../views'));

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:']
      }
    }
  })
);
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use(express.json({ limit: '20kb' }));
app.use('/public', express.static(path.resolve(__dirname, '../public')));
app.use(
  session({
    name: 'subtier.sid',
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 8
    }
  })
);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: '登录尝试过多，请稍后再试。'
});

const csrfProtection = csurf();
app.use(csrfProtection);

app.use((req, res, next) => {
  res.locals.csrfToken = req.csrfToken();
  res.locals.currentUser = req.session.user || null;
  res.locals.error = null;
  next();
});

app.get('/', async (req, res, next) => {
  try {
    const entries = await getLeaderboard();
    const categories = Array.from(
      new Set(entries.flatMap((entry) => Object.keys(entry.categories || {})))
    );

    res.render('index', {
      title: 'Subtier PvP 榜单',
      entries: entries.sort((a, b) => a.position - b.position),
      categories,
      stats: {
        totalPlayers: entries.length,
        totalCategories: categories.length
      }
    });
  } catch (error) {
    next(error);
  }
});

app.get('/admin/login', (req, res) => {
  if (req.session.user) {
    return res.redirect('/admin');
  }

  return res.render('admin/login', {
    title: '管理员登录',
    error: null
  });
});

app.post('/admin/login', loginLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).render('admin/login', {
      title: '管理员登录',
      error: '请输入有效账号和密码。'
    });
  }

  const { username, password } = parsed.data;
  const user = await findUserByUsername(username);
  if (!user) {
    return res.status(401).render('admin/login', {
      title: '管理员登录',
      error: '账号或密码错误。'
    });
  }

  const isValidPassword = await bcrypt.compare(password, user.passwordHash);
  if (!isValidPassword) {
    return res.status(401).render('admin/login', {
      title: '管理员登录',
      error: '账号或密码错误。'
    });
  }

  req.session.regenerate((regenerateError) => {
    if (regenerateError) {
      return res.status(500).render('admin/login', {
        title: '管理员登录',
        error: '登录失败，请稍后重试。'
      });
    }

    req.session.user = { id: user.id, username: user.username, role: user.role };
    return res.redirect('/admin');
  });
});

app.post('/admin/logout', requireAuth, (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('subtier.sid');
    res.redirect('/admin/login');
  });
});

app.get('/admin', requireAuth, async (req, res, next) => {
  try {
    const entries = await getLeaderboard();
    const categoryKeys = Array.from(
      new Set(entries.flatMap((entry) => Object.keys(entry.categories || {})))
    );
    const successMessageMap = {
      created: '条目已添加。',
      updated: '条目已保存。',
      deleted: '条目已删除。'
    };
    const errorMessageMap = {
      invalid_form: '表单格式不正确，请检查后重试。',
      not_found: '目标条目不存在，可能已被删除。',
      invalid_request: '请求参数无效，请刷新后重试。'
    };
    const success = typeof req.query.success === 'string' ? req.query.success : '';
    const error = typeof req.query.error === 'string' ? req.query.error : '';

    res.render('admin/dashboard', {
      title: '后台管理',
      entries: entries.sort((a, b) => a.position - b.position),
      categoryKeys,
      successMessage: successMessageMap[success] || null,
      errorMessage: errorMessageMap[error] || null
    });
  } catch (error) {
    next(error);
  }
});

app.post('/admin/entries', requireAuth, async (req, res) => {
  const parsed = leaderboardSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).redirect('/admin?error=invalid_form');
  }

  const categories = parseCategoryPayload(req.body);
  const entries = await getLeaderboard();

  entries.push({
    id: `entry-${Date.now()}`,
    ...parsed.data,
    categories,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  await saveLeaderboard(entries);
  return res.redirect('/admin?success=created');
});

app.post('/admin/entries/:id/update', requireAuth, async (req, res) => {
  const paramsSchema = z.object({ id: z.string().min(1) });
  const validParams = paramsSchema.safeParse(req.params);
  const parsed = leaderboardSchema.safeParse(req.body);

  if (!validParams.success || !parsed.success) {
    return res.status(400).redirect('/admin?error=invalid_form');
  }

  const categories = parseCategoryPayload(req.body);
  const entries = await getLeaderboard();
  const index = entries.findIndex((entry) => entry.id === validParams.data.id);

  if (index === -1) {
    return res.status(404).redirect('/admin?error=not_found');
  }

  entries[index] = {
    ...entries[index],
    ...parsed.data,
    categories,
    updatedAt: new Date().toISOString()
  };

  await saveLeaderboard(entries);
  return res.redirect('/admin?success=updated');
});

app.post('/admin/entries/:id/delete', requireAuth, async (req, res) => {
  const paramsSchema = z.object({ id: z.string().min(1) });
  const validParams = paramsSchema.safeParse(req.params);
  if (!validParams.success) {
    return res.status(400).redirect('/admin?error=invalid_request');
  }

  const entries = await getLeaderboard();
  const nextEntries = entries.filter((entry) => entry.id !== validParams.data.id);

  await saveLeaderboard(nextEntries);
  return res.redirect('/admin?success=deleted');
});

app.use((req, res) => {
  res.status(404).render('error', {
    title: '页面未找到',
    message: '你访问的页面不存在。'
  });
});

app.use((error, req, res, next) => {
  if (error.code === 'EBADCSRFTOKEN') {
    return res.status(403).render('error', {
      title: '请求无效',
      message: '安全校验失败，请刷新页面后重试。'
    });
  }

  console.error(error);
  return res.status(500).render('error', {
    title: '服务器错误',
    message: '服务器开小差了，请稍后再试。'
  });
});

async function bootstrap() {
  await ensureDataDir();
  await importExcelIfNeeded();

  app.listen(PORT, () => {
    console.log(`SubtierWebsite started on http://localhost:${PORT}`);
  });
}

bootstrap().catch((error) => {
  console.error('应用启动失败:', error);
  process.exit(1);
});
