const db = require('../config/db');
const validator = require('validator');

const DEFAULT_COMPANY = {
  id: 1,
  company_name: 'AVITECH NUTRITION PVT. LTD.',
  address: 'GP-37, Sector 18, HSIIDC, Gurugram, Haryana, India 122015',
  contact_number: '+91-124-4011148',
  email: 'purchase@avitechnutrition.com',
  tax_registration_number: '',
  logo_path: '/logo.png',
  jurisdiction: 'Gurugram jurisdiction'
};
const FIXED_COMPANY_NAME = DEFAULT_COMPANY.company_name;
const MAX_AMOUNT_CENTS = 999999999999999;

function normalizeId(value) {
  const raw = String(value || '');
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

function validDate(value) {
  const date = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < '1000-01-01') return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function money(value, field, allowZero = true) {
  const raw = String(value ?? '').trim();
  if (!/^\d{1,13}(?:\.\d{1,2})?$/.test(raw)) throw new Error(`INVALID_${field}`);
  const amount = Number(raw);
  if (!Number.isFinite(amount) || (!allowZero && amount <= 0) || amount > MAX_AMOUNT_CENTS / 100) {
    throw new Error(`INVALID_${field}`);
  }
  return amount;
}

function rowsFrom(value) {
  return Array.isArray(value) ? value : value === undefined ? [] : [value];
}

function validateOrder(data) {
  const errors = {};
  const orderDate = String(data.order_date || '').trim();
  const vendorId = normalizeId(data.vendor_id);
  if (!validDate(orderDate)) errors.order_date = 'Enter a valid order date.';
  if (!vendorId) errors.vendor_id = 'Select a registered vendor.';

  const productNames = rowsFrom(data.product_name);
  const productSizes = rowsFrom(data.product_size || data.description);
  const quantities = rowsFrom(data.quantity);
  const units = rowsFrom(data.unit);
  const rates = rowsFrom(data.rate);
  const count = Math.max(productNames.length, productSizes.length, quantities.length, units.length, rates.length);
  if (!count) errors.items = 'Add at least one product.';
  const items = [];
  let totalCents = 0;
  if (count) {
    for (let index = 0; index < count; index += 1) {
      const productName = String(productNames[index] || '').trim();
      const productSize = String(productSizes[index] || '').trim();
      const quantityRaw = String(quantities[index] || '').trim();
      const unit = String(units[index] || '').trim();
      const rateRaw = String(rates[index] ?? '').trim();
      if (!productName || productName.length > 200) errors[`product_${index}`] = `Product ${index + 1} needs a name of 200 characters or fewer.`;
      if (!productSize || productSize.length > 1000) errors[`product_${index}`] = `Product ${index + 1} needs a size of 1,000 characters or fewer.`;
      if (!/^(?:\d{1,9})(?:\.\d{1,3})?$/.test(quantityRaw) || Number(quantityRaw) <= 0) {
        errors[`product_${index}`] = `Product ${index + 1} needs a valid quantity greater than zero.`;
      }
      if (!unit || unit.length > 30) errors[`product_${index}`] = `Product ${index + 1} needs a unit of 30 characters or fewer.`;
      let rate = 0;
      try {
        rate = money(rateRaw, 'RATE');
      } catch {
        errors[`product_${index}`] = `Product ${index + 1} needs a valid rate.`;
      }
      if (errors[`product_${index}`]) continue;
      const quantity = Number(quantityRaw);
      const amountCents = Math.round(quantity * rate * 100);
      if (!Number.isSafeInteger(amountCents) || amountCents < 0 || totalCents + amountCents > MAX_AMOUNT_CENTS) {
        errors[`product_${index}`] = `Product ${index + 1} amount exceeds the supported order total.`;
        continue;
      }
      totalCents += amountCents;
      items.push({
        serial_number: index + 1,
        product_name: productName,
        product_size: productSize || null,
        quantity,
        unit,
        rate,
        amount: amountCents / 100,
        description: productSize || null
      });
    }
  }

  const paymentMode = String(data.payment_mode || '').trim();
  let advancePercent = null;
  if (!paymentMode) {
    advancePercent = null;
  } else if (paymentMode === '0' || paymentMode === '0%') {
    advancePercent = 0;
  } else if (paymentMode === '50') {
    advancePercent = 50;
  } else if (paymentMode === '100') {
    advancePercent = 100;
  } else if (paymentMode === 'custom') {
    const raw = String(data.advance_percent ?? '').trim();
    if (!raw) {
      errors.advance_percent = 'Choose a payment percentage or enter a custom value.';
    } else if (!/^(?:\d{1,3})(?:\.\d{1,2})?$/.test(raw) || Number(raw) < 0 || Number(raw) > 100) {
      errors.advance_percent = 'Advance payment must be between 0% and 100%.';
    } else {
      advancePercent = Number(raw);
    }
  } else {
    errors.advance_percent = 'Select valid payment terms.';
  }

  const paymentConditions = String(data.payment_conditions || '').trim();
  const notes = String(data.notes || '').trim();
  if (paymentConditions.length > 1000) errors.payment_conditions = 'Payment conditions must be 1,000 characters or fewer.';
  if (notes.length > 2000) errors.notes = 'Additional notes must be 2,000 characters or fewer.';
  if (Object.keys(errors).length) {
    const error = new Error('INVALID_PURCHASE_ORDER');
    error.fields = errors;
    throw error;
  }
  const totalAmount = totalCents / 100;
  const advanceAmount = advancePercent === null ? 0 : totalAmount * (advancePercent / 100);
  const remainingAmount = totalAmount - advanceAmount;
  return {
    order_date: orderDate,
    vendor_id: vendorId,
    items: items.map(item => ({
      ...item,
      description: item.description || null,
      product_size: item.product_size || null
    })),
    total_amount: totalAmount,
    advance_percent: advancePercent,
    advance_amount: advanceAmount,
    remaining_amount: remainingAmount,
    payment_conditions: paymentConditions || null,
    notes: notes || null
  };
}

async function companySettings(conn = db) {
  const [rows] = await conn.query('SELECT * FROM company_settings WHERE id=1');
  return rows[0] || { ...DEFAULT_COMPANY };
}

async function updateCompanySettings(data) {
  const values = {
    company_name: FIXED_COMPANY_NAME,
    address: String(data.address || '').trim(),
    contact_number: String(data.contact_number || '').trim(),
    email: String(data.email || '').trim(),
    tax_registration_number: String(data.tax_registration_number || '').trim(),
    logo_path: String(data.logo_path || '/logo.png').trim() || '/logo.png',
    jurisdiction: String(data.jurisdiction || '').trim()
  };
  const errors = {};
  if (values.address.length > 500) errors.address = 'Address must be 500 characters or fewer.';
  if (values.contact_number.length > 30) errors.contact_number = 'Contact number must be 30 characters or fewer.';
  if (values.email && (values.email.length > 254 || !validator.isEmail(values.email))) errors.email = 'Enter a valid email address.';
  if (values.tax_registration_number.length > 30) errors.tax_registration_number = 'Tax registration number must be 30 characters or fewer.';
  if (values.jurisdiction.length > 150) errors.jurisdiction = 'Jurisdiction must be 150 characters or fewer.';
  if (Object.keys(errors).length) {
    const error = new Error('INVALID_COMPANY_SETTINGS');
    error.fields = errors;
    throw error;
  }
  await db.query(`
    INSERT INTO company_settings(id,company_name,address,contact_number,email,tax_registration_number,logo_path,jurisdiction)
    VALUES(1,?,?,?,?,?,?,?)
    ON DUPLICATE KEY UPDATE company_name=VALUES(company_name),address=VALUES(address),
      contact_number=VALUES(contact_number),email=VALUES(email),
      tax_registration_number=VALUES(tax_registration_number),logo_path=VALUES(logo_path),
      jurisdiction=VALUES(jurisdiction)
  `, [values.company_name, values.address || null, values.contact_number || null, values.email || null,
    values.tax_registration_number || null, values.logo_path, values.jurisdiction || null]);
}

async function snapshot(conn, orderId) {
  const [orders] = await conn.query('SELECT * FROM purchase_orders WHERE id=?', [orderId]);
  if (!orders.length) return null;
  const [items] = await conn.query(
    'SELECT * FROM purchase_order_items WHERE purchase_order_id=? ORDER BY serial_number',
    [orderId]
  );
  return { ...orders[0], items };
}

async function list(filters = {}) {
  const query = String(filters.q || '').trim();
  const from = String(filters.from || '').trim();
  const to = String(filters.to || '').trim();
  const errors = {};
  if (from && !validDate(from)) errors.from = 'Enter a valid start date.';
  if (to && !validDate(to)) errors.to = 'Enter a valid end date.';
  if (from && to && validDate(from) && validDate(to) && from > to) errors.range = 'Start date must be on or before end date.';
  if (Object.keys(errors).length) {
    const error = new Error('INVALID_PURCHASE_ORDER_FILTER');
    error.fields = errors;
    throw error;
  }
  let sql = `
    SELECT id,po_number,order_date,vendor_name,total_amount,advance_percent,
           advance_amount,remaining_amount,created_at,updated_at
    FROM purchase_orders WHERE 1=1
  `;
  const params = [];
  if (query) {
    sql += ' AND (po_number LIKE ? OR vendor_name LIKE ?)';
    params.push(`%${query}%`, `%${query}%`);
  }
  if (from) {
    sql += ' AND order_date>=?';
    params.push(from);
  }
  if (to) {
    sql += ' AND order_date<=?';
    params.push(to);
  }
  sql += ' ORDER BY order_date DESC,id DESC';
  const [orders] = await db.query(sql, params);
  return orders;
}

async function get(rawId) {
  const id = normalizeId(rawId);
  if (!id) return null;
  return snapshot(db, id);
}

async function insertItems(conn, orderId, items) {
  for (let offset = 0; offset < items.length; offset += 100) {
    const batch = items.slice(offset, offset + 100);
    const values = [];
    const placeholders = batch.map(item => {
      const description = item.product_size || item.description || null;
      values.push(orderId, item.serial_number, item.product_name, description, item.quantity, item.unit, item.rate, item.amount);
      return '(?,?,?,?,?,?,?,?)';
    });
    await conn.query(`
      INSERT INTO purchase_order_items(
        purchase_order_id,serial_number,product_name,description,quantity,unit,rate,amount
      ) VALUES ${placeholders.join(',')}
    `, values);
  }
}

async function saveHistory(conn, order, action, actorId) {
  await conn.query(`
    INSERT INTO purchase_order_history(purchase_order_id,po_number,action,actor_id,snapshot)
    VALUES(?,?,?,?,?)
  `, [order.id, order.po_number, action, actorId, JSON.stringify(order)]);
}

async function create(data, actor) {
  const order = validateOrder(data);
  const conn = await db.getConnection();
  let orderId;
  try {
    await conn.beginTransaction();
    const [vendors] = await conn.query('SELECT * FROM vendor_master WHERE id=? FOR UPDATE', [order.vendor_id]);
    if (!vendors.length) throw new Error('INVALID_VENDOR');
    const company = await companySettings(conn);
    const vendor = vendors[0];
    const [result] = await conn.query(`
      INSERT INTO purchase_orders(
        order_date,vendor_id,vendor_name,vendor_contact_number,vendor_address,vendor_email,
        company_name,company_address,company_contact_number,company_email,company_tax_registration_number,
        company_logo_path,company_jurisdiction,
        total_amount,advance_percent,advance_amount,remaining_amount,payment_conditions,notes,
        created_by,updated_by
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `, [
      order.order_date,vendor.id,vendor.name,vendor.contact_number,vendor.address,vendor.email,
      company.company_name,company.address,company.contact_number,company.email,
      company.tax_registration_number,company.logo_path,company.jurisdiction,
      order.total_amount,order.advance_percent,order.advance_amount,order.remaining_amount,
      order.payment_conditions,order.notes,actor.id,actor.id
    ]);
    orderId = result.insertId;
    const poNumber = `PO-${order.order_date.slice(0, 4)}-${String(orderId).padStart(6, '0')}`;
    await conn.query('UPDATE purchase_orders SET po_number=? WHERE id=?', [poNumber, orderId]);
    await insertItems(conn, orderId, order.items);
    await saveHistory(conn, { ...order, id: orderId, po_number: poNumber, vendor_id: vendor.id,
      vendor_name: vendor.name, vendor_contact_number: vendor.contact_number, vendor_address: vendor.address,
      vendor_email: vendor.email, company_name: company.company_name, company_address: company.address,
      company_contact_number: company.contact_number, company_email: company.email,
      company_tax_registration_number: company.tax_registration_number,
      company_logo_path: company.logo_path, company_jurisdiction: company.jurisdiction,
      created_by: actor.id, updated_by: actor.id }, 'CREATED', actor.id);
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
  return orderId;
}

async function update(rawId, data, actor) {
  const id = normalizeId(rawId);
  if (!id) throw new Error('NOT_FOUND');
  const changes = validateOrder(data);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const old = await snapshotForUpdate(conn, id);
    if (!old) throw new Error('NOT_FOUND');
    const [vendors] = await conn.query('SELECT * FROM vendor_master WHERE id=? FOR UPDATE', [changes.vendor_id]);
    if (!vendors.length) throw new Error('INVALID_VENDOR');
    const vendor = Number(old.vendor_id) === Number(changes.vendor_id)
      ? {
          name: old.vendor_name, contact_number: old.vendor_contact_number,
          address: old.vendor_address, email: old.vendor_email
        }
      : vendors[0];
    const next = {
      ...old,
      ...changes,
      vendor_id: changes.vendor_id,
      vendor_name: vendor.name,
      vendor_contact_number: vendor.contact_number,
      vendor_address: vendor.address,
      vendor_email: vendor.email,
      updated_by: actor.id,
      items: changes.items
    };
    await conn.query(`
      UPDATE purchase_orders SET order_date=?,vendor_id=?,vendor_name=?,vendor_contact_number=?,
        vendor_address=?,vendor_email=?,total_amount=?,advance_percent=?,advance_amount=?,
        remaining_amount=?,payment_conditions=?,notes=?,updated_by=? WHERE id=?
    `, [
      next.order_date,next.vendor_id,next.vendor_name,next.vendor_contact_number,next.vendor_address,
      next.vendor_email,next.total_amount,next.advance_percent,next.advance_amount,next.remaining_amount,
      next.payment_conditions,next.notes,actor.id,id
    ]);
    await conn.query('DELETE FROM purchase_order_items WHERE purchase_order_id=?', [id]);
    await insertItems(conn, id, changes.items);
    await saveHistory(conn, next, 'UPDATED', actor.id);
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function snapshotForUpdate(conn, id) {
  const [orders] = await conn.query('SELECT * FROM purchase_orders WHERE id=? FOR UPDATE', [id]);
  if (!orders.length) return null;
  const [items] = await conn.query(
    'SELECT * FROM purchase_order_items WHERE purchase_order_id=? ORDER BY serial_number',
    [id]
  );
  return { ...orders[0], items };
}

async function remove(rawId, actor) {
  const id = normalizeId(rawId);
  if (!id) throw new Error('NOT_FOUND');
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const order = await snapshotForUpdate(conn, id);
    if (!order) throw new Error('NOT_FOUND');
    await saveHistory(conn, order, 'DELETED', actor.id);
    await conn.query('DELETE FROM purchase_orders WHERE id=?', [id]);
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function history(rawId) {
  const id = normalizeId(rawId);
  if (!id) return [];
  const [rows] = await db.query(`
    SELECT h.id,h.po_number,h.action,h.actor_id,
           COALESCE(u.name,'Deleted user') AS actor_name,h.snapshot,h.created_at
    FROM purchase_order_history h
    LEFT JOIN users u ON u.id=h.actor_id
    WHERE h.purchase_order_id=? OR (h.purchase_order_id IS NULL AND JSON_UNQUOTE(JSON_EXTRACT(h.snapshot,'$.id'))=?)
    ORDER BY h.created_at DESC,h.id DESC
  `, [id, String(id)]);
  return rows.map(row => ({
    ...row,
    snapshot: typeof row.snapshot === 'string' ? JSON.parse(row.snapshot) : row.snapshot
  }));
}

module.exports = {
  list, get, create, update, remove, history, companySettings,
  updateCompanySettings, validateOrder
};
