const db = require('../config/db');
const { audit } = require('./audit.service');
const { randomUUID } = require('crypto');

function isAdmin(user) {
  return user.role_name === 'Administrator' && user.role_scope === 'ALL';
}

function isDepartmentUser(user) {
  return user.role_name === 'Department User' && user.role_scope === 'DEPARTMENT' && Number(user.department_id) > 0;
}

function normalizeQuantity(value) {
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 999999999.999) {
    throw new Error('INVALID_QUANTITY');
  }
  return quantity;
}

function chemicalDetails(data) {
  const form = String(data.chemical_form || '').toUpperCase();
  if (!form) return null;
  if (!['LIQUID', 'POWDER'].includes(form)) throw new Error('INVALID_CHEMICAL');

  const packageUnit = String(data.unit || '');
  const validPackageUnits = ['Piece', 'Bottle', 'Box', 'Pair', 'Pack', 'Kg', 'Gram', 'Liter', 'ml', 'Kit', 'Set'];
  const rawCapacity = String(data.container_capacity || '');
  if (!/^\d+(?:\.\d{1,3})?$/.test(rawCapacity)) throw new Error('INVALID_CHEMICAL');
  const capacity = normalizeQuantity(rawCapacity);
  const unit = String(data.container_unit || '');
  const validUnits = form === 'LIQUID' ? ['ml', 'L'] : ['g', 'kg'];
  const chemicalName = String(data.name || '').trim();
  const batchNumber = String(data.batch_number || '').trim();
  const expiryDate = String(data.expiry_date || '');
  const parsedExpiry = new Date(`${expiryDate}T00:00:00Z`);
  if (
    !validPackageUnits.includes(packageUnit) ||
    !validUnits.includes(unit) ||
    !chemicalName ||
    chemicalName.length > 150 ||
    !batchNumber ||
    batchNumber.length > 100 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(expiryDate) ||
    expiryDate < '1000-01-01' ||
    Number.isNaN(parsedExpiry.getTime()) ||
    parsedExpiry.toISOString().slice(0, 10) !== expiryDate
  ) {
    throw new Error('INVALID_CHEMICAL');
  }

  return {
    form,
    capacity,
    unit,
    packageUnit,
    batchNumber,
    expiryDate
  };
}

function normalizeStockQuantity(value, chemical) {
  const quantity = normalizeQuantity(value);
  if (chemical && !Number.isInteger(quantity)) throw new Error('INVALID_QUANTITY');
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
    sql += ' AND (i.asset_code LIKE ? OR i.name LIKE ? OR i.category LIKE ? OR i.serial_number LIKE ? OR i.batch_number LIKE ?)';
    const term = `%${String(search).trim()}%`;
    params.push(term, term, term, term, term);
  }

  sql += ' ORDER BY i.name ASC,i.batch_number ASC,i.updated_at DESC';
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

async function chemicalBatches(departmentId) {
  const [rows] = await db.query(`
    SELECT DISTINCT name,chemical_form,batch_number,manufacturer,expiry_date
    FROM inventory_items
    WHERE department_id=? AND chemical_form IS NOT NULL AND batch_number IS NOT NULL
    ORDER BY name,batch_number
  `, [departmentId]);
  return rows;
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
  const chemical = chemicalDetails(data);
  const quantity = normalizeStockQuantity(data.quantity, chemical);
  const itemType = chemical || data.item_type === 'CONSUMABLE' ? 'CONSUMABLE' : 'ASSET';
  const assetCode = `${chemical ? 'CHEM' : 'STK'}-${randomUUID().toUpperCase()}`;

  const receivedDate = String(data.received_date || '').trim();
  const vendorName = String(data.vendor_name || '').trim();
  const vendorBillNo = String(data.vendor_bill_no || '').trim();
  const makeGrade = String(data.make_grade || '').trim();
  const receivedBy = String(data.received_by || '').trim();

  const [result] = await db.query(`
    INSERT INTO inventory_items(
      asset_code,name,item_type,category,description,serial_number,
      quantity,unit,department_id,status,location,batch_number,manufacturer,
      vendor_name,vendor_bill_no,make_grade,received_by,received_date,expiry_date,
      chemical_form,container_capacity,container_unit
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `, [
    assetCode,
    String(data.name || '').trim(),
    itemType,
    data.category || null,
    data.description || null,
    data.serial_number || null,
    quantity,
    chemical ? chemical.packageUnit : data.unit || 'Piece',
    departmentId,
    'AVAILABLE',
    data.location || null,
    chemical ? chemical.batchNumber : data.batch_number || null,
    data.manufacturer || null,
    vendorName || null,
    vendorBillNo || null,
    makeGrade || null,
    receivedBy || null,
    receivedDate || null,
    chemical ? chemical.expiryDate : data.expiry_date || null,
    chemical?.form || null,
    chemical?.capacity || null,
    chemical?.unit || null
  ]);

  await db.query(
    'INSERT INTO inventory_transactions(inventory_id,actor_id,action,quantity,unit,details) VALUES(?,?,?,?,?,?)',
    [result.insertId, user.id, 'ADD', quantity, chemical ? chemical.packageUnit : data.unit || 'Piece', JSON.stringify({
      asset_code: assetCode,
      chemical_form: chemical?.form || null,
      batch_number: chemical?.batchNumber || data.batch_number || null,
      expiry_date: chemical?.expiryDate || data.expiry_date || null,
      container_capacity: chemical?.capacity || null,
      container_unit: chemical?.unit || null,
      balance_after: quantity
    })]
  );
  await audit(user.id, 'INVENTORY_CREATED', 'inventory_items', result.insertId, {
    asset_code: assetCode,
    department_id: departmentId
  }, user.ip);
}

async function restock(id, rawQuantity, user) {
  if (!isDepartmentUser(user)) throw new Error('FORBIDDEN');
  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      'SELECT * FROM inventory_items WHERE id=? FOR UPDATE',
      [id]
    );
    if (!rows.length) throw new Error('NOT_FOUND');
    const item = rows[0];
    if (!canAccess(user, item)) throw new Error('FORBIDDEN');
    if (item.status === 'RETIRED') throw new Error('RETIRED_ITEM');
    if (!['AVAILABLE', 'ASSIGNED'].includes(item.status)) throw new Error('STOCK_NOT_AVAILABLE');

    const chemical = Boolean(item.chemical_form);
    const quantity = normalizeStockQuantity(rawQuantity, chemical);
    const balance = Number(item.quantity) + quantity;
    await conn.query(
      "UPDATE inventory_items SET quantity=?,status='AVAILABLE' WHERE id=?",
      [balance, id]
    );
    await conn.query(
      'INSERT INTO inventory_transactions(inventory_id,actor_id,action,quantity,unit,details) VALUES(?,?,?,?,?,?)',
      [id, user.id, 'ADD', quantity, item.unit, JSON.stringify({
        restock: true,
        batch_number: item.batch_number,
        expiry_date: item.expiry_date,
        container_capacity: item.container_capacity,
        container_unit: item.container_unit,
        balance_after: balance
      })]
    );
    await conn.commit();
    await audit(user.id, 'INVENTORY_RESTOCKED', 'inventory_items', id, {
      quantity,
      unit: item.unit,
      balance_after: balance
    }, user.ip);
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function update(id, data, user) {
  const old = await get(id);
  if (!old || !canAccess(user, old)) throw new Error('FORBIDDEN');
  if (old.status === 'RETIRED') throw new Error('RETIRED_ITEM');

  const chemical = chemicalDetails(data);
  if (Boolean(chemical) !== Boolean(old.chemical_form)) throw new Error('CHEMICAL_TYPE_IMMUTABLE');

  const receivedDate = String(data.received_date || '').trim();
  const vendorName = String(data.vendor_name || '').trim();
  const vendorBillNo = String(data.vendor_bill_no || '').trim();
  const makeGrade = String(data.make_grade || '').trim();
  const receivedBy = String(data.received_by || '').trim();

  if (chemical) {
    const [[assignmentCount]] = await db.query(
      'SELECT COUNT(*) AS count FROM inventory_assignments WHERE inventory_id=?',
      [id]
    );
    if (Number(assignmentCount.count) > 0) {
      if (
        chemical.form !== old.chemical_form ||
        String(data.name || '').trim() !== old.name ||
        chemical.batchNumber !== old.batch_number ||
        chemical.expiryDate !== old.expiry_date ||
        Number(chemical.capacity) !== Number(old.container_capacity) ||
        chemical.unit !== old.container_unit
      ) {
        throw new Error('CHEMICAL_STOCK_METADATA_LOCKED');
      }
    }
  }
  const departmentId = departmentForWrite(user, data.department_id || old.department_id);
  const itemType = chemical || data.item_type === 'CONSUMABLE' ? 'CONSUMABLE' : 'ASSET';

  await db.query(`
    UPDATE inventory_items SET
      name=?,item_type=?,description=?,serial_number=?,
      unit=?,department_id=?,location=?,batch_number=?,manufacturer=?,
      vendor_name=?,vendor_bill_no=?,make_grade=?,received_by=?,received_date=?,expiry_date=?,
      chemical_form=?,container_capacity=?,container_unit=?
    WHERE id=?
  `, [
    String(data.name || '').trim(),
    itemType,
    data.description || null,
    data.serial_number || null,
    chemical ? chemical.packageUnit : data.unit || old.unit,
    departmentId,
    data.location || null,
    chemical ? chemical.batchNumber : data.batch_number || null,
    data.manufacturer || null,
    vendorName || null,
    vendorBillNo || null,
    makeGrade || null,
    receivedBy || null,
    receivedDate || null,
    chemical ? chemical.expiryDate : data.expiry_date || null,
    chemical?.form || null,
    chemical?.capacity || null,
    chemical?.unit || null,
    id
  ]);

  await db.query(
    'INSERT INTO inventory_transactions(inventory_id,actor_id,action,details) VALUES(?,?,?,?)',
    [id, user.id, 'UPDATE', JSON.stringify({ before: old, after: data })]
  );
  await audit(user.id, 'INVENTORY_UPDATED', 'inventory_items', id, {
    asset_code: old.asset_code,
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
    const quantity = normalizeStockQuantity(rawQuantity, Boolean(item.chemical_form));
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
      INSERT INTO inventory_assignments(
        inventory_id,employee_id,quantity,unit,chemical_form,batch_number,expiry_date,
        container_capacity,container_unit,assigned_by
      ) VALUES(?,?,?,?,?,?,?,?,?,?)
    `, [
      id, employeeId, quantity, item.unit, item.chemical_form, item.batch_number,
      item.expiry_date, item.container_capacity, item.container_unit, actor.id
    ]);

    await conn.query(`
      INSERT INTO inventory_transactions(inventory_id,employee_id,actor_id,action,quantity,unit,details)
      VALUES(?,?,?,?,?,?,?)
    `, [id, employeeId, actor.id, 'ASSIGN', quantity, item.unit,
      JSON.stringify({
        assignment_id: assignment.insertId,
        batch_number: item.batch_number,
        expiry_date: item.expiry_date,
        chemical_form: item.chemical_form,
        container_capacity: item.container_capacity,
        container_unit: item.container_unit,
        balance_after: Number(item.quantity) - quantity
      })]);

    await conn.commit();
    await audit(actor.id, 'INVENTORY_ASSIGNED', 'inventory_items', id, {
      assignment_id: assignment.insertId,
      employee_id: employeeId,
      quantity,
      unit: item.unit,
      batch_number: item.batch_number,
      expiry_date: item.expiry_date
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
  if (!isAdmin(actor) && !isDepartmentUser(actor)) throw new Error('FORBIDDEN');
  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(`
      SELECT a.*,i.department_id,i.status AS inventory_status,i.quantity AS stock_balance
      FROM inventory_assignments a
      JOIN inventory_items i ON i.id=a.inventory_id
      WHERE a.id=? AND a.returned_at IS NULL
      FOR UPDATE
    `, [assignmentId]);
    if (!rows.length) throw new Error('NOT_FOUND');

    const assignment = rows[0];
    const chemical = Boolean(assignment.chemical_form);
    if (chemical && !isAdmin(actor)) throw new Error('CHEMICAL_RETURN_ADMIN_ONLY');
    const returnNote = String(note || '').trim();
    if (chemical && !returnNote) throw new Error('CHEMICAL_RETURN_NOTE_REQUIRED');
    if (returnNote.length > 500) throw new Error('INVALID_RETURN_NOTE');
    if (!isAdmin(actor) && Number(actor.department_id) !== Number(assignment.department_id)) {
      throw new Error('FORBIDDEN');
    }
    const quantity = normalizeStockQuantity(rawQuantity, chemical);
    if (quantity > Number(assignment.quantity)) throw new Error('INVALID_RETURN');

    const full = quantity === Number(assignment.quantity);
    if (full) {
      await conn.query(`
        UPDATE inventory_assignments
        SET returned_at=NOW(),returned_quantity=?,return_note=?
        WHERE id=?
      `, [quantity, returnNote || null, assignmentId]);
    } else {
      await conn.query(`
        UPDATE inventory_assignments
        SET quantity=quantity-?,return_note=?
        WHERE id=?
      `, [quantity, returnNote || null, assignmentId]);
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
      assignment.unit, JSON.stringify({
        assignment_id: assignmentId,
        note: returnNote || null,
        full_return: full,
        batch_number: assignment.batch_number,
        expiry_date: assignment.expiry_date,
        chemical_form: assignment.chemical_form,
        container_capacity: assignment.container_capacity,
        container_unit: assignment.container_unit,
        balance_after: Number(assignment.stock_balance) + quantity
      })]);

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
  if (!isAdmin(user) && !isDepartmentUser(user)) throw new Error('FORBIDDEN');
  let sql = `
    SELECT a.*,i.asset_code,i.name AS item_name,i.department_id,
           d.name AS department,COALESCE(e.name,u.name) AS user_name,
           COALESCE(e.employee_code,u.employee_code) AS employee_code,
           COALESCE(ab.name,'Deleted user') AS assigned_by_name
    FROM inventory_assignments a
    JOIN inventory_items i ON i.id=a.inventory_id
    JOIN departments d ON d.id=i.department_id
    LEFT JOIN users u ON u.id=a.user_id
    LEFT JOIN employees e ON e.id=a.employee_id
    LEFT JOIN users ab ON ab.id=a.assigned_by
    WHERE 1=1
  `;
  const params = [];
  if (!isAdmin(user)) {
    sql += ' AND i.department_id=?';
    params.push(user.department_id);
  }

  sql += ' ORDER BY a.assigned_at DESC';
  const [rows] = await db.query(sql, params);
  return rows;
}

async function transactions(user) {
  let sql = `
    SELECT t.*,i.asset_code,i.name AS item_name,d.name AS department,
           COALESCE(actor.name,'Deleted user') AS actor_name,COALESCE(e.name,u.name) AS affected_user
    FROM inventory_transactions t
    JOIN inventory_items i ON i.id=t.inventory_id
    JOIN departments d ON d.id=i.department_id
    LEFT JOIN users actor ON actor.id=t.actor_id
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
           COALESCE(actor.name,'Deleted user') AS actor_name,COALESCE(e.name,u.name) AS affected_user
    FROM inventory_transactions t
    JOIN inventory_items i ON i.id=t.inventory_id
    JOIN departments d ON d.id=i.department_id
    LEFT JOIN users actor ON actor.id=t.actor_id
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
  chemicalBatches,
  create,
  restock,
  update,
  retire,
  assign,
  returnAssignment,
  assignments,
  transactions,
  transactionsForItem,
  canAccess
};
