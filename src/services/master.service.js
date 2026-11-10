const db = require('../config/db');
const validator = require('validator');
const { audit } = require('./audit.service');

const masters = {
  chemicals: {
    table: 'chemical_master',
    label: 'Chemical',
    fields: [{ name: 'name', label: 'Chemical name', required: true, maxLength: 150 }]
  },
  vendors: {
    table: 'vendor_master',
    label: 'Vendor',
    fields: [
      { name: 'name', label: 'Vendor name', required: true, maxLength: 150 },
      { name: 'contact_number', label: 'Contact number', required: true, maxLength: 30 },
      { name: 'address', label: 'Address', required: true, maxLength: 500 },
      { name: 'email', label: 'Email', required: false, maxLength: 254 }
    ]
  }
};

function configFor(type) {
  const config = masters[type];
  if (!config) throw new Error('INVALID_MASTER_TYPE');
  return config;
}

function normalizeId(value) {
  const raw = String(value || '');
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

function validate(type, data) {
  const config = configFor(type);
  const values = {};
  const errors = {};

  for (const field of config.fields) {
    const value = String(data[field.name] || '').trim();
    values[field.name] = value;
    if (field.required && !value) {
      errors[field.name] = `${field.label} is required.`;
    } else if (value.length > field.maxLength) {
      errors[field.name] = `${field.label} must be ${field.maxLength} characters or fewer.`;
    }
  }

  if (type === 'vendors') {
    const contactNumber = values.contact_number;
    if (contactNumber && !/^[+\d][\d\s().-]{5,29}$/.test(contactNumber)) {
      errors.contact_number = 'Enter a valid contact number.';
    }
    if (values.email && !validator.isEmail(values.email)) {
      errors.email = 'Enter a valid email address.';
    }
  }

  if (Object.keys(errors).length) {
    const error = new Error('INVALID_MASTER_DATA');
    error.fields = errors;
    throw error;
  }
  if (type === 'vendors' && !values.email) values.email = null;
  return values;
}

async function list(type, search = '') {
  const config = configFor(type);
  const params = [];
  let sql = `SELECT * FROM ${config.table}`;
  if (String(search).trim()) {
    const term = `%${String(search).trim()}%`;
    const columns = type === 'vendors'
      ? '(name LIKE ? OR contact_number LIKE ? OR address LIKE ? OR email LIKE ?)'
      : '(name LIKE ?)';
    sql += ` WHERE ${columns}`;
    params.push(...(type === 'vendors' ? [term, term, term, term] : [term]));
  }
  sql += ' ORDER BY name';
  const [rows] = await db.query(sql, params);
  return rows;
}

async function get(type, rawId) {
  const config = configFor(type);
  const id = normalizeId(rawId);
  if (!id) return null;
  const [rows] = await db.query(`SELECT * FROM ${config.table} WHERE id=?`, [id]);
  return rows[0] || null;
}

async function create(type, data, actor) {
  const config = configFor(type);
  const values = validate(type, data);
  const columns = Object.keys(values);
  const [result] = await db.query(
    `INSERT INTO ${config.table}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`,
    columns.map(column => values[column])
  );
  await audit(actor.id, `${type.toUpperCase()}_CREATED`, config.table, result.insertId, values, actor.ip);
}

async function update(type, rawId, data, actor) {
  const config = configFor(type);
  const id = normalizeId(rawId);
  if (!id) throw new Error('NOT_FOUND');
  const values = validate(type, data);
  const columns = Object.keys(values);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [existing] = await conn.query(`SELECT id FROM ${config.table} WHERE id=? FOR UPDATE`, [id]);
    if (!existing.length) throw new Error('NOT_FOUND');
    await conn.query(
      `UPDATE ${config.table} SET ${columns.map(column => `${column}=?`).join(',')} WHERE id=?`,
      [...columns.map(column => values[column]), id]
    );
    if (type === 'chemicals') {
      await conn.query('UPDATE inventory_items SET name=? WHERE chemical_id=?', [values.name, id]);
    } else {
      await conn.query('UPDATE inventory_items SET vendor_name=? WHERE vendor_id=?', [values.name, id]);
    }
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
  await audit(actor.id, `${type.toUpperCase()}_UPDATED`, config.table, id, values, actor.ip);
}

async function remove(type, rawId, actor) {
  const config = configFor(type);
  const id = normalizeId(rawId);
  if (!id) throw new Error('NOT_FOUND');
  const referenceColumn = type === 'chemicals' ? 'chemical_id' : 'vendor_id';
  const [records] = await db.query(`SELECT name FROM ${config.table} WHERE id=?`, [id]);
  if (!records.length) throw new Error('NOT_FOUND');
  const [[references]] = await db.query(
    `SELECT COUNT(*) AS count FROM inventory_items WHERE ${referenceColumn}=?`,
    [id]
  );
  if (Number(references.count)) throw new Error('MASTER_IN_USE');
  const [result] = await db.query(`DELETE FROM ${config.table} WHERE id=?`, [id]);
  if (!result.affectedRows) throw new Error('NOT_FOUND');
  await audit(actor.id, `${type.toUpperCase()}_DELETED`, config.table, id, {
    name: records[0].name
  }, actor.ip);
}

module.exports = { list, get, create, update, remove, configFor, fields: type => configFor(type).fields };
