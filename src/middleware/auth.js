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
  if (req.session.user.role_name !== 'Administrator' || req.session.user.role_scope !== 'ALL') {
    return res.status(403).render('errors/403', { title: 'Access denied' });
  }
  next();
}

function requireDepartmentUser(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role_name !== 'Department User' ||
      req.session.user.role_scope !== 'DEPARTMENT' ||
      !Number(req.session.user.department_id)) {
    return res.status(403).render('errors/403', { title: 'Access denied' });
  }
  next();
}

module.exports = { requireAuth, requirePermission, requireAdmin, requireDepartmentUser };
