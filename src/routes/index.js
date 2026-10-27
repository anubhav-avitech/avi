const express = require('express');
const router = express.Router();
const db = require('../config/db');
const auth = require('../services/auth.service');
const inventory = require('../services/inventory.service');
const users = require('../services/user.service');
const employeeDirectory = require('../services/employee.service');
const departments = require('../services/department.service');
const { dashboard } = require('../services/dashboard.service');
const { requireAuth, requirePermission, requireAdmin, requireDepartmentUser } = require('../middleware/auth');
const { loginLimiter } = require('../middleware/security');

const setFlash = (req, msg, type = 'success') => {
  req.session.flash = { msg, type };
};

router.get('/login', (req, res) => {
  res.render('auth/login', { title: 'Sign in', error: null });
});

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const user = await auth.login(email, password);

    if (!user) {
      return res.status(401).render('auth/login', {
        title: 'Sign in',
        error: 'Invalid email or password.'
      });
    }

    req.session.regenerate(err => {
      if (err) return next(err);
      req.session.user = {
        id: user.id,
        name: user.name,
        email: user.email,
        department_id: user.department_id,
        role_id: user.role_id,
        role_name: user.role_name,
        department_name: user.department_name,
        role_scope: user.scope,
        permissions: user.permissions
      };
      req.session.save(saveErr => {
        if (saveErr) return next(saveErr);
        res.redirect('/');
      });
    });
  } catch (error) {
    next(error);
  }
});

router.post('/logout', requireAuth, (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

router.get('/', requireAuth, requirePermission('DASHBOARD_VIEW'), async (req, res, next) => {
  try {
    res.render('dashboard/index', {
      title: 'Dashboard',
      data: await dashboard(req.session.user)
    });
  } catch (error) {
    next(error);
  }
});

router.get('/inventory', requireAuth, requirePermission('INVENTORY_VIEW'), async (req, res, next) => {
  try {
    const items = await inventory.list(req.session.user, req.query.q, req.query.department_id);
    const deps = req.session.user.role_scope === 'ALL'
      ? await departments.list()
      : await db.query('SELECT id,name,status FROM departments WHERE id=?', [req.session.user.department_id]).then(([rows]) => rows);

    res.render('inventory/index', {
      title: 'Inventory',
      items,
      deps,
      query: req.query.q || '',
      selected: req.query.department_id || ''
    });
  } catch (error) {
    next(error);
  }
});

router.get('/inventory/new', requireAuth, requireDepartmentUser, requirePermission('INVENTORY_CREATE'), async (req, res, next) => {
  try {
    const deps = req.session.user.role_scope === 'ALL'
      ? await departments.list()
      : await db.query('SELECT id,name,status FROM departments WHERE id=? AND status=\'ACTIVE\'', [req.session.user.department_id]).then(([rows]) => rows);

    res.render('inventory/form', {
      title: 'Add inventory',
      item: null,
      deps,
      batches: await inventory.chemicalBatches(req.session.user.department_id),
      action: '/inventory/new'
    });
  } catch (error) {
    next(error);
  }
});

router.post('/inventory/new', requireAuth, requireDepartmentUser, requirePermission('INVENTORY_CREATE'), async (req, res, next) => {
  try {
    await inventory.create(req.body, req.session.user);
    setFlash(req, 'Inventory item created.');
    res.redirect('/inventory');
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      setFlash(req, 'Asset code or serial number already exists.', 'error');
      return res.redirect('/inventory/new');
    }
    if (['FORBIDDEN', 'INVALID_DEPARTMENT'].includes(error.message)) {
      return res.status(403).render('errors/403', { title: 'Access denied' });
    }
    if (error.message === 'INVALID_QUANTITY') {
      setFlash(req, 'Quantity must be greater than zero.', 'error');
      return res.redirect('/inventory/new');
    }
    if (error.message === 'INVALID_CHEMICAL') {
      setFlash(req, 'Enter a batch number, expiry date, valid container capacity and matching unit.', 'error');
      return res.redirect('/inventory/new');
    }
    next(error);
  }
});

router.get('/inventory/:id/restock', requireAuth, requireDepartmentUser, requirePermission('INVENTORY_CREATE'), async (req, res, next) => {
  try {
    const item = await inventory.get(req.params.id);
    if (!item || !inventory.canAccess(req.session.user, item)) {
      return res.status(403).render('errors/403', { title: 'Access denied' });
    }
    res.render('inventory/restock', {
      title: 'Add stock',
      item,
      action: `/inventory/${item.id}/restock`
    });
  } catch (error) {
    next(error);
  }
});

router.post('/inventory/:id/restock', requireAuth, requireDepartmentUser, requirePermission('INVENTORY_CREATE'), async (req, res, next) => {
  try {
    await inventory.restock(req.params.id, req.body.quantity, req.session.user);
    setFlash(req, 'Stock quantity added.');
    res.redirect('/inventory');
  } catch (error) {
    if (error.message === 'INVALID_QUANTITY') {
      setFlash(req, 'Enter a valid quantity. Chemical stock must be entered as whole containers.', 'error');
      return res.redirect(`/inventory/${req.params.id}/restock`);
    }
    if (error.message === 'RETIRED_ITEM') {
      setFlash(req, 'Retired stock cannot be increased.', 'error');
      return res.redirect('/inventory');
    }
    if (error.message === 'STOCK_NOT_AVAILABLE') {
      setFlash(req, 'Stock cannot be increased while the item is in maintenance, lost or damaged status.', 'error');
      return res.redirect('/inventory');
    }
    if (error.message === 'FORBIDDEN') {
      return res.status(403).render('errors/403', { title: 'Access denied' });
    }
    next(error);
  }
});

router.get('/inventory/:id/edit', requireAuth, requirePermission('INVENTORY_UPDATE'), async (req, res, next) => {
  try {
    const item = await inventory.get(req.params.id);
    if (!item || !inventory.canAccess(req.session.user, item)) {
      return res.status(403).render('errors/403', { title: 'Access denied' });
    }

    const deps = req.session.user.role_scope === 'ALL'
      ? await departments.list()
      : await db.query('SELECT id,name,status FROM departments WHERE id=?', [req.session.user.department_id]).then(([rows]) => rows);

    res.render('inventory/form', {
      title: 'Edit inventory',
      item,
      deps,
      batches: [],
      action: `/inventory/${item.id}/edit`
    });
  } catch (error) {
    next(error);
  }
});

router.post('/inventory/:id/edit', requireAuth, requirePermission('INVENTORY_UPDATE'), async (req, res, next) => {
  try {
    await inventory.update(req.params.id, req.body, req.session.user);
    setFlash(req, 'Inventory updated.');
    res.redirect('/inventory');
  } catch (error) {
    if (error.message === 'FORBIDDEN') return res.status(403).render('errors/403', { title: 'Access denied' });
    if (error.message === 'RETIRED_ITEM') {
      setFlash(req, 'Retired inventory cannot be edited.', 'error');
      return res.redirect('/inventory');
    }
    if (error.message === 'INVALID_CHEMICAL') {
      setFlash(req, 'Enter a valid batch number, expiry date, container capacity and matching unit.', 'error');
      return res.redirect(`/inventory/${req.params.id}/edit`);
    }
    if (error.message === 'CHEMICAL_TYPE_IMMUTABLE') {
      setFlash(req, 'An inventory record cannot be changed between chemical and non-chemical stock.', 'error');
      return res.redirect(`/inventory/${req.params.id}/edit`);
    }
    if (error.message === 'CHEMICAL_STOCK_METADATA_LOCKED') {
      setFlash(req, 'Chemical name, batch, expiry and container details cannot be changed after stock has been issued. Add a new stock line for a different batch or size.', 'error');
      return res.redirect(`/inventory/${req.params.id}/edit`);
    }
    if (error.code === 'ER_DUP_ENTRY') {
      setFlash(req, 'Asset code or serial number already exists.', 'error');
      return res.redirect(`/inventory/${req.params.id}/edit`);
    }
    next(error);
  }
});

router.post('/inventory/:id/retire', requireAuth, requirePermission('INVENTORY_DELETE'), async (req, res, next) => {
  try {
    await inventory.retire(req.params.id, req.session.user);
    setFlash(req, 'Inventory retired.');
    res.redirect('/inventory');
  } catch (error) {
    if (error.message === 'FORBIDDEN') return res.status(403).render('errors/403', { title: 'Access denied' });
    if (error.message === 'RETURN_ACTIVE_ASSIGNMENTS') {
      setFlash(req, 'Return active assignments before retiring this item.', 'error');
      return res.redirect('/inventory');
    }
    next(error);
  }
});

router.get('/inventory/:id/history', requireAuth, requirePermission('INVENTORY_VIEW'), async (req, res, next) => {
  try {
    const item = await inventory.get(req.params.id);
    if (!item || !inventory.canAccess(req.session.user, item)) {
      return res.status(403).render('errors/403', { title: 'Access denied' });
    }

    const rows = await inventory.transactionsForItem(req.session.user, req.params.id);

    res.render('dashboard/history', { title: 'Inventory history', item, rows });
  } catch (error) {
    next(error);
  }
});

router.get('/history', requireAuth, requirePermission('INVENTORY_VIEW'), async (req, res, next) => {
  try {
    res.render('dashboard/history', {
      title: 'Inventory history',
      item: null,
      rows: await inventory.transactions(req.session.user)
    });
  } catch (error) {
    next(error);
  }
});

router.get('/assignments', requireAuth, async (req, res, next) => {
  try {
    if (!['Administrator', 'Department User'].includes(req.session.user.role_name) ||
        (!req.session.user.permissions.includes('ASSIGNMENT_CREATE') && !req.session.user.permissions.includes('ASSIGNMENT_RETURN'))) {
      return res.status(403).render('errors/403', { title: 'Access denied' });
    }
    res.render('assignments/index', {
      title: 'Assignments',
      rows: await inventory.assignments(req.session.user)
    });
  } catch (error) {
    next(error);
  }
});

router.get('/employees/new', requireAuth, requireDepartmentUser, requirePermission('ASSIGNMENT_CREATE'), (req, res) => {
  res.render('employees/form', { title: 'Add person' });
});

router.post('/employees/new', requireAuth, requireDepartmentUser, requirePermission('ASSIGNMENT_CREATE'), async (req, res, next) => {
  try {
    await employeeDirectory.create(req.body, req.session.user);
    setFlash(req, 'Person added. You can assign inventory now.');
    res.redirect('/assignments/new');
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      setFlash(req, 'That employee ID is already in use.', 'error');
      return res.redirect('/employees/new');
    }
    if (error.message === 'EMPLOYEE_FIELDS_REQUIRED') {
      setFlash(req, 'Enter an employee ID and name.', 'error');
      return res.redirect('/employees/new');
    }
    next(error);
  }
});

router.get('/assignments/new', requireAuth, requireDepartmentUser, requirePermission('ASSIGNMENT_CREATE'), async (req, res, next) => {
  try {
    const items = await inventory.list(req.session.user);
    const eligibleEmployees = await employeeDirectory.listForDepartment(req.session.user.department_id);
    res.render('assignments/form', {
      title: 'Assign inventory',
      items: items.filter(item => item.status === 'AVAILABLE' && Number(item.quantity) > 0),
      employees: eligibleEmployees,
      action: '/assignments/new'
    });
  } catch (error) {
    next(error);
  }
});

router.post('/assignments/new', requireAuth, requireDepartmentUser, requirePermission('ASSIGNMENT_CREATE'), async (req, res, next) => {
  try {
    await inventory.assign(req.body.inventory_id, req.body.employee_id, req.body.quantity, req.session.user);
    setFlash(req, 'Inventory assigned successfully.');
    res.redirect('/assignments');
  } catch (error) {
    const messages = {
      FORBIDDEN: 'You cannot access this inventory.',
      INVALID_EMPLOYEE: 'Selected employee is not active.',
      CROSS_DEPARTMENT: 'Inventory can only be assigned within the same department.',
      INSUFFICIENT: 'Not enough available quantity.',
      NOT_FOUND: 'Inventory item not found.',
      INVALID_QUANTITY: 'Enter a valid quantity. Chemical stock must be issued as whole containers.'
    };
    setFlash(req, messages[error.message] || 'Assignment could not be completed.', 'error');
    res.redirect('/assignments/new');
  }
});

router.post('/assignments/:id/return', requireAuth, requirePermission('ASSIGNMENT_RETURN'), async (req, res, next) => {
  try {
    await inventory.returnAssignment(req.params.id, req.body.quantity, req.body.note, req.session.user);
    setFlash(req, 'Return recorded.');
    res.redirect('/assignments');
  } catch (error) {
    const messages = {
      FORBIDDEN: 'You cannot access this assignment.',
      INVALID_RETURN: 'Return quantity is invalid.',
      INVALID_QUANTITY: 'Quantity must be greater than zero.',
      CHEMICAL_RETURN_ADMIN_ONLY: 'Only administrators can record chemical returns.',
      CHEMICAL_RETURN_NOTE_REQUIRED: 'Enter a note explaining this exceptional chemical return.',
      INVALID_RETURN_NOTE: 'Return note must be 500 characters or fewer.',
      NOT_FOUND: 'Assignment is no longer active.'
    };
    setFlash(req, messages[error.message] || 'Return could not be completed.', 'error');
    res.redirect('/assignments');
  }
});

// User, department and audit administration are administrator-only.
router.get('/users', requireAuth, requireAdmin, requirePermission('USERS_VIEW'), async (req, res, next) => {
  try {
    res.render('users/index', { title: 'Users', rows: await users.list(req.session.user) });
  } catch (error) {
    next(error);
  }
});

router.get('/users/new', requireAuth, requireAdmin, requirePermission('USERS_MANAGE'), async (req, res, next) => {
  try {
    const options = await users.options();
    res.render('users/form', { title: 'Add user', person: null, ...options });
  } catch (error) {
    next(error);
  }
});

router.post('/users/new', requireAuth, requireAdmin, requirePermission('USERS_MANAGE'), async (req, res, next) => {
  try {
    await users.create(req.body, req.session.user);
    setFlash(req, 'User created.');
    res.redirect('/users');
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      setFlash(req, 'Employee code or email already exists.', 'error');
      return res.redirect('/users/new');
    }
    if (error.message === 'DEPARTMENT_REQUIRED') {
      setFlash(req, 'Select a department for the new user.', 'error');
      return res.redirect('/users/new');
    }
    if (error.message === 'DEPARTMENT_ROLE_UNAVAILABLE') {
      setFlash(req, 'Department access is not configured. Contact the administrator.', 'error');
      return res.redirect('/users/new');
    }
    next(error);
  }
});

router.get('/users/:id/edit', requireAuth, requireAdmin, requirePermission('USERS_MANAGE'), async (req, res, next) => {
  try {
    const [rows] = await db.query(`
      SELECT u.*,r.name AS role_name
      FROM users u JOIN roles r ON r.id=u.role_id
      WHERE u.id=?
    `, [req.params.id]);
    if (!rows.length) return res.status(404).render('errors/404', { title: 'Not found' });
    const options = await users.options();
    res.render('users/form', { title: 'Edit user', person: rows[0], ...options });
  } catch (error) {
    next(error);
  }
});

router.post('/users/:id/edit', requireAuth, requireAdmin, requirePermission('USERS_MANAGE'), async (req, res, next) => {
  try {
    await users.update(req.params.id, req.body, req.session.user);
    setFlash(req, 'User updated.');
    res.redirect('/users');
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      setFlash(req, 'Employee code or email already exists.', 'error');
      return res.redirect(`/users/${req.params.id}/edit`);
    }
    if (error.message === 'ADMIN_DEPARTMENT') {
      setFlash(req, 'Administrators must not be assigned to a department.', 'error');
      return res.redirect(`/users/${req.params.id}/edit`);
    }
    if (error.message === 'DEPARTMENT_REQUIRED') {
      setFlash(req, 'Department is required for a Department User.', 'error');
      return res.redirect(`/users/${req.params.id}/edit`);
    }
    next(error);
  }
});

router.post('/users/:id/delete', requireAuth, requireAdmin, requirePermission('USERS_MANAGE'), async (req, res, next) => {
  try {
    await users.remove(req.params.id, req.session.user);
    setFlash(req, 'User permanently deleted. Existing activity history has been kept without linking it to the deleted account.');
    res.redirect('/users');
  } catch (error) {
    const messages = {
      NOT_FOUND: 'User not found.',
      CANNOT_DELETE_SELF: 'You cannot delete your own account.',
      LAST_ACTIVE_ADMIN: 'The last active administrator cannot be deleted.'
    };
    if (messages[error.message]) {
      setFlash(req, messages[error.message], 'error');
      return res.redirect('/users');
    }
    next(error);
  }
});

router.get('/departments', requireAuth, requireAdmin, requirePermission('DEPARTMENTS_MANAGE'), async (req, res, next) => {
  try {
    res.render('departments/index', { title: 'Departments', rows: await departments.list() });
  } catch (error) {
    next(error);
  }
});

router.post('/departments/new', requireAuth, requireAdmin, requirePermission('DEPARTMENTS_MANAGE'), async (req, res, next) => {
  try {
    await departments.create(req.body, req.session.user);
    setFlash(req, 'Department created.');
    res.redirect('/departments');
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      setFlash(req, 'A department with that name already exists.', 'error');
      return res.redirect('/departments');
    }
    next(error);
  }
});

router.post('/departments/:id/edit', requireAuth, requireAdmin, requirePermission('DEPARTMENTS_MANAGE'), async (req, res, next) => {
  try {
    await departments.update(req.params.id, req.body, req.session.user);
    setFlash(req, 'Department updated.');
    res.redirect('/departments');
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      setFlash(req, 'A department with that name already exists.', 'error');
      return res.redirect('/departments');
    }
    next(error);
  }
});

router.post('/departments/:id/delete', requireAuth, requireAdmin, requirePermission('DEPARTMENTS_MANAGE'), async (req, res, next) => {
  try {
    await departments.remove(req.params.id, req.session.user);
    setFlash(req, 'Department deleted.');
    res.redirect('/departments');
  } catch (error) {
    if (error.message === 'DEPARTMENT_IN_USE') {
      setFlash(req, 'Cannot delete a department that has users or inventory.', 'error');
      return res.redirect('/departments');
    }
    if (error.message === 'DEPARTMENT_NOT_FOUND') {
      setFlash(req, 'Department not found.', 'error');
      return res.redirect('/departments');
    }
    next(error);
  }
});

router.get('/audit', requireAuth, requireAdmin, requirePermission('AUDIT_VIEW'), async (req, res, next) => {
  try {
    const [rows] = await db.query(`
      SELECT a.*,u.name AS actor_name
      FROM audit_logs a
      LEFT JOIN users u ON u.id=a.actor_id
      ORDER BY a.created_at DESC
      LIMIT 300
    `);
    res.render('dashboard/audit', { title: 'Audit log', rows });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
