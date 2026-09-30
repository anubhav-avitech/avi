const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { audit } = require('./audit.service');

async function list(actor) {
  let sql = `
    SELECT u.id,u.employee_code,u.name,u.email,u.status,u.department_id,
           u.role_id,d.name AS department,r.name AS role_name
    FROM users u
    LEFT JOIN departments d ON d.id=u.department_id
    JOIN roles r ON r.id=u.role_id
    WHERE r.name IN ('Administrator','Department User')
  `;
  const params = [];

  if (actor.role_scope !== 'ALL') {
    sql += ' AND u.department_id=? AND r.name=\'Department User\'';
    params.push(actor.department_id);
  }

  sql += ' ORDER BY u.name';
  const [rows] = await db.query(sql, params);
  return rows;
}

async function options() {
  const [departments] = await db.query(
    "SELECT id,name FROM departments WHERE status='ACTIVE' ORDER BY name"
  );
  return { departments };
}

async function create(data, actor) {
  const [[role]] = await db.query(
    "SELECT id,name,scope FROM roles WHERE status='ACTIVE' AND name='Department User' LIMIT 1"
  );
  if (!role) throw new Error('DEPARTMENT_ROLE_UNAVAILABLE');

  if (!data.department_id) throw new Error('DEPARTMENT_REQUIRED');

  const hash = await bcrypt.hash(data.password, 12);
  const [result] = await db.query(
    `INSERT INTO users(employee_code,name,email,password_hash,department_id,role_id,status)
     VALUES(?,?,?,?,?,?, 'ACTIVE')`,
    [
      String(data.employee_code || '').trim(),
      String(data.name || '').trim(),
      String(data.email || '').trim().toLowerCase(),
      hash,
      Number(data.department_id),
      role.id
    ]
  );

  await audit(actor.id, 'USER_CREATED', 'users', result.insertId, {
    employee_code: data.employee_code,
    role: role.name,
    department_id: Number(data.department_id)
  }, actor.ip);
}

async function update(id, data, actor) {
  const [[target]] = await db.query(`
    SELECT u.*,r.name role_name,r.scope
    FROM users u JOIN roles r ON r.id=u.role_id
    WHERE u.id=?
  `, [id]);
  if (!target) throw new Error('NOT_FOUND');

  if (target.role_name === 'Administrator') {
    if (data.department_id) throw new Error('ADMIN_DEPARTMENT');
  } else if (!data.department_id) {
    throw new Error('DEPARTMENT_REQUIRED');
  }

  await db.query(`
    UPDATE users
    SET employee_code=?,name=?,email=?,department_id=?,role_id=?,status=?
    WHERE id=?
  `, [
    String(data.employee_code || '').trim(),
    String(data.name || '').trim(),
    String(data.email || '').trim().toLowerCase(),
    target.role_name === 'Administrator' ? null : Number(data.department_id),
    target.role_id,
    data.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
    id
  ]);

  if (data.password) {
    await db.query('UPDATE users SET password_hash=? WHERE id=?', [
      await bcrypt.hash(data.password, 12), id
    ]);
  }

  await audit(actor.id, 'USER_UPDATED', 'users', id, {
    employee_code: data.employee_code,
    role: target.role_name
  }, actor.ip);
}

module.exports = { list, options, create, update };
