const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { audit } = require('./audit.service');

async function list(actor) {
  let sql = `
    SELECT u.id,u.employee_code,u.name,u.email,u.status,u.role_id,r.name AS role_name
    FROM users u
    JOIN roles r ON r.id=u.role_id
    WHERE r.name IN ('Administrator','Inventory User')
  `;
  sql += ' ORDER BY u.name';
  const [rows] = await db.query(sql);
  return rows;
}

async function inventoryTeamMembers(includeAdministrators = false) {
  const [rows] = await db.query(`
    SELECT u.name,u.employee_code
    FROM users u
    JOIN roles r ON r.id=u.role_id
    WHERE (r.name='Inventory User' OR (r.name='Administrator' AND ?=1))
      AND u.status='ACTIVE'
    ORDER BY u.name,u.employee_code
  `, [includeAdministrators ? 1 : 0]);
  return rows;
}

async function create(data, actor) {
  const [[role]] = await db.query(
    "SELECT id,name FROM roles WHERE status='ACTIVE' AND name='Inventory User' LIMIT 1"
  );
  if (!role) throw new Error('INVENTORY_ROLE_UNAVAILABLE');

  const hash = await bcrypt.hash(data.password, 12);
  const [result] = await db.query(
    `INSERT INTO users(employee_code,name,email,password_hash,role_id,status)
     VALUES(?,?,?,?,?,'ACTIVE')`,
    [
      String(data.employee_code || '').trim(),
      String(data.name || '').trim(),
      String(data.email || '').trim().toLowerCase(),
      hash,
      role.id
    ]
  );

  await audit(actor.id, 'USER_CREATED', 'users', result.insertId, {
    employee_code: data.employee_code,
    role: role.name
  }, actor.ip);
}

async function update(id, data, actor) {
  const [[target]] = await db.query(`
    SELECT u.*,r.name role_name
    FROM users u JOIN roles r ON r.id=u.role_id
    WHERE u.id=?
  `, [id]);
  if (!target) throw new Error('NOT_FOUND');

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`
      UPDATE users
      SET employee_code=?,name=?,email=?,role_id=?,status=?
      WHERE id=?
    `, [
      String(data.employee_code || '').trim(),
      String(data.name || '').trim(),
      String(data.email || '').trim().toLowerCase(),
      target.role_id,
      data.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
      id
    ]);

    if (data.password) {
      await conn.query('UPDATE users SET password_hash=? WHERE id=?', [
        await bcrypt.hash(data.password, 12), id
      ]);
    }

    await conn.query('DELETE FROM user_permissions WHERE user_id=?', [id]);
    if (target.role_name !== 'Administrator') {
      const selected = Array.isArray(data.master_permissions)
        ? data.master_permissions
        : data.master_permissions ? [data.master_permissions] : [];
      const masterCodes = new Set([
        'CHEMICAL_MASTER_ACCESS',
        'VENDOR_MASTER_ACCESS',
        'GLASSWARE_MASTER_ACCESS',
        'EQUIPMENT_MASTER_ACCESS'
      ]);
      for (const code of selected) {
        if (!masterCodes.has(code)) continue;
        await conn.query(`
          INSERT IGNORE INTO user_permissions(user_id,permission_id)
          SELECT ?,p.id FROM permissions p WHERE p.code=?
        `, [id, code]);
      }
    }
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }

  await audit(actor.id, 'USER_UPDATED', 'users', id, {
    employee_code: data.employee_code,
    role: target.role_name
  }, actor.ip);
  if (data.password) {
    await audit(actor.id, 'PASSWORD_CHANGED', 'users', id, {
      name: target.name,
      employee_code: target.employee_code
    }, actor.ip);
  }
}

async function remove(id, actor) {
  const targetId = Number(id);
  if (!Number.isInteger(targetId) || targetId <= 0) throw new Error('NOT_FOUND');
  if (targetId === Number(actor.id)) throw new Error('CANNOT_DELETE_SELF');

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [targets] = await conn.query(`
      SELECT u.id,u.employee_code,u.name,u.email,u.status,r.name AS role_name
      FROM users u
      JOIN roles r ON r.id=u.role_id
      WHERE u.id=?
      FOR UPDATE
    `, [targetId]);
    if (!targets.length) throw new Error('NOT_FOUND');
    const target = targets[0];

    if (target.role_name === 'Administrator' && target.status === 'ACTIVE') {
      const [admins] = await conn.query(`
        SELECT u.id
        FROM users u
        JOIN roles r ON r.id=u.role_id
        WHERE r.name='Administrator' AND u.status='ACTIVE'
        FOR UPDATE
      `);
      if (admins.length <= 1) throw new Error('LAST_ACTIVE_ADMIN');
    }

    await conn.query(`
      INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,details,ip_address)
      VALUES(?,'USER_DELETED','users',?,JSON_OBJECT(
        'name',?,'employee_code',?,'role',?,'history_unlinked',true
      ),?)
    `, [actor.id, target.id, target.name, target.employee_code, target.role_name, actor.ip || null]);
    await conn.query('DELETE FROM users WHERE id=?', [targetId]);

    await conn.commit();
    return 'deleted';
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

module.exports = { list, inventoryTeamMembers, create, update, remove };
