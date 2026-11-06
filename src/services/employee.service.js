const db = require('../config/db');
const { audit } = require('./audit.service');

async function listActive() {
  const [rows] = await db.query(`
    SELECT id,employee_code,name,status
    FROM employees
    WHERE status='ACTIVE'
    ORDER BY name
  `);
  return rows;
}

async function create(data, actor) {
  const employeeCode = String(data.employee_code || '').trim();
  const name = String(data.name || '').trim();
  if (!employeeCode || !name) throw new Error('EMPLOYEE_FIELDS_REQUIRED');

  const [result] = await db.query(`
    INSERT INTO employees(employee_code,name,status)
    VALUES(?,?,'ACTIVE')
  `, [employeeCode, name]);

  await audit(actor.id, 'EMPLOYEE_CREATED', 'employees', result.insertId, {
    employee_code: employeeCode
  }, actor.ip);
}

module.exports = { listActive, create };