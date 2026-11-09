const db = require('../config/db');

const EXPIRY_WARNING_DAYS = 30;
const RECENT_ACTIVITY_LIMIT = 12;

const assignmentBalances = `
  SELECT assignment_id,
         SUM(CASE
           WHEN action='ASSIGN' THEN quantity
           WHEN action IN ('CONSUME','RETURN') THEN -quantity
           ELSE 0
         END) AS balance
  FROM inventory_transactions
  WHERE assignment_id IS NOT NULL
  GROUP BY assignment_id
`;

async function dashboard() {
  const [[summary]] = await db.query(`
    SELECT COUNT(DISTINCT product_id) AS total
    FROM inventory_items
  `);

  const [availableByUnit] = await db.query(`
    SELECT unit,COALESCE(SUM(quantity),0) AS quantity,COUNT(*) AS batch_lines
    FROM inventory_items
    WHERE status='AVAILABLE'
      AND quantity>0
      AND (expiry_date IS NULL OR expiry_date>=CURDATE())
    GROUP BY unit
    ORDER BY unit
  `);

  const [[assignmentSummary]] = await db.query(`
    SELECT COUNT(DISTINCT a.employee_id) AS employees,
           COUNT(DISTINCT i.product_id) AS products
    FROM inventory_assignments a
    JOIN inventory_items i ON i.id=a.inventory_id
    JOIN (${assignmentBalances}) b ON b.assignment_id=a.id
    WHERE b.balance>0 AND a.employee_id IS NOT NULL
  `);

  const [assignedByUnit] = await db.query(`
    SELECT a.unit,COALESCE(SUM(b.balance),0) AS quantity
    FROM inventory_assignments a
    JOIN (${assignmentBalances}) b ON b.assignment_id=a.id
    WHERE b.balance>0
    GROUP BY a.unit
    ORDER BY a.unit
  `);

  const [employeeBalances] = await db.query(`
    SELECT a.employee_id,e.employee_code,
           COALESCE(e.name,u.name,'Deleted employee') AS employee_name,
           i.id AS inventory_id,i.product_id,i.name AS item_name,i.asset_code,a.unit,
           SUM(b.balance) AS quantity
    FROM inventory_assignments a
    JOIN inventory_items i ON i.id=a.inventory_id
    JOIN (${assignmentBalances}) b ON b.assignment_id=a.id
    LEFT JOIN employees e ON e.id=a.employee_id
    LEFT JOIN users u ON u.id=a.user_id
    WHERE b.balance>0
    GROUP BY a.employee_id,e.employee_code,e.name,u.name,i.product_id,
             i.name,i.asset_code,a.unit
    ORDER BY employee_name,i.name
    LIMIT 100
  `);

  const [lowStockProducts] = await db.query(`
    SELECT p.id,COALESCE(MAX(c.name),p.name) AS name,p.item_type,p.unit,p.minimum_stock,
           COALESCE(SUM(CASE
             WHEN i.status='AVAILABLE'
               AND (i.expiry_date IS NULL OR i.expiry_date>=CURDATE())
             THEN i.quantity ELSE 0
           END),0) AS available_quantity
    FROM inventory_products p
    JOIN inventory_items i ON i.product_id=p.id
    LEFT JOIN chemical_master c ON c.id=i.chemical_id
    WHERE p.minimum_stock>0 AND i.status<>'RETIRED'
    GROUP BY p.id,p.name,p.item_type,p.unit,p.minimum_stock
    HAVING available_quantity<=p.minimum_stock
    ORDER BY available_quantity ASC,name
  `);

  const [expiringBatches] = await db.query(`
    SELECT i.id,i.product_id,i.name,i.asset_code,i.batch_number,i.unit,
           i.quantity AS central_quantity,i.status,i.location,
           DATE_FORMAT(i.expiry_date,'%Y-%m-%d') AS expiry_date,
           DATEDIFF(i.expiry_date,CURDATE()) AS days_to_expiry,
           COALESCE(a.assigned_quantity,0) AS assigned_quantity
    FROM inventory_items i
    LEFT JOIN (
      SELECT a.inventory_id,SUM(b.balance) AS assigned_quantity
      FROM inventory_assignments a
      JOIN (${assignmentBalances}) b ON b.assignment_id=a.id
      WHERE b.balance>0
      GROUP BY a.inventory_id
    ) a ON a.inventory_id=i.id
    WHERE i.expiry_date IS NOT NULL
      AND i.expiry_date<=DATE_ADD(CURDATE(),INTERVAL ${EXPIRY_WARNING_DAYS} DAY)
      AND i.status<>'RETIRED'
      AND (i.quantity>0 OR COALESCE(a.assigned_quantity,0)>0)
    ORDER BY i.expiry_date ASC,i.name ASC,i.batch_number ASC
  `);

  const [recentActivity] = await db.query(`
    SELECT t.id,t.action,t.quantity,t.unit,t.created_at,t.details,
           i.id AS inventory_id,i.name AS item_name,i.asset_code,
           COALESCE(e.name,u.name) AS employee_name,
           COALESCE(actor.name,'Deleted user') AS actor_name
    FROM inventory_transactions t
    JOIN inventory_items i ON i.id=t.inventory_id
    LEFT JOIN employees e ON e.id=t.employee_id
    LEFT JOIN users u ON u.id=t.user_id
    LEFT JOIN users actor ON actor.id=t.actor_id
    ORDER BY t.created_at DESC,t.id DESC
    LIMIT ${RECENT_ACTIVITY_LIMIT}
  `);

  return {
    summary,
    availableByUnit,
    assignmentSummary,
    assignedByUnit,
    employeeBalances,
    lowStockProducts,
    expiringBatches,
    recentActivity,
    expiryWarningDays: EXPIRY_WARNING_DAYS
  };
}

module.exports = { dashboard };
