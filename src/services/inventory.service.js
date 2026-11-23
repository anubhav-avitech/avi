const db = require('../config/db');
const { audit } = require('./audit.service');
const { randomUUID } = require('crypto');
const MAX_QUANTITY = 999999999.999;
const DEFAULT_MINIMUM_STOCK = 15;

function normalizeQuantity(value) {
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > MAX_QUANTITY) {
    throw new Error('INVALID_QUANTITY');
  }
  return quantity;
}

function chemicalDetails(data, chemicalName) {
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

async function selectedMaster(conn, table, rawId, required, errorCode) {
  const raw = String(rawId || '');
  if (!raw) {
    if (required) throw new Error(errorCode);
    return null;
  }
  if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
    throw new Error(errorCode);
  }
  const [rows] = await conn.query(`SELECT id,name FROM ${table} WHERE id=?`, [Number(raw)]);
  if (!rows.length) throw new Error(errorCode);
  return rows[0];
}

async function selectedInventoryMaster(conn, table, rawId) {
  const raw = String(rawId || '');
  if (!raw) return null;
  if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
    throw new Error('INVALID_ITEM_MASTER');
  }
  const [rows] = await conn.query(
    `SELECT id,name FROM ${table} WHERE id=?`,
    [Number(raw)]
  );
  if (!rows.length) throw new Error('INVALID_ITEM_MASTER');
  return rows[0];
}

function inventoryMasterDetails(data, type) {
  const empty = {
    glassware_type: null,
    capacity: null,
    capacity_unit: null,
    material: null,
    glass_class: null,
    graduation: null,
    equipment_type: null,
    model_number: null,
    technical_specifications: null,
    calibration_required: null,
    calibration_frequency: null,
    warranty_applicable: null
  };
  if (!type) return empty;

  if (type === 'glassware') {
    const glasswareType = String(data.glassware_type || '').trim();
    const rawCapacity = String(data.capacity || '').trim();
    const capacityUnit = String(data.capacity_unit || '');
    const material = String(data.material || '').trim();
    const glassClass = String(data.glass_class || '');
    const graduation = String(data.graduation || '');
    if (
      !glasswareType || glasswareType.length > 100 ||
      !/^(?:\d+(?:\.\d{1,3})?|\.\d{1,3})$/.test(rawCapacity) ||
      Number(rawCapacity) <= 0 || Number(rawCapacity) > MAX_QUANTITY ||
      !['ml', 'L', 'µl'].includes(capacityUnit) ||
      !material || material.length > 100 ||
      !['CLASS_A', 'CLASS_B', 'NOT_APPLICABLE'].includes(glassClass) ||
      !['GRADUATED', 'NON_GRADUATED'].includes(graduation)
    ) {
      throw new Error('INVALID_GLASSWARE_DETAILS');
    }
    return {
      ...empty,
      glassware_type: glasswareType,
      capacity: Number(rawCapacity),
      capacity_unit: capacityUnit,
      material,
      glass_class: glassClass,
      graduation
    };
  }

  if (type === 'equipment') {
    const equipmentType = String(data.equipment_type || '').trim();
    const modelNumber = String(data.model_number || '').trim();
    const technicalSpecifications = String(data.technical_specifications || '').trim();
    const calibrationRequired = String(data.calibration_required ?? '0');
    const calibrationFrequency = String(data.calibration_frequency || '').trim();
    const warrantyApplicable = String(data.warranty_applicable ?? '0');
    if (
      !equipmentType || equipmentType.length > 100 ||
      modelNumber.length > 100 ||
      technicalSpecifications.length > 4000 ||
      !['0', '1'].includes(calibrationRequired) ||
      !['0', '1'].includes(warrantyApplicable) ||
      (calibrationRequired === '1' && (!calibrationFrequency || calibrationFrequency.length > 100))
    ) {
      throw new Error('INVALID_EQUIPMENT_DETAILS');
    }
    return {
      ...empty,
      equipment_type: equipmentType,
      model_number: modelNumber || null,
      technical_specifications: technicalSpecifications || null,
      calibration_required: Number(calibrationRequired),
      calibration_frequency: calibrationRequired === '1' ? calibrationFrequency : null,
      warranty_applicable: Number(warrantyApplicable)
    };
  }

  throw new Error('INVALID_ITEM_MASTER');
}

function normalizeStockQuantity(value, chemical) {
  const quantity = normalizeQuantity(value);
  if (chemical && !Number.isInteger(quantity)) throw new Error('INVALID_QUANTITY');
  return quantity;
}

async function validateReceivedBy(conn, value, user, existingValue = '') {
  const name = String(value || '').trim();
  if (!name) return null;
  if (name === String(existingValue || '').trim()) return name;

  const [rows] = await conn.query(`
    SELECT u.name
    FROM users u
    JOIN roles r ON r.id=u.role_id
    WHERE u.name=? AND u.status='ACTIVE'
      AND (r.name='Inventory User' OR (r.name='Administrator' AND ?=1))
    LIMIT 1
  `, [name, user.role_name === 'Administrator' ? 1 : 0]);
  if (!rows.length) throw new Error('INVALID_RECEIVED_BY');
  return rows[0].name;
}

async function productIdFor(conn, name, itemType, unit, minimumStock) {
  const [result] = await conn.query(`
    INSERT INTO inventory_products(name,item_type,unit,minimum_stock)
    VALUES(?,?,?,?)
    ON DUPLICATE KEY UPDATE minimum_stock=VALUES(minimum_stock),id=LAST_INSERT_ID(id)
  `, [name, itemType, unit, minimumStock]);
  return result.insertId;
}

async function list(user, search) {
  let sql = `
    SELECT i.*,p.minimum_stock,
           c.name AS chemical_master_name,v.name AS vendor_master_name,
           gm.name AS glassware_master_name,em.name AS equipment_master_name,
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
    LEFT JOIN chemical_master c ON c.id=i.chemical_id
    LEFT JOIN vendor_master v ON v.id=i.vendor_id
    LEFT JOIN glassware_master gm ON gm.id=i.glassware_master_id
    LEFT JOIN equipment_instrument_master em ON em.id=i.equipment_master_id
    WHERE 1=1
  `;
  const params = [];

  if (search) {
    sql += ' AND (i.asset_code LIKE ? OR COALESCE(c.name,i.name) LIKE ? OR i.category LIKE ? OR i.serial_number LIKE ? OR i.batch_number LIKE ? OR COALESCE(v.name,i.vendor_name) LIKE ?)';
    const term = `%${String(search).trim()}%`;
    params.push(term, term, term, term, term, term);
  }
  sql += ' ORDER BY COALESCE(c.name,i.name) ASC,i.batch_number ASC,i.updated_at DESC';
  const [rows] = await db.query(sql, params);
  return rows;
}

async function get(id) {
  const [rows] = await db.query(`
    SELECT i.*,p.name AS product_name,p.item_type AS product_item_type,p.unit AS product_unit,p.minimum_stock,
           c.id AS chemical_master_id,c.name AS chemical_master_name,v.id AS vendor_master_id,
           v.name AS vendor_master_name,gm.name AS glassware_master_name,
           em.name AS equipment_master_name
    FROM inventory_items i
    JOIN inventory_products p ON p.id=i.product_id
    LEFT JOIN chemical_master c ON c.id=i.chemical_id
    LEFT JOIN vendor_master v ON v.id=i.vendor_id
    LEFT JOIN glassware_master gm ON gm.id=i.glassware_master_id
    LEFT JOIN equipment_instrument_master em ON em.id=i.equipment_master_id
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
    SELECT i.id,i.asset_code,COALESCE(c.name,i.name) AS name,i.chemical_form,i.batch_number,
           COALESCE(v.name,i.vendor_name) AS vendor_name,i.vendor_bill_no,i.received_date,i.received_by,
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
    LEFT JOIN chemical_master c ON c.id=i.chemical_id
    LEFT JOIN vendor_master v ON v.id=i.vendor_id
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

async function create(data, user) {
  const conn = await db.getConnection();
  let inventoryId;
  let assetCode;
  try {
    await conn.beginTransaction();
    const form = String(data.chemical_form || '').toUpperCase();
    const chemicalMaster = form
      ? await selectedMaster(conn, 'chemical_master', data.chemical_id, true, 'INVALID_CHEMICAL_MASTER')
      : null;
    if (chemicalMaster && (data.glassware_master_id || data.equipment_master_id)) {
      throw new Error('INVALID_ITEM_MASTER');
    }
    if (data.glassware_master_id && data.equipment_master_id) {
      throw new Error('INVALID_ITEM_MASTER');
    }
    const glasswareMaster = await selectedInventoryMaster(conn, 'glassware_master', data.glassware_master_id);
    const equipmentMaster = await selectedInventoryMaster(
      conn,
      'equipment_instrument_master',
      data.equipment_master_id
    );
    const inventoryMaster = glasswareMaster || equipmentMaster;
    const vendorMaster = await selectedMaster(conn, 'vendor_master', data.vendor_id, false, 'INVALID_VENDOR_MASTER');
    const chemical = chemicalDetails(data, chemicalMaster?.name);
    if (chemical && inventoryMaster) throw new Error('INVALID_ITEM_MASTER');
    const quantity = normalizeStockQuantity(data.quantity, chemical);
    const itemType = chemical || (!inventoryMaster && data.item_type === 'CONSUMABLE') ? 'CONSUMABLE' : 'ASSET';
    const assetPrefix = chemical ? 'CHEM' : glasswareMaster ? 'GLS' : equipmentMaster ? 'EQP' : 'STK';
    assetCode = `${assetPrefix}-${randomUUID().toUpperCase()}`;
    const name = chemical
      ? chemicalMaster.name
      : inventoryMaster?.name || String(data.name || '').trim();
    if (!name || name.length > 150) throw new Error('INVALID_ITEM_NAME');
    const minimumStock = DEFAULT_MINIMUM_STOCK;
    const masterDetails = inventoryMasterDetails(
      data,
      glasswareMaster ? 'glassware' : equipmentMaster ? 'equipment' : null
    );
    const receivedDate = String(data.received_date || '').trim();
    const vendorName = vendorMaster?.name || null;
    const vendorBillNo = String(data.vendor_bill_no || '').trim();
    const makeGrade = String(data.make_grade || '').trim();
    const receivedBy = await validateReceivedBy(conn, data.received_by, user);
    const stockUnit = chemical ? chemical.packageUnit : data.unit || 'Piece';
    const productId = await productIdFor(conn, name, itemType, stockUnit, minimumStock);
    const [result] = await conn.query(`
      INSERT INTO inventory_items(
        product_id,chemical_id,vendor_id,glassware_master_id,equipment_master_id,asset_code,name,item_type,category,description,serial_number,
        quantity,unit,status,location,batch_number,manufacturer,
        vendor_name,vendor_bill_no,make_grade,received_by,received_date,expiry_date,
        glassware_type,capacity,capacity_unit,material,glass_class,graduation,
        equipment_type,model_number,technical_specifications,calibration_required,calibration_frequency,warranty_applicable,
        chemical_form,container_capacity,container_unit
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `, [
      productId,
      chemicalMaster?.id || null,
      vendorMaster?.id || null,
      glasswareMaster?.id || null,
      equipmentMaster?.id || null,
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
      masterDetails.glassware_type,
      masterDetails.capacity,
      masterDetails.capacity_unit,
      masterDetails.material,
      masterDetails.glass_class,
      masterDetails.graduation,
      masterDetails.equipment_type,
      masterDetails.model_number,
      masterDetails.technical_specifications,
      masterDetails.calibration_required,
      masterDetails.calibration_frequency,
      masterDetails.warranty_applicable,
      chemical?.form || null,
      chemical?.capacity || null,
      chemical?.unit || null
    ]);
    inventoryId = result.insertId;
    await conn.query(
      'INSERT INTO inventory_transactions(inventory_id,actor_id,action,quantity,unit,details) VALUES(?,?,?,?,?,?)',
      [inventoryId, user.id, 'ADD', quantity, stockUnit, JSON.stringify({
      asset_code: assetCode,
      glassware_master_id: glasswareMaster?.id || null,
      equipment_master_id: equipmentMaster?.id || null,
      glassware_details: glasswareMaster ? {
        glassware_type: masterDetails.glassware_type,
        capacity: masterDetails.capacity,
        capacity_unit: masterDetails.capacity_unit,
        material: masterDetails.material,
        glass_class: masterDetails.glass_class,
        graduation: masterDetails.graduation
      } : null,
      equipment_details: equipmentMaster ? {
        equipment_type: masterDetails.equipment_type,
        model_number: masterDetails.model_number,
        technical_specifications: masterDetails.technical_specifications,
        calibration_required: masterDetails.calibration_required,
        calibration_frequency: masterDetails.calibration_frequency,
        warranty_applicable: masterDetails.warranty_applicable
      } : null,
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
  const conn = await db.getConnection();
  let old;
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(`
      SELECT i.*,p.name AS product_name,p.item_type AS product_item_type,p.unit AS product_unit,p.minimum_stock,
             gm.name AS glassware_master_name,em.name AS equipment_master_name
      FROM inventory_items i
      JOIN inventory_products p ON p.id=i.product_id
      LEFT JOIN glassware_master gm ON gm.id=i.glassware_master_id
      LEFT JOIN equipment_instrument_master em ON em.id=i.equipment_master_id
      WHERE i.id=? FOR UPDATE
    `, [id]);
    if (!rows.length) throw new Error('NOT_FOUND');
    old = rows[0];
    if (old.status === 'RETIRED') throw new Error('RETIRED_ITEM');
    const chemicalForm = String(data.chemical_form || '').toUpperCase();
    const chemicalMaster = chemicalForm
      ? await selectedMaster(conn, 'chemical_master', data.chemical_id, true, 'INVALID_CHEMICAL_MASTER')
      : null;
    const vendorMaster = await selectedMaster(conn, 'vendor_master', data.vendor_id, false, 'INVALID_VENDOR_MASTER');
    const chemical = chemicalDetails(data, chemicalMaster?.name);
    const inventoryMaster = old.glassware_master_id
      ? { name: old.glassware_master_name }
      : old.equipment_master_id
        ? { name: old.equipment_master_name }
        : null;
    const name = chemical
      ? chemicalMaster.name
      : inventoryMaster?.name || String(data.name || '').trim();
    if (!name || name.length > 150) throw new Error('INVALID_ITEM_NAME');
    const itemType = chemical || (!inventoryMaster && data.item_type === 'CONSUMABLE') ? 'CONSUMABLE' : 'ASSET';
    const minimumStock = old.minimum_stock;
    const masterDetails = inventoryMasterDetails(
      data,
      old.glassware_master_id ? 'glassware' : old.equipment_master_id ? 'equipment' : null
    );
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
        Number(chemicalMaster.id) !== Number(old.chemical_id) ||
        name !== (old.chemical_master_name || old.name) ||
        chemical.batchNumber !== old.batch_number ||
        chemical.expiryDate !== old.expiry_date ||
        Number(chemical.capacity) !== Number(old.container_capacity) ||
        chemical.unit !== old.container_unit
      )) {
        throw new Error('CHEMICAL_STOCK_METADATA_LOCKED');
      }
    }

    const productId = await productIdFor(conn, name, itemType, stockUnit, minimumStock);
    const receivedDate = String(data.received_date || '').trim();
    const vendorName = vendorMaster?.name || null;
    const vendorBillNo = String(data.vendor_bill_no || '').trim();
    const makeGrade = String(data.make_grade || '').trim();
    const receivedBy = await validateReceivedBy(conn, data.received_by, user, old.received_by);

    await conn.query(`
      UPDATE inventory_items SET
        product_id=?,chemical_id=?,vendor_id=?,glassware_master_id=?,equipment_master_id=?,name=?,item_type=?,description=?,serial_number=?,
        unit=?,location=?,batch_number=?,manufacturer=?,
        vendor_name=?,vendor_bill_no=?,make_grade=?,received_by=?,received_date=?,expiry_date=?,
        glassware_type=?,capacity=?,capacity_unit=?,material=?,glass_class=?,graduation=?,
        equipment_type=?,model_number=?,technical_specifications=?,calibration_required=?,calibration_frequency=?,warranty_applicable=?,
        chemical_form=?,container_capacity=?,container_unit=?
      WHERE id=?
    `, [
      productId,
      chemicalMaster?.id || null,
      vendorMaster?.id || null,
      old.glassware_master_id || null,
      old.equipment_master_id || null,
      name,
      itemType,
      data.description || null,
      data.serial_number || old.serial_number || null,
      stockUnit,
      data.location || old.location || null,
      chemical ? chemical.batchNumber : data.batch_number || null,
      data.manufacturer || null,
      vendorName || null,
      vendorBillNo || null,
      makeGrade || null,
      receivedBy || null,
      receivedDate || null,
      chemical ? chemical.expiryDate : data.expiry_date || null,
      masterDetails.glassware_type,
      masterDetails.capacity,
      masterDetails.capacity_unit,
      masterDetails.material,
      masterDetails.glass_class,
      masterDetails.graduation,
      masterDetails.equipment_type,
      masterDetails.model_number,
      masterDetails.technical_specifications,
      masterDetails.calibration_required,
      masterDetails.calibration_frequency,
      masterDetails.warranty_applicable,
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
    if (action === 'CONSUME' && assignment.item_type === 'ASSET') {
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
  create,
  restock,
  adjustStock,
  disposeStock,
  update,
  retire,
  assign,
  consumeAssignment,
  returnAssignment,
  assignments,
  transactions,
  transactionsForItem,
};
