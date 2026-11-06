function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

function requirePermission(code) {
  return (req, res, next) => {
    if (!req.session.user) return res.redirect('/login');
    if (!req.session.user.permissions.includes(code)) {
      return res.status(403).render('errors/403', { title: 'Access denied' });
    }
    next();
  };
}

function requireAdmin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role_name !== 'Administrator') {
    return res.status(403).render('errors/403', { title: 'Access denied' });
  }
  next();
}

module.exports = { requireAuth, requirePermission, requireAdmin };
