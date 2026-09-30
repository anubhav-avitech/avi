const db = require('../config/db');

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

  return { summary: summary[0], departments };
}

module.exports = { dashboard };
