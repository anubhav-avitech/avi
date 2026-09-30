const db = require('../config/db');
const { audit } = require('./audit.service');

function requireDepartmentUser(actor) {
  if (actor.role_name !== 'Department User' || actor.role_scope !== 'DEPARTMENT' || !Number(actor.department_id)) {
    throw new Error('FORBIDDEN');
  }
}

async function listForDepartment(departmentId) {
  const [rows] = await db.query(`
    SELECT id,employee_code,name,status
    FROM employees
    WHERE department_id=? AND status='ACTIVE'
    ORDER BY name
  `, [departmentId]);
  return rows;
}

async function create(data, actor) {
  requireDepartmentUser(actor);

  const employeeCode = String(data.employee_code || '').trim();
  const name = String(data.name || '').trim();
  if (!employeeCode || !name) throw new Error('EMPLOYEE_FIELDS_REQUIRED');

  const [result] = await db.query(`
    INSERT INTO employees(employee_code,name,department_id,status)
    VALUES(?,?,?,'ACTIVE')
  `, [employeeCode, name, actor.department_id]);

  await audit(actor.id, 'EMPLOYEE_CREATED', 'employees', result.insertId, {
    employee_code: employeeCode,
    department_id: actor.department_id
  }, actor.ip);
}

module.exports = { listForDepartment, create };