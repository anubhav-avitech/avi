const db = require('../config/db');
const { audit } = require('./audit.service');

function isAdmin(user) {
  return user.role_name === 'Administrator' && user.role_scope === 'ALL';
}

function isDepartmentUser(user) {
  return user.role_name === 'Department User' && user.role_scope === 'DEPARTMENT' && Number(user.department_id) > 0;
}

function normalizeQuantity(value) {
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('INVALID_QUANTITY');
  return quantity;
}

async function list(user, search, departmentId) {
  let sql = `
    SELECT i.*,d.name AS department
    FROM inventory_items i
    JOIN departments d ON d.id=i.department_id
    WHERE 1=1
  `;
  const params = [];

  if (!isAdmin(user)) {
    sql += ' AND i.department_id=?';
    params.push(user.department_id);
  } else if (departmentId) {
    sql += ' AND i.department_id=?';
    params.push(departmentId);
  }

  if (search) {
    sql += ' AND (i.asset_code LIKE ? OR i.name LIKE ? OR i.category LIKE ? OR i.serial_number LIKE ?)';
    const term = `%${String(search).trim()}%`;
    params.push(term, term, term, term);
  }

  sql += ' ORDER BY i.updated_at DESC';
  const [rows] = await db.query(sql, params);
  return rows;
}

async function get(id) {
  const [rows] = await db.query(`
    SELECT i.*,d.name AS department
    FROM inventory_items i
    JOIN departments d ON d.id=i.department_id
    WHERE i.id=?
  `, [id]);
  return rows[0] || null;
}

function canAccess(user, item) {
  return isAdmin(user) || Number(user.department_id) === Number(item.department_id);
}

function departmentForWrite(user, requestedDepartment) {
  if (isAdmin(user)) {
    const id = Number(requestedDepartment);
    if (!Number.isInteger(id) || id <= 0) throw new Error('INVALID_DEPARTMENT');
    return id;
  }

  if (requestedDepartment && Number(requestedDepartment) !== Number(user.department_id)) {
    throw new Error('FORBIDDEN');
  }
  return Number(user.department_id);
}

async function create(data, user) {
  if (!isDepartmentUser(user)) throw new Error('FORBIDDEN');
  const departmentId = departmentForWrite(user, data.department_id);
  const quantity = normalizeQuantity(data.quantity);
  const itemType = data.item_type === 'CONSUMABLE' ? 'CONSUMABLE' : 'ASSET';

  const [result] = await db.query(`
    INSERT INTO inventory_items(
      asset_code,name,item_type,category,description,serial_number,
      quantity,unit,department_id,status,location,batch_number,manufacturer,expiry_date
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `, [
    String(data.asset_code || '').trim(),
    String(data.name || '').trim(),
    itemType,
    data.category || null,
    data.description || null,
    data.serial_number || null,
    quantity,
    data.unit || 'Piece',
    departmentId,
    'AVAILABLE',
    data.location || null,
    data.batch_number || null,
    data.manufacturer || null,
    data.expiry_date || null
  ]);

  await db.query(
    'INSERT INTO inventory_transactions(inventory_id,actor_id,action,quantity,unit,details) VALUES(?,?,?,?,?,?)',
    [result.insertId, user.id, 'ADD', quantity, data.unit || 'Piece', JSON.stringify({ asset_code: data.asset_code })]
  );
  await audit(user.id, 'INVENTORY_CREATED', 'inventory_items', result.insertId, {
    asset_code: data.asset_code,
    department_id: departmentId
  }, user.ip);
}

async function update(id, data, user) {
  const old = await get(id);
  if (!old || !canAccess(user, old)) throw new Error('FORBIDDEN');
  if (old.status === 'RETIRED') throw new Error('RETIRED_ITEM');

  const departmentId = departmentForWrite(user, data.department_id || old.department_id);
  const itemType = data.item_type === 'CONSUMABLE' ? 'CONSUMABLE' : 'ASSET';

  await db.query(`
    UPDATE inventory_items SET
      asset_code=?,name=?,item_type=?,category=?,description=?,serial_number=?,
      unit=?,department_id=?,location=?,batch_number=?,manufacturer=?,expiry_date=?
    WHERE id=?
  `, [
    String(data.asset_code || '').trim(),
    String(data.name || '').trim(),
    itemType,
    data.category || null,
    data.description || null,
    data.serial_number || null,
    data.unit || old.unit,
    departmentId,
    data.location || null,
    data.batch_number || null,
    data.manufacturer || null,
    data.expiry_date || null,
    id
  ]);

  await db.query(
    'INSERT INTO inventory_transactions(inventory_id,actor_id,action,details) VALUES(?,?,?,?)',
    [id, user.id, 'UPDATE', JSON.stringify({ before: old, after: data })]
  );
  await audit(user.id, 'INVENTORY_UPDATED', 'inventory_items', id, {
    asset_code: data.asset_code,
    department_id: departmentId
  }, user.ip);
}

async function retire(id, user) {
  const item = await get(id);
  if (!item || !canAccess(user, item)) throw new Error('FORBIDDEN');
  if (item.status === 'RETIRED') return;

  const [[active]] = await db.query(
    'SELECT COUNT(*) AS count FROM inventory_assignments WHERE inventory_id=? AND returned_at IS NULL',
    [id]
  );
  if (Number(active.count) > 0) throw new Error('RETURN_ACTIVE_ASSIGNMENTS');

  await db.query("UPDATE inventory_items SET status='RETIRED' WHERE id=?", [id]);
  await db.query(
    'INSERT INTO inventory_transactions(inventory_id,actor_id,action,details) VALUES(?,?,?,?)',
    [id, user.id, 'RETIRE', JSON.stringify({ previous_status: item.status })]
  );
  await audit(user.id, 'INVENTORY_RETIRED', 'inventory_items', id, null, user.ip);
}

async function assign(id, employeeId, rawQuantity, actor) {
  if (!isDepartmentUser(actor)) throw new Error('FORBIDDEN');
  const quantity = normalizeQuantity(rawQuantity);
  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    const [items] = await conn.query(
      'SELECT * FROM inventory_items WHERE id=? FOR UPDATE',
      [id]
    );
    if (!items.length) throw new Error('NOT_FOUND');
    const item = items[0];

    if (!canAccess(actor, item)) throw new Error('FORBIDDEN');
    if (item.status !== 'AVAILABLE' || Number(item.quantity) < quantity) {
      throw new Error('INSUFFICIENT');
    }

    const [employees] = await conn.query(`
      SELECT id,department_id,status
      FROM employees
      WHERE id=? AND status='ACTIVE'
      LIMIT 1
    `, [employeeId]);
    if (!employees.length) throw new Error('INVALID_EMPLOYEE');
    const target = employees[0];

    if (Number(target.department_id) !== Number(actor.department_id)) {
      throw new Error('CROSS_DEPARTMENT');
    }
    if (Number(target.department_id) !== Number(item.department_id)) {
      throw new Error('CROSS_DEPARTMENT');
    }

    await conn.query(`
      UPDATE inventory_items
      SET quantity=quantity-?,
          status=CASE WHEN quantity-?=0 THEN 'ASSIGNED' ELSE 'AVAILABLE' END
      WHERE id=?
    `, [quantity, quantity, id]);

    const [assignment] = await conn.query(`
      INSERT INTO inventory_assignments(inventory_id,employee_id,quantity,unit,assigned_by)
      VALUES(?,?,?,?,?)
    `, [id, employeeId, quantity, item.unit, actor.id]);

    await conn.query(`
      INSERT INTO inventory_transactions(inventory_id,employee_id,actor_id,action,quantity,unit,details)
      VALUES(?,?,?,?,?,?,?)
    `, [id, employeeId, actor.id, 'ASSIGN', quantity, item.unit,
      JSON.stringify({ assignment_id: assignment.insertId })]);

    await conn.commit();
    await audit(actor.id, 'INVENTORY_ASSIGNED', 'inventory_items', id, {
      assignment_id: assignment.insertId,
      employee_id: employeeId,
      quantity,
      unit: item.unit
    }, actor.ip);

    return assignment.insertId;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function returnAssignment(assignmentId, rawQuantity, note, actor) {
  if (!isDepartmentUser(actor)) throw new Error('FORBIDDEN');
  const quantity = normalizeQuantity(rawQuantity);
  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(`
      SELECT a.*,i.department_id,i.status AS inventory_status
      FROM inventory_assignments a
      JOIN inventory_items i ON i.id=a.inventory_id
      WHERE a.id=? AND a.returned_at IS NULL
      FOR UPDATE
    `, [assignmentId]);
    if (!rows.length) throw new Error('NOT_FOUND');

    const assignment = rows[0];
    if (Number(actor.department_id) !== Number(assignment.department_id)) {
      throw new Error('FORBIDDEN');
    }
    if (quantity > Number(assignment.quantity)) throw new Error('INVALID_RETURN');

    const full = quantity === Number(assignment.quantity);
    if (full) {
      await conn.query(`
        UPDATE inventory_assignments
        SET returned_at=NOW(),returned_quantity=?,return_note=?
        WHERE id=?
      `, [quantity, note || null, assignmentId]);
    } else {
      await conn.query(`
        UPDATE inventory_assignments
        SET quantity=quantity-?,return_note=?
        WHERE id=?
      `, [quantity, note || null, assignmentId]);
    }

    await conn.query(`
      UPDATE inventory_items
      SET quantity=quantity+?,status='AVAILABLE'
      WHERE id=?
    `, [quantity, assignment.inventory_id]);

    await conn.query(`
      INSERT INTO inventory_transactions(inventory_id,user_id,employee_id,actor_id,action,quantity,unit,details)
      VALUES(?,?,?,?,?,?,?,?)
    `, [assignment.inventory_id, assignment.user_id, assignment.employee_id, actor.id, 'RETURN', quantity,
      assignment.unit, JSON.stringify({ assignment_id: assignmentId, note: note || null, full_return: full })]);

    await conn.commit();
    await audit(actor.id, 'INVENTORY_RETURNED', 'inventory_items', assignment.inventory_id, {
      assignment_id: assignmentId,
      quantity,
      unit: assignment.unit,
      full_return: full
    }, actor.ip);
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function assignments(user) {
  if (!isDepartmentUser(user)) throw new Error('FORBIDDEN');
  let sql = `
    SELECT a.*,i.asset_code,i.name AS item_name,i.department_id,
           d.name AS department,COALESCE(e.name,u.name) AS user_name,
           COALESCE(e.employee_code,u.employee_code) AS employee_code,
           ab.name AS assigned_by_name
    FROM inventory_assignments a
    JOIN inventory_items i ON i.id=a.inventory_id
    JOIN departments d ON d.id=i.department_id
    LEFT JOIN users u ON u.id=a.user_id
    LEFT JOIN employees e ON e.id=a.employee_id
    JOIN users ab ON ab.id=a.assigned_by
    WHERE 1=1
  `;
  sql += ' AND i.department_id=?';
  const params = [user.department_id];

  sql += ' ORDER BY a.assigned_at DESC';
  const [rows] = await db.query(sql, params);
  return rows;
}

async function transactions(user) {
  let sql = `
    SELECT t.*,i.asset_code,i.name AS item_name,d.name AS department,
           actor.name AS actor_name,COALESCE(e.name,u.name) AS affected_user
    FROM inventory_transactions t
    JOIN inventory_items i ON i.id=t.inventory_id
    JOIN departments d ON d.id=i.department_id
    JOIN users actor ON actor.id=t.actor_id
    LEFT JOIN users u ON u.id=t.user_id
    LEFT JOIN employees e ON e.id=t.employee_id
    WHERE 1=1
  `;
  const params = [];

  if (!isAdmin(user)) {
    sql += ' AND i.department_id=?';
    params.push(user.department_id);
  }

  sql += ' ORDER BY t.created_at DESC LIMIT 500';
  const [rows] = await db.query(sql, params);
  return rows;
}

async function transactionsForItem(user, inventoryId) {
  const item = await get(inventoryId);
  if (!item || !canAccess(user, item)) throw new Error('FORBIDDEN');

  const [rows] = await db.query(`
    SELECT t.*,i.asset_code,i.name AS item_name,d.name AS department,
           actor.name AS actor_name,COALESCE(e.name,u.name) AS affected_user
    FROM inventory_transactions t
    JOIN inventory_items i ON i.id=t.inventory_id
    JOIN departments d ON d.id=i.department_id
    JOIN users actor ON actor.id=t.actor_id
    LEFT JOIN users u ON u.id=t.user_id
    LEFT JOIN employees e ON e.id=t.employee_id
    WHERE t.inventory_id=?
    ORDER BY t.created_at DESC
  `, [inventoryId]);
  return rows;
}

module.exports = {
  list,
  get,
  create,
  update,
  retire,
  assign,
  returnAssignment,
  assignments,
  transactions,
  transactionsForItem,
  canAccess
};
