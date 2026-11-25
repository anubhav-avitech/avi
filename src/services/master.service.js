const db = require('../config/db');
const validator = require('validator');
const { audit } = require('./audit.service');

const masters = {
  chemicals: {
    table: 'chemical_master',
    label: 'Chemical',
    nameOnly: false,
    searchPlaceholder: 'Search chemical records…',
    searchColumns: ['name','chemical_type'],
    referenceColumn: 'chemical_id',
    fields: [
      { name: 'name', label: 'Chemical name', required: true, maxLength: 150 },
      { name: 'chemical_type', label: 'Chemical type', required: true, type: 'select', options: [
        { value: 'LIQUID', label: 'Liquid' },
        { value: 'POWDER', label: 'Powder' },
        { value: 'PALLETS', label: 'Pallets' },
        { value: 'GRANULES', label: 'Granules' }
      ] }
    ]
  },
  vendors: {
    table: 'vendor_master',
    label: 'Vendor',
    searchPlaceholder: 'Search vendor records…',
    searchColumns: ['name', 'contact_number', 'address', 'email'],
    referenceColumn: 'vendor_id',
    fields: [
      { name: 'name', label: 'Vendor name', required: true, maxLength: 150 },
      { name: 'contact_number', label: 'Contact number', required: true, maxLength: 30 },
      { name: 'address', label: 'Address', required: true, maxLength: 500, type: 'textarea' },
      { name: 'email', label: 'Email', required: false, maxLength: 254, type: 'email' }
    ]
  },
  glassware: {
    table: 'glassware_master',
    label: 'Glassware',
    nameOnly: true,
    searchPlaceholder: 'Search glassware records…',
    referenceColumn: 'glassware_master_id',
    searchColumns: ['name'],
    fields: [{ name: 'name', label: 'Glassware name', required: true, maxLength: 150 }]
  },
  equipment: {
    table: 'equipment_instrument_master',
    label: 'Equipment & instruments',
    nameOnly: true,
    searchPlaceholder: 'Search equipment records…',
    referenceColumn: 'equipment_master_id',
    searchColumns: ['name'],
    fields: [{ name: 'name', label: 'Equipment name', required: true, maxLength: 150 }]
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
    if (field.generated) continue;
    const value = String(data[field.name] ?? '').trim();
    values[field.name] = value;
    if (field.required && !value) {
      errors[field.name] = `${field.label} is required.`;
    } else if (field.maxLength && value.length > field.maxLength) {
      errors[field.name] = `${field.label} must be ${field.maxLength} characters or fewer.`;
    } else if (field.type === 'number' && value) {
      if (
        !/^(?:\d+(?:\.\d{1,3})?|\.\d{1,3})$/.test(value) ||
        Number(value) < field.min ||
        Number(value) > field.max
      ) {
        errors[field.name] = `${field.label} must be between ${field.min} and ${field.max}, with at most three decimal places.`;
      }
    } else if (field.options && value && !field.options.some(option => option.value === value)) {
      errors[field.name] = `Select a valid ${field.label.toLowerCase()}.`;
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
  const conditions = [];
  if (String(search).trim()) {
    const term = `%${String(search).trim()}%`;
    conditions.push(`(${config.searchColumns.map(column => `${column} LIKE ?`).join(' OR ')})`);
    params.push(...config.searchColumns.map(() => term));
  }
  const [rows] = await db.query(
    `SELECT * FROM ${config.table} ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY name`,
    params
  );
  return rows;
}

async function active(type) {
  return list(type);
}

async function listPage(type, query = {}) {
  const config = configFor(type);
  const params = [];
  const conditions = [];
  const search = String(query.q || '').trim().slice(0, 150);
  const filters = {};
  if (search) {
    conditions.push(`(${config.searchColumns.map(column => `${column} LIKE ?`).join(' OR ')})`);
    const term = `%${search}%`;
    params.push(...config.searchColumns.map(() => term));
  }
  for (const filter of config.filters || []) {
    const rawValue = String(query[filter.name] || '').trim();
    const value = filter.type === 'text' ? rawValue.slice(0, 100) : rawValue;
    filters[filter.name] = value;
    if (!value) continue;
    if (filter.type === 'select' && !filter.options.some(option => option.value === value)) continue;
    const column = config.filterColumns?.[filter.name] || filter.name;
    conditions.push(`${column} ${filter.type === 'text' ? 'LIKE' : '='} ?`);
    params.push(filter.type === 'text' ? `%${value}%` : value);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const [[count]] = await db.query(`SELECT COUNT(*) AS total FROM ${config.table} ${where}`, params);
  const total = Number(count.total);
  const perPage = 20;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const parsedPage = Number(String(query.page || '1'));
  const page = Math.min(Math.max(Number.isInteger(parsedPage) ? parsedPage : 1, 1), pages);
  const [rows] = await db.query(
    `SELECT * FROM ${config.table} ${where} ORDER BY name,id LIMIT ? OFFSET ?`,
    [...params, perPage, (page - 1) * perPage]
  );
  const queryString = new URLSearchParams();
  if (search) queryString.set('q', search);
  for (const [name, value] of Object.entries(filters)) {
    if (value) queryString.set(name, value);
  }
  return { rows, page, pages, total, perPage, search, filters, queryString: queryString.toString() };
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
    if (type === 'chemicals') {
      const [oldRows] = await conn.query(
        'SELECT chemical_type FROM chemical_master WHERE id=?',
        [id]
      );
      const [[{ count }]] = await conn.query(
        'SELECT COUNT(*) AS count FROM inventory_items WHERE chemical_id=?',
        [id]
      );
      if (Number(count) > 0 && oldRows[0]?.chemical_type !== values.chemical_type) {
        throw new Error('CHEMICAL_TYPE_IMMUTABLE');
      }
    }
    await conn.query(
      `UPDATE ${config.table} SET ${columns.map(column => `${column}=?`).join(',')} WHERE id=?`,
      [...columns.map(column => values[column]), id]
    );
    if (type === 'glassware' || type === 'equipment') {
      await conn.query(
        `UPDATE inventory_products p
         JOIN inventory_items i ON i.product_id=p.id
         SET p.name=?
         WHERE i.${config.referenceColumn}=?`,
        [values.name, id]
      );
    }
    if (type === 'vendors') {
      await conn.query('UPDATE inventory_items SET vendor_name=? WHERE vendor_id=?', [values.name, id]);
    } else {
      await conn.query(
        `UPDATE inventory_items SET name=? WHERE ${config.referenceColumn}=?`,
        [values.name, id]
      );
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
  const [records] = await db.query(`SELECT name FROM ${config.table} WHERE id=?`, [id]);
  if (!records.length) throw new Error('NOT_FOUND');
  const [[references]] = await db.query(
    `SELECT COUNT(*) AS count FROM inventory_items WHERE ${config.referenceColumn}=?`,
    [id]
  );
  if (Number(references.count)) throw new Error('MASTER_IN_USE');
  const [result] = await db.query(`DELETE FROM ${config.table} WHERE id=?`, [id]);
  if (!result.affectedRows) throw new Error('NOT_FOUND');
  await audit(actor.id, `${type.toUpperCase()}_DELETED`, config.table, id, {
    name: records[0].name
  }, actor.ip);
}

module.exports = {
  list,
  active,
  listPage,
  get,
  create,
  update,
  remove,
  configFor,
  fields: type => configFor(type).fields.filter(field => !field.generated)
};
