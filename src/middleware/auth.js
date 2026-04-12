function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/admin/login');
  }

  return next();
}

module.exports = {
  requireAuth
};
