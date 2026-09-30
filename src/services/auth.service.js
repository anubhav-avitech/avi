const bcrypt = require('bcryptjs');
const db = require('../config/db');

async function login(email, password) {
  const [rows] = await db.query(`
    SELECT
      u.id, u.name, u.email, u.department_id, u.role_id,
      r.name AS role_name, r.scope, d.name AS department_name
    FROM users u
    JOIN roles r ON r.id = u.role_id
    LEFT JOIN departments d ON d.id = u.department_id
    WHERE u.email = ?
      AND u.status = 'ACTIVE'
      AND r.status = 'ACTIVE'
      AND r.name IN ('Administrator', 'Department User')
    LIMIT 1
  `, [email]);

  if (!rows.length) return null;

  const [hashRows] = await db.query(
    'SELECT password_hash FROM users WHERE id = ? LIMIT 1',
    [rows[0].id]
  );
  if (!hashRows.length || !(await bcrypt.compare(password, hashRows[0].password_hash))) {
    return null;
  }

  if (rows[0].scope === 'DEPARTMENT' && !rows[0].department_id) return null;
  if (rows[0].scope === 'ALL' && rows[0].role_name !== 'Administrator') return null;

  const [permissions] = await db.query(`
    SELECT p.code
    FROM permissions p
    JOIN role_permissions rp ON rp.permission_id = p.id
    WHERE rp.role_id = ?
    ORDER BY p.code
  `, [rows[0].role_id]);

  return {
    ...rows[0],
    permissions: permissions.map(row => row.code)
  };
}

module.exports = { login };
