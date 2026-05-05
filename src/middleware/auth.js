const { findUserById } = require('../services/dataStore');

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  return next();
}

function requireRole(...allowed) {
  const set = new Set(allowed);
  return async function (req, res, next) {
    const user = req.session.user;
    if (!user) return res.redirect('/login');
    try {
      const fresh = await findUserById(user.id);
      if (!fresh) {
        return req.session.destroy(() => res.redirect('/login'));
      }
      req.session.user = { id: fresh.id, username: fresh.username, email: fresh.email, role: fresh.role };
      if (!set.has(fresh.role)) {
        return res.status(403).render('error', {
          title: '没有权限',
          message: '当前账号无权访问此页面'
        });
      }
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

function requireSuperAdmin(req, res, next) {
  return requireRole('SuperAdmin')(req, res, next);
}

function requireAdminOrAbove(req, res, next) {
  return requireRole('Admin', 'SuperAdmin')(req, res, next);
}

module.exports = { requireAuth, requireRole, requireSuperAdmin, requireAdminOrAbove };
