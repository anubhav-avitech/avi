const db = require('../config/db');

const ACTIVITY_SQL = `
  SELECT
    'inventory' AS source,
    t.id,
    t.created_at,
    'Inventory' AS category,
    t.action,
    CASE t.action
      WHEN 'ADD' THEN 'Stock added'
      WHEN 'ASSIGN' THEN 'Stock assigned'
      WHEN 'CONSUME' THEN 'Stock consumed'
      WHEN 'RETURN' THEN 'Stock returned'
      WHEN 'ADJUST' THEN 'Stock adjusted'
      WHEN 'DISPOSE' THEN 'Stock disposed'
      WHEN 'UPDATE' THEN 'Inventory item updated'
      WHEN 'STATUS_CHANGE' THEN 'Inventory status changed'
      WHEN 'RETIRE' THEN 'Inventory item retired'
      ELSE 'Inventory activity'
    END AS activity,
    i.name AS record_name,
    i.asset_code AS record_identifier,
    t.quantity,
    t.unit,
    COALESCE(e.name, affected_user.name) AS affected_user,
    COALESCE(actor.name, 'Deleted user') AS actor_name,
    t.details,
    CONCAT_WS(' ', i.name, i.asset_code, i.batch_number, i.vendor_name, chemical.name, vendor.name,
      CAST(t.details AS CHAR)) AS search_text
  FROM inventory_transactions t
  JOIN inventory_items i ON i.id=t.inventory_id
  LEFT JOIN users actor ON actor.id=t.actor_id
  LEFT JOIN users affected_user ON affected_user.id=t.user_id
  LEFT JOIN employees e ON e.id=t.employee_id
  LEFT JOIN chemical_master chemical ON chemical.id=i.chemical_id
  LEFT JOIN vendor_master vendor ON vendor.id=i.vendor_id

  UNION ALL

  SELECT
    'audit' AS source,
    a.id,
    a.created_at,
    CASE
      WHEN LEFT(UPPER(a.action),10)='INVENTORY_' THEN 'Inventory'
      WHEN UPPER(a.action) REGEXP '(^|_)(LOGIN|LOGOUT|AUTH|SECURITY|PASSWORD|SESSION|FAILED)(_|$)'
        OR LOWER(a.entity_type) IN ('security','system','authentication')
      THEN 'System'
      ELSE 'Administrative'
    END AS category,
    a.action,
    REPLACE(CONCAT(UPPER(SUBSTRING(a.action,1,1)), LOWER(SUBSTRING(a.action,2))), '_', ' ') AS activity,
    COALESCE(entity_user.name, JSON_UNQUOTE(JSON_EXTRACT(a.details,'$.name')),
      chemical.name, vendor.name, employee.name, audit_inventory.name,
      JSON_UNQUOTE(JSON_EXTRACT(a.details,'$.username')), a.entity_type) AS record_name,
    COALESCE(audit_inventory.asset_code, a.entity_id) AS record_identifier,
    CASE WHEN a.action IN (
      'INVENTORY_RESTOCKED','INVENTORY_ADJUSTED','INVENTORY_DISPOSED',
      'INVENTORY_ASSIGNED','INVENTORY_CONSUMED','INVENTORY_RETURNED'
    ) THEN CAST(JSON_UNQUOTE(JSON_EXTRACT(a.details,'$.quantity')) AS DECIMAL(12,3)) END AS quantity,
    CASE WHEN a.action IN (
      'INVENTORY_RESTOCKED','INVENTORY_ADJUSTED','INVENTORY_DISPOSED',
      'INVENTORY_ASSIGNED','INVENTORY_CONSUMED','INVENTORY_RETURNED'
    ) THEN JSON_UNQUOTE(JSON_EXTRACT(a.details,'$.unit')) END AS unit,
    CASE WHEN a.entity_type IN ('users','employees') THEN COALESCE(
      entity_user.name, employee.name, JSON_UNQUOTE(JSON_EXTRACT(a.details,'$.name'))
    ) END AS affected_user,
    COALESCE(actor.name, IF(a.action='FAILED_LOGIN','Unknown user','Deleted user')) AS actor_name,
    a.details,
    CONCAT_WS(' ', entity_user.name, JSON_UNQUOTE(JSON_EXTRACT(a.details,'$.name')),
      chemical.name, vendor.name, employee.name,
      audit_inventory.name, audit_inventory.asset_code, CAST(a.details AS CHAR)) AS search_text
  FROM audit_logs a
  LEFT JOIN users actor ON actor.id=a.actor_id
  LEFT JOIN users entity_user ON a.entity_type='users' AND entity_user.id=CAST(a.entity_id AS UNSIGNED)
  LEFT JOIN chemical_master chemical ON a.entity_type='chemical_master' AND chemical.id=CAST(a.entity_id AS UNSIGNED)
  LEFT JOIN vendor_master vendor ON a.entity_type='vendor_master' AND vendor.id=CAST(a.entity_id AS UNSIGNED)
  LEFT JOIN employees employee ON a.entity_type='employees' AND employee.id=CAST(a.entity_id AS UNSIGNED)
  LEFT JOIN inventory_items audit_inventory
    ON a.entity_type='inventory_items' AND audit_inventory.id=CAST(a.entity_id AS UNSIGNED)
`;

const ALLOWED_CATEGORIES = new Set(['Inventory', 'Administrative', 'System']);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PAGE_SIZE = 25;

function validDate(value) {
  if (!DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function normalizeFilters(query) {
  const filters = {
    q: String(query.q || '').trim().slice(0, 120),
    category: ALLOWED_CATEGORIES.has(query.category) ? query.category : '',
    action: String(query.action || '').trim().slice(0, 100),
    actor: String(query.actor || '').trim().slice(0, 150),
    from: String(query.from || '').trim(),
    to: String(query.to || '').trim(),
    page: 1
  };
  const errors = [];

  if (filters.from && !validDate(filters.from)) {
    errors.push('Enter a valid start date.');
    filters.from = '';
  }
  if (filters.to && !validDate(filters.to)) {
    errors.push('Enter a valid end date.');
    filters.to = '';
  }
  if (filters.from && filters.to && filters.from > filters.to) {
    errors.push('The start date must be on or before the end date.');
    filters.from = '';
    filters.to = '';
  }

  const page = Number.parseInt(String(query.page || '1'), 10);
  if (Number.isSafeInteger(page) && page > 0) filters.page = Math.min(page, 1000000);
  return { filters, errors };
}

function whereFor(filters, includeSearch = true) {
  const conditions = [];
  const params = [];
  if (filters.category) {
    conditions.push('activity.category=?');
    params.push(filters.category);
  }
  if (filters.action) {
    conditions.push('activity.action=?');
    params.push(filters.action);
  }
  if (filters.actor) {
    conditions.push('activity.actor_name=?');
    params.push(filters.actor);
  }
  if (filters.from) {
    conditions.push('activity.created_at>=?');
    params.push(`${filters.from} 00:00:00`);
  }
  if (filters.to) {
    conditions.push('activity.created_at<=?');
    params.push(`${filters.to} 23:59:59`);
  }
  if (includeSearch && filters.q) {
    const pattern = `%${filters.q}%`;
    conditions.push(`CONCAT_WS(' ',
      activity.record_name, activity.record_identifier, activity.action,
      activity.activity, activity.actor_name, activity.affected_user,
      activity.search_text
    ) LIKE ?`);
    params.push(pattern);
  }
  return {
    sql: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    params
  };
}

async function list(rawQuery) {
  const { filters, errors } = normalizeFilters(rawQuery);
  const dateFilters = { ...filters, category: '', action: '', actor: '', q: '' };
  const dateWhere = whereFor(dateFilters, false);
  const allWhere = whereFor(filters);

  const [summaryRows] = await db.query(`
    SELECT COUNT(*) AS total,
      COALESCE(SUM(category='Inventory'),0) AS inventory,
      COALESCE(SUM(category='Administrative'),0) AS administrative,
      COALESCE(SUM(category='System'),0) AS system_total
    FROM (${ACTIVITY_SQL}) activity
    ${dateWhere.sql}
  `, dateWhere.params);

  const [countRows] = await db.query(`
    SELECT COUNT(*) AS total
    FROM (${ACTIVITY_SQL}) activity
    ${allWhere.sql}
  `, allWhere.params);

  const total = Number(countRows[0].total);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  filters.page = Math.min(filters.page, pageCount);
  const offset = (filters.page - 1) * PAGE_SIZE;

  const [rows] = await db.query(`
    SELECT activity.*
    FROM (${ACTIVITY_SQL}) activity
    ${allWhere.sql}
    ORDER BY activity.created_at DESC, activity.source, activity.id DESC
    LIMIT ? OFFSET ?
  `, [...allWhere.params, PAGE_SIZE, offset]);

  const [actions] = await db.query(`
    SELECT DISTINCT activity.action, activity.activity
    FROM (${ACTIVITY_SQL}) activity
    ORDER BY activity.activity
  `);
  const [actors] = await db.query(`
    SELECT DISTINCT activity.actor_name
    FROM (${ACTIVITY_SQL}) activity
    ORDER BY activity.actor_name
  `);

  return {
    filters,
    errors,
    rows,
    summary: { ...summaryRows[0], system: summaryRows[0].system_total },
    total,
    pageCount,
    pageSize: PAGE_SIZE,
    actions,
    actors: actors.map(row => row.actor_name)
  };
}

module.exports = { list, normalizeFilters };
