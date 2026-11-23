const bcrypt = require('bcryptjs');
const db = require('../config/db');

async function login(email, password) {
  const [rows] = await db.query(`
    SELECT
      u.id, u.name, u.email, u.role_id, r.name AS role_name
    FROM users u
    JOIN roles r ON r.id = u.role_id
    WHERE u.email = ?
      AND u.status = 'ACTIVE'
      AND r.status = 'ACTIVE'
      AND r.name IN ('Administrator', 'Inventory User')
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

  const [permissions] = await db.query(`
    SELECT p.code
    FROM permissions p
    JOIN (
      SELECT permission_id FROM role_permissions WHERE role_id = ?
      UNION
      SELECT up.permission_id
      FROM user_permissions up
      WHERE up.user_id = ?
    ) granted ON granted.permission_id = p.id
    ORDER BY p.code
  `, [rows[0].role_id, rows[0].id]);

  return {
    ...rows[0],
    permissions: permissions.map(row => row.code)
  };
}

module.exports = { login };
