const db = require('../config/db');
const { audit } = require('./audit.service');
const { randomUUID } = require('crypto');
const MAX_QUANTITY = 999999999.999;

function normalizeQuantity(value) {
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > MAX_QUANTITY) {
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

function normalizeMinimumStock(value) {
  const raw = String(value ?? '0').trim();
  if (!/^(?:\d+(?:\.\d{1,3})?|\.\d{1,3})$/.test(raw)) throw new Error('INVALID_MINIMUM_STOCK');
  const quantity = Number(raw);
  if (!Number.isFinite(quantity) || quantity < 0 || quantity > 999999999.999) {
    throw new Error('INVALID_MINIMUM_STOCK');
  }
  return quantity;
}

async function productIdFor(conn, name, itemType, unit, minimumStock) {
  const [result] = await conn.query(`
    INSERT INTO inventory_products(name,item_type,unit,minimum_stock)
    VALUES(?,?,?,?)
    ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)
  `, [name, itemType, unit, minimumStock]);
  return result.insertId;
}

async function list(user, search) {
  let sql = `
    SELECT i.*,p.minimum_stock,
           (
             SELECT COALESCE(SUM(stock.quantity),0)
             FROM inventory_items stock
             WHERE stock.product_id=i.product_id
               AND stock.status='AVAILABLE'
               AND (stock.expiry_date IS NULL OR stock.expiry_date>=CURDATE())
           ) AS product_available_quantity,
           (i.expiry_date IS NOT NULL AND i.expiry_date<CURDATE()) AS expired
    FROM inventory_items i
    JOIN inventory_products p ON p.id=i.product_id
    WHERE 1=1
  `;
  const params = [];

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
    SELECT i.*,p.name AS product_name,p.item_type AS product_item_type,p.unit AS product_unit,p.minimum_stock
    FROM inventory_items i
    JOIN inventory_products p ON p.id=i.product_id
    WHERE i.id=?
  `, [id]);
  return rows[0] || null;
}

async function batchReceivingRecords() {
  const [rows] = await db.query(`
    SELECT i.batch_number,
           COUNT(*) AS line_count,
           COUNT(DISTINCT i.name) AS chemical_count,
           COUNT(DISTINCT i.vendor_bill_no) AS bill_count,
           MIN(i.received_date) AS first_received_date
    FROM inventory_items i
    WHERE i.chemical_form IS NOT NULL
      AND i.batch_number IS NOT NULL
    GROUP BY i.batch_number
    ORDER BY i.batch_number ASC
  `);
  return rows;
}

async function batchReceivingRecord(batchNumber) {
  const batch = String(batchNumber || '').trim();
  if (!batch || batch.length > 100) throw new Error('INVALID_BATCH');

  const [lines] = await db.query(`
    SELECT i.id,i.asset_code,i.name,i.chemical_form,i.batch_number,
           i.vendor_name,i.vendor_bill_no,i.received_date,i.received_by,
           i.make_grade,i.manufacturer,i.expiry_date,i.location,
           i.quantity,i.unit,i.container_capacity,i.container_unit,
           COALESCE((
             SELECT SUM(
               CASE
                 WHEN COALESCE(JSON_UNQUOTE(JSON_EXTRACT(t.details,'$.restock')),'false')='true' THEN 0
                 ELSE t.quantity
               END
             )
             FROM inventory_transactions t
             WHERE t.inventory_id=i.id AND t.action='ADD'
           ),i.quantity) AS quantity_received
    FROM inventory_items i
    WHERE i.chemical_form IS NOT NULL
      AND i.batch_number=?
    ORDER BY i.name ASC,i.container_capacity ASC,i.container_unit ASC,i.id ASC
  `, [batch]);
  if (!lines.length) return null;

  return {
    batch_number: batch,
    lines
  };
}

async function chemicalBatches() {
  const [rows] = await db.query(`
    SELECT DISTINCT name,chemical_form,batch_number,manufacturer,expiry_date
    FROM inventory_items
    WHERE chemical_form IS NOT NULL AND batch_number IS NOT NULL
    ORDER BY name,batch_number
  `);
  return rows;
}

async function create(data, user) {
  const chemical = chemicalDetails(data);
  const quantity = normalizeStockQuantity(data.quantity, chemical);
  const itemType = chemical || data.item_type === 'CONSUMABLE' ? 'CONSUMABLE' : 'ASSET';
  const assetCode = `${chemical ? 'CHEM' : 'STK'}-${randomUUID().toUpperCase()}`;
  const name = String(data.name || '').trim();
  if (!name || name.length > 150) throw new Error('INVALID_ITEM_NAME');
  const minimumStock = normalizeMinimumStock(data.minimum_stock);

  const receivedDate = String(data.received_date || '').trim();
  const vendorName = String(data.vendor_name || '').trim();
  const vendorBillNo = String(data.vendor_bill_no || '').trim();
  const makeGrade = String(data.make_grade || '').trim();
  const receivedBy = String(data.received_by || '').trim();
  const stockUnit = chemical ? chemical.packageUnit : data.unit || 'Piece';

  const conn = await db.getConnection();
  let inventoryId;
  try {
    await conn.beginTransaction();
    const productId = await productIdFor(conn, name, itemType, stockUnit, minimumStock);
    const [result] = await conn.query(`
      INSERT INTO inventory_items(
        product_id,asset_code,name,item_type,category,description,serial_number,
        quantity,unit,status,location,batch_number,manufacturer,
        vendor_name,vendor_bill_no,make_grade,received_by,received_date,expiry_date,
        chemical_form,container_capacity,container_unit
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `, [
      productId,
      assetCode,
      name,
      itemType,
      data.category || null,
      data.description || null,
      data.serial_number || null,
      quantity,
      stockUnit,
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
    inventoryId = result.insertId;
    await conn.query(
      'INSERT INTO inventory_transactions(inventory_id,actor_id,action,quantity,unit,details) VALUES(?,?,?,?,?,?)',
      [inventoryId, user.id, 'ADD', quantity, chemical ? chemical.packageUnit : data.unit || 'Piece', JSON.stringify({
      asset_code: assetCode,
      chemical_form: chemical?.form || null,
      batch_number: chemical?.batchNumber || data.batch_number || null,
      expiry_date: chemical?.expiryDate || data.expiry_date || null,
      container_capacity: chemical?.capacity || null,
      container_unit: chemical?.unit || null,
      balance_after: quantity
      })]
    );
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
  await audit(user.id, 'INVENTORY_CREATED', 'inventory_items', inventoryId, {
    asset_code: assetCode,
  }, user.ip);
}

async function restock(id, rawQuantity, user) {
  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      'SELECT * FROM inventory_items WHERE id=? FOR UPDATE',
      [id]
    );
    if (!rows.length) throw new Error('NOT_FOUND');
    const item = rows[0];
    if (item.status === 'RETIRED') throw new Error('RETIRED_ITEM');
    if (!['AVAILABLE', 'ASSIGNED'].includes(item.status)) throw new Error('STOCK_NOT_AVAILABLE');

    const chemical = Boolean(item.chemical_form);
    const quantity = normalizeStockQuantity(rawQuantity, chemical);
    const balance = Number(item.quantity) + quantity;
    if (balance > MAX_QUANTITY) throw new Error('STOCK_LIMIT');
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

async function adjustStock(id, rawDelta, note, user) {
  const adjustmentNote = String(note || '').trim();
  if (!adjustmentNote || adjustmentNote.length > 500) throw new Error('INVALID_REMARKS');
  const raw = String(rawDelta || '').trim();
  if (!/^-?(?:\d+(?:\.\d{1,3})?|\.\d{1,3})$/.test(raw)) throw new Error('INVALID_QUANTITY');
  const delta = Number(raw);
  if (!Number.isFinite(delta) || delta === 0 || Math.abs(delta) > 999999999.999) {
    throw new Error('INVALID_QUANTITY');
  }
  const conn = await db.getConnection();
  let item;
  let balanceAfter;
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT * FROM inventory_items WHERE id=? FOR UPDATE', [id]);
    if (!rows.length) throw new Error('NOT_FOUND');
    item = rows[0];
    if (item.status === 'RETIRED') throw new Error('RETIRED_ITEM');
    if (item.chemical_form && !Number.isInteger(delta)) throw new Error('INVALID_QUANTITY');
    balanceAfter = Number(item.quantity) + delta;
    if (balanceAfter < 0) throw new Error('INSUFFICIENT');
    if (balanceAfter > MAX_QUANTITY) throw new Error('STOCK_LIMIT');

    await conn.query(`
      UPDATE inventory_items
      SET quantity=?,
          status=CASE WHEN ?>0 AND status='ASSIGNED' THEN 'AVAILABLE' ELSE status END
      WHERE id=?
    `, [balanceAfter, delta, id]);
    await conn.query(`
      INSERT INTO inventory_transactions(inventory_id,actor_id,action,quantity,unit,details)
      VALUES(?,?,'ADJUST',?,?,?)
    `, [id, user.id, delta, item.unit, JSON.stringify({
      note: adjustmentNote,
      balance_after: balanceAfter
    })]);
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
  await audit(user.id, 'INVENTORY_ADJUSTED', 'inventory_items', id, {
    quantity: delta,
    unit: item.unit,
    balance_after: balanceAfter,
    note: adjustmentNote
  }, user.ip);
}

async function disposeStock(id, rawQuantity, note, user) {
  const disposalNote = String(note || '').trim();
  if (!disposalNote || disposalNote.length > 500) throw new Error('INVALID_REMARKS');
  const conn = await db.getConnection();
  let item;
  let quantity;
  let balanceAfter;
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT * FROM inventory_items WHERE id=? FOR UPDATE', [id]);
    if (!rows.length) throw new Error('NOT_FOUND');
    item = rows[0];
    if (item.status === 'RETIRED') throw new Error('RETIRED_ITEM');
    quantity = normalizeStockQuantity(rawQuantity, Boolean(item.chemical_form));
    if (quantity > Number(item.quantity)) throw new Error('INSUFFICIENT');
    balanceAfter = Number(item.quantity) - quantity;

    await conn.query('UPDATE inventory_items SET quantity=? WHERE id=?', [balanceAfter, id]);
    await conn.query(`
      INSERT INTO inventory_transactions(inventory_id,actor_id,action,quantity,unit,details)
      VALUES(?,?,'DISPOSE',?,?,?)
    `, [id, user.id, quantity, item.unit, JSON.stringify({
      note: disposalNote,
      balance_after: balanceAfter
    })]);
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
  await audit(user.id, 'INVENTORY_DISPOSED', 'inventory_items', id, {
    quantity,
    unit: item.unit,
    balance_after: balanceAfter,
    note: disposalNote
  }, user.ip);
}

async function update(id, data, user) {
  const chemical = chemicalDetails(data);
  const name = String(data.name || '').trim();
  if (!name || name.length > 150) throw new Error('INVALID_ITEM_NAME');
  const itemType = chemical || data.item_type === 'CONSUMABLE' ? 'CONSUMABLE' : 'ASSET';
  const minimumStock = normalizeMinimumStock(data.minimum_stock);
  const conn = await db.getConnection();
  let old;
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(`
      SELECT i.*,p.name AS product_name,p.item_type AS product_item_type,p.unit AS product_unit,p.minimum_stock
      FROM inventory_items i
      JOIN inventory_products p ON p.id=i.product_id
      WHERE i.id=? FOR UPDATE
    `, [id]);
    if (!rows.length) throw new Error('NOT_FOUND');
    old = rows[0];
    if (old.status === 'RETIRED') throw new Error('RETIRED_ITEM');
    if (Boolean(chemical) !== Boolean(old.chemical_form)) throw new Error('CHEMICAL_TYPE_IMMUTABLE');
    const stockUnit = chemical ? chemical.packageUnit : data.unit || old.unit;
    if (stockUnit !== old.unit) throw new Error('ITEM_UNIT_IMMUTABLE');
    if (itemType !== old.item_type) {
      const [[assignmentCount]] = await conn.query(
        'SELECT COUNT(*) AS count FROM inventory_assignments WHERE inventory_id=?',
        [id]
      );
      if (Number(assignmentCount.count) > 0) throw new Error('ITEM_TYPE_IMMUTABLE');
    }

    if (chemical) {
      const [[assignmentCount]] = await conn.query(
        'SELECT COUNT(*) AS count FROM inventory_assignments WHERE inventory_id=?',
        [id]
      );
      if (Number(assignmentCount.count) > 0 && (
        chemical.form !== old.chemical_form ||
        name !== old.name ||
        chemical.batchNumber !== old.batch_number ||
        chemical.expiryDate !== old.expiry_date ||
        Number(chemical.capacity) !== Number(old.container_capacity) ||
        chemical.unit !== old.container_unit
      )) {
        throw new Error('CHEMICAL_STOCK_METADATA_LOCKED');
      }
    }

    const productId = await productIdFor(conn, name, itemType, stockUnit, minimumStock);
    if (Number(productId) === Number(old.product_id)) {
      await conn.query('UPDATE inventory_products SET minimum_stock=? WHERE id=?', [minimumStock, productId]);
    }
    const receivedDate = String(data.received_date || '').trim();
    const vendorName = String(data.vendor_name || '').trim();
    const vendorBillNo = String(data.vendor_bill_no || '').trim();
    const makeGrade = String(data.make_grade || '').trim();
    const receivedBy = String(data.received_by || '').trim();

    await conn.query(`
      UPDATE inventory_items SET
        product_id=?,name=?,item_type=?,description=?,serial_number=?,
        unit=?,location=?,batch_number=?,manufacturer=?,
        vendor_name=?,vendor_bill_no=?,make_grade=?,received_by=?,received_date=?,expiry_date=?,
        chemical_form=?,container_capacity=?,container_unit=?
      WHERE id=?
    `, [
      productId,
      name,
      itemType,
      data.description || null,
      data.serial_number || null,
      stockUnit,
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

    await conn.query(
      'INSERT INTO inventory_transactions(inventory_id,actor_id,action,details) VALUES(?,?,?,?)',
      [id, user.id, 'UPDATE', JSON.stringify({ before: old, after: data })]
    );
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
  await audit(user.id, 'INVENTORY_UPDATED', 'inventory_items', id, {
    asset_code: old.asset_code
  }, user.ip);
}

async function retire(id, user) {
  const conn = await db.getConnection();
  let item;
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT * FROM inventory_items WHERE id=? FOR UPDATE', [id]);
    if (!rows.length) throw new Error('NOT_FOUND');
    item = rows[0];
    if (item.status === 'RETIRED') {
      await conn.commit();
      return;
    }
    const [[active]] = await conn.query(`
      SELECT COALESCE(SUM(CASE
        WHEN action='ASSIGN' THEN quantity
        WHEN action IN ('CONSUME','RETURN') THEN -quantity
        ELSE 0
      END),0) AS balance
      FROM inventory_transactions
      WHERE inventory_id=? AND assignment_id IS NOT NULL
    `, [id]);
    if (Number(active.balance) > 0) throw new Error('RETURN_ACTIVE_ASSIGNMENTS');

    await conn.query("UPDATE inventory_items SET status='RETIRED' WHERE id=?", [id]);
    await conn.query(
      'INSERT INTO inventory_transactions(inventory_id,actor_id,action,details) VALUES(?,?,?,?)',
      [id, user.id, 'RETIRE', JSON.stringify({ previous_status: item.status })]
    );
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
  await audit(user.id, 'INVENTORY_RETIRED', 'inventory_items', id, null, user.ip);
}

async function assign(id, employeeId, rawQuantity, remarks, actor) {
  const assignmentRemarks = String(remarks || '').trim();
  if (assignmentRemarks.length > 500) throw new Error('INVALID_REMARKS');
  const conn = await db.getConnection();
  let assignmentId;
  let item;
  let quantity;

  try {
    await conn.beginTransaction();

    const [items] = await conn.query(
      `SELECT i.*, (i.expiry_date IS NOT NULL AND i.expiry_date<CURDATE()) AS expired
       FROM inventory_items i WHERE i.id=? FOR UPDATE`,
      [id]
    );
    if (!items.length) throw new Error('NOT_FOUND');
    item = items[0];

    quantity = normalizeStockQuantity(rawQuantity, Boolean(item.chemical_form));
    if (item.status !== 'AVAILABLE' || item.expired || Number(item.quantity) < quantity) {
      throw new Error('INSUFFICIENT');
    }

    const [employees] = await conn.query(`
      SELECT id,status
      FROM employees
      WHERE id=? AND status='ACTIVE'
      LIMIT 1
    `, [employeeId]);
    if (!employees.length) throw new Error('INVALID_EMPLOYEE');

    const [stockUpdate] = await conn.query(`
      UPDATE inventory_items
      SET quantity=quantity-?,
          status=CASE WHEN quantity-?=0 THEN 'ASSIGNED' ELSE 'AVAILABLE' END
      WHERE id=? AND status='AVAILABLE' AND quantity>=?
    `, [quantity, quantity, id, quantity]);
    if (stockUpdate.affectedRows !== 1) throw new Error('INSUFFICIENT');

    const [assignment] = await conn.query(`
      INSERT INTO inventory_assignments(
        inventory_id,employee_id,remarks,quantity,unit,chemical_form,batch_number,expiry_date,
        container_capacity,container_unit,assigned_by
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
    `, [
      id, employeeId, assignmentRemarks || null, quantity, item.unit, item.chemical_form, item.batch_number,
      item.expiry_date, item.container_capacity, item.container_unit, actor.id
    ]);
    assignmentId = assignment.insertId;

    await conn.query(`
      INSERT INTO inventory_transactions(inventory_id,assignment_id,employee_id,actor_id,action,quantity,unit,details)
      VALUES(?,?,?,?,?,?,?,?)
    `, [id, assignmentId, employeeId, actor.id, 'ASSIGN', quantity, item.unit,
      JSON.stringify({
        remarks: assignmentRemarks || null,
        batch_number: item.batch_number,
        expiry_date: item.expiry_date,
        chemical_form: item.chemical_form,
        container_capacity: item.container_capacity,
        container_unit: item.container_unit,
        balance_after: Number(item.quantity) - quantity
      })]);

    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
  await audit(actor.id, 'INVENTORY_ASSIGNED', 'inventory_items', id, {
    assignment_id: assignmentId,
    employee_id: employeeId,
    quantity,
    unit: item.unit,
    batch_number: item.batch_number,
    expiry_date: item.expiry_date
  }, actor.ip);
  return assignmentId;
}

async function assignmentMovement(assignmentId, rawQuantity, note, actor, action) {
  const movementNote = String(note || '').trim();
  if (movementNote.length > 500) throw new Error('INVALID_REMARKS');
  const conn = await db.getConnection();
  let assignment;
  let quantity;
  let balanceAfter;
  let movementName;

  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(`
      SELECT a.*,i.item_type,i.status AS inventory_status,i.quantity AS stock_balance
      FROM inventory_assignments a
      JOIN inventory_items i ON i.id=a.inventory_id
      WHERE a.id=?
      FOR UPDATE
    `, [assignmentId]);
    if (!rows.length) throw new Error('NOT_FOUND');

    assignment = rows[0];
    const [balanceRows] = await conn.query(`
      SELECT COALESCE(SUM(CASE
        WHEN action='ASSIGN' THEN quantity
        WHEN action IN ('CONSUME','RETURN') THEN -quantity
        ELSE 0
      END),0) AS balance
      FROM inventory_transactions
      WHERE assignment_id=?
    `, [assignmentId]);
    const balance = Number(balanceRows[0].balance);
    if (action === 'CONSUME' && (assignment.item_type === 'ASSET' || assignment.chemical_form)) {
      throw new Error('NOT_CONSUMABLE');
    }
    if (action === 'RETURN' && (assignment.item_type !== 'ASSET' || assignment.chemical_form)) {
      throw new Error('NOT_RETURNABLE');
    }
    quantity = normalizeStockQuantity(rawQuantity, Boolean(assignment.chemical_form));
    if (quantity > balance) throw new Error(action === 'CONSUME' ? 'INVALID_CONSUMPTION' : 'INVALID_RETURN');
    if (action === 'RETURN' && Number(assignment.stock_balance) + quantity > MAX_QUANTITY) {
      throw new Error('STOCK_LIMIT');
    }
    balanceAfter = balance - quantity;
    movementName = action === 'CONSUME' ? 'INVENTORY_CONSUMED' : 'INVENTORY_RETURNED';

    if (action === 'RETURN') {
      await conn.query(`
        UPDATE inventory_items
        SET quantity=quantity+?,
            status=CASE WHEN status='ASSIGNED' THEN 'AVAILABLE' ELSE status END
        WHERE id=?
      `, [quantity, assignment.inventory_id]);
    }

    await conn.query(`
      INSERT INTO inventory_transactions(inventory_id,assignment_id,user_id,employee_id,actor_id,action,quantity,unit,details)
      VALUES(?,?,?,?,?,?,?,?,?)
    `, [assignment.inventory_id, assignmentId, assignment.user_id, assignment.employee_id, actor.id, action, quantity,
      assignment.unit, JSON.stringify({
        note: movementNote || null,
        batch_number: assignment.batch_number,
        expiry_date: assignment.expiry_date,
        chemical_form: assignment.chemical_form,
        container_capacity: assignment.container_capacity,
        container_unit: assignment.container_unit,
        balance_after: balanceAfter
      })]);

    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
  await audit(actor.id, movementName, 'inventory_items', assignment.inventory_id, {
    assignment_id: assignmentId,
    quantity,
    unit: assignment.unit,
    balance_after: balanceAfter,
    note: movementNote || null
  }, actor.ip);
}

async function consumeAssignment(assignmentId, rawQuantity, note, actor) {
  return assignmentMovement(assignmentId, rawQuantity, note, actor, 'CONSUME');
}

async function returnAssignment(assignmentId, rawQuantity, note, actor) {
  return assignmentMovement(assignmentId, rawQuantity, note, actor, 'RETURN');
}

async function assignments(user, employeeId) {
  const params = [];
  let employeeFilter = '';
  if (employeeId) {
    const parsedId = Number(employeeId);
    if (!Number.isInteger(parsedId) || parsedId <= 0) throw new Error('INVALID_EMPLOYEE');
    employeeFilter = 'WHERE a.employee_id=?';
    params.push(parsedId);
  }
  const [rows] = await db.query(`
    SELECT a.*,i.asset_code,i.name AS item_name,i.item_type,i.location,
           COALESCE(b.balance,0) AS remaining_quantity,
           COALESCE(e.name,u.name) AS employee_name,
           COALESCE(e.employee_code,u.employee_code) AS employee_code,
           COALESCE(ab.name,'Deleted user') AS assigned_by_name
    FROM inventory_assignments a
    JOIN inventory_items i ON i.id=a.inventory_id
    LEFT JOIN users u ON u.id=a.user_id
    LEFT JOIN employees e ON e.id=a.employee_id
    LEFT JOIN users ab ON ab.id=a.assigned_by
    LEFT JOIN (
      SELECT assignment_id,SUM(CASE
        WHEN action='ASSIGN' THEN quantity
        WHEN action IN ('CONSUME','RETURN') THEN -quantity
        ELSE 0
      END) AS balance
      FROM inventory_transactions
      WHERE assignment_id IS NOT NULL
      GROUP BY assignment_id
    ) b ON b.assignment_id=a.id
    ${employeeFilter}
    ORDER BY a.assigned_at DESC,a.id DESC
  `, params);
  return rows;
}

async function transactions(user) {
  const [rows] = await db.query(`
    SELECT t.*,i.asset_code,i.name AS item_name,
           COALESCE(actor.name,'Deleted user') AS actor_name,COALESCE(e.name,u.name) AS affected_user
    FROM inventory_transactions t
    JOIN inventory_items i ON i.id=t.inventory_id
    LEFT JOIN users actor ON actor.id=t.actor_id
    LEFT JOIN users u ON u.id=t.user_id
    LEFT JOIN employees e ON e.id=t.employee_id
    ORDER BY t.created_at DESC LIMIT 500
  `);
  return rows;
}

async function transactionsForItem(user, inventoryId) {
  const item = await get(inventoryId);
  if (!item) throw new Error('NOT_FOUND');

  const [rows] = await db.query(`
    SELECT t.*,i.asset_code,i.name AS item_name,
           COALESCE(actor.name,'Deleted user') AS actor_name,COALESCE(e.name,u.name) AS affected_user
    FROM inventory_transactions t
    JOIN inventory_items i ON i.id=t.inventory_id
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
  batchReceivingRecords,
  batchReceivingRecord,
  chemicalBatches,
  create,
  restock,
  adjustStock,
  disposeStock,
  update,
  retire,
  assign,
  returnAssignment,
  assignments,
  transactions,
  transactionsForItem,
};
