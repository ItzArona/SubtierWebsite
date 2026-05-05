function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  return next();
}

function requireRole(...allowed) {
  const set = new Set(allowed);
  return function (req, res, next) {
    const user = req.session.user;
    if (!user) return res.redirect('/login');
    if (!set.has(user.role)) {
      return res.status(403).render('error', {
        title: '没有权限',
        message: '当前账号无权访问此页面'
      });
    }
    return next();
  };
}

function requireSuperAdmin(req, res, next) {
  return requireRole('SuperAdmin')(req, res, next);
}

function requireAdminOrAbove(req, res, next) {
  return requireRole('Admin', 'SuperAdmin')(req, res, next);
}

module.exports = { requireAuth, requireRole, requireSuperAdmin, requireAdminOrAbove };
