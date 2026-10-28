const db = require('../config/db');

const EXPIRY_WARNING_DAYS = 30;

function isAdmin(user) {
  return user.role_name === 'Administrator' && user.role_scope === 'ALL';
}

async function dashboard(user) {
  const where = isAdmin(user) ? '' : ' WHERE department_id=?';
  const params = isAdmin(user) ? [] : [user.department_id];

  const [summary] = await db.query(`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(quantity),0) AS quantity,
      COALESCE(SUM(status='AVAILABLE'),0) AS available,
      COALESCE(SUM(EXISTS (
        SELECT 1
        FROM inventory_assignments a
        WHERE a.inventory_id=inventory_items.id
          AND a.returned_at IS NULL
      )),0) AS assigned,
      COALESCE(SUM(status='MAINTENANCE'),0) AS maintenance,
      COALESCE(SUM(status='DAMAGED'),0) AS damaged,
      COALESCE(SUM(status='RETIRED'),0) AS retired
    FROM inventory_items${where}
  `, params);

  const [departments] = await db.query(`
    SELECT d.id,d.name,
           COUNT(i.id) AS items,
           COALESCE(SUM(i.quantity),0) AS quantity
    FROM departments d
    LEFT JOIN inventory_items i ON i.department_id=d.id
    WHERE d.status='ACTIVE' ${isAdmin(user) ? '' : 'AND d.id=?'}
    GROUP BY d.id,d.name
    ORDER BY d.name
  `, isAdmin(user) ? [] : [user.department_id]);

  const [stockByUnit] = await db.query(`
    SELECT i.unit,
           COALESCE(SUM(i.quantity),0) AS quantity,
           COUNT(*) AS item_lines
    FROM inventory_items i
    WHERE i.status<>'RETIRED'
      ${isAdmin(user) ? '' : 'AND i.department_id=?'}
    GROUP BY i.unit
    ORDER BY i.unit
  `, isAdmin(user) ? [] : [user.department_id]);

  const expiryWhere = isAdmin(user) ? '' : 'AND i.department_id=?';
  const expiryParams = isAdmin(user) ? [] : [user.department_id];
  const [expiringChemicals] = await db.query(`
    SELECT i.id,i.name,i.asset_code,i.batch_number,
           DATE_FORMAT(i.expiry_date,'%Y-%m-%d') AS expiry_date,
           DATEDIFF(i.expiry_date,CURDATE()) AS days_to_expiry,
           i.quantity,i.unit,i.container_capacity,i.container_unit,d.name AS department
    FROM inventory_items i
    JOIN departments d ON d.id=i.department_id
    WHERE i.chemical_form IS NOT NULL
      AND i.expiry_date IS NOT NULL
      AND i.status<>'RETIRED'
      AND i.quantity>0
      AND i.expiry_date<=DATE_ADD(CURDATE(),INTERVAL ${EXPIRY_WARNING_DAYS} DAY)
      ${expiryWhere}
    ORDER BY i.name ASC,i.batch_number ASC,i.expiry_date ASC
  `, expiryParams);

  return {
    summary: summary[0],
    departments,
    stockByUnit,
    expiringChemicals,
    expiryWarningDays: EXPIRY_WARNING_DAYS
  };
}

module.exports = { dashboard };
