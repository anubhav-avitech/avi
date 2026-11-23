USE company_inventory;

-- Non-destructive migration from the current department-based schema.
-- Back up the database before applying this migration.

UPDATE inventory_items
SET item_type='CONSUMABLE'
WHERE chemical_form IS NOT NULL AND item_type<>'CONSUMABLE';

CREATE TABLE inventory_products (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  item_type ENUM('ASSET','CONSUMABLE') NOT NULL,
  unit VARCHAR(30) NOT NULL,
  minimum_stock DECIMAL(12,3) NOT NULL DEFAULT 15,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_inventory_product_name_type_unit(name,item_type,unit)
) ENGINE=InnoDB;

INSERT INTO inventory_products(name,item_type,unit,minimum_stock)
SELECT name,item_type,unit,15
FROM inventory_items
GROUP BY name,item_type,unit;

ALTER TABLE inventory_items
  ADD COLUMN product_id BIGINT UNSIGNED NULL AFTER id;

UPDATE inventory_items i
JOIN inventory_products p
  ON p.name=i.name AND p.item_type=i.item_type AND p.unit=i.unit
SET i.product_id=p.id;

ALTER TABLE inventory_items
  MODIFY COLUMN product_id BIGINT UNSIGNED NOT NULL,
  ADD INDEX idx_inventory_product(product_id),
  ADD CONSTRAINT fk_inventory_product
    FOREIGN KEY(product_id) REFERENCES inventory_products(id) ON DELETE RESTRICT,
  DROP FOREIGN KEY inventory_items_ibfk_1,
  DROP INDEX idx_inventory_department,
  DROP COLUMN department_id;

ALTER TABLE users
  DROP FOREIGN KEY users_ibfk_1,
  DROP INDEX idx_users_department,
  DROP COLUMN department_id;

ALTER TABLE employees
  DROP FOREIGN KEY employees_ibfk_1,
  DROP INDEX idx_employees_department,
  DROP COLUMN department_id;

ALTER TABLE roles
  DROP COLUMN scope;

ALTER TABLE inventory_assignments
  ADD COLUMN remarks VARCHAR(500) NULL AFTER employee_id;

ALTER TABLE inventory_transactions
  MODIFY COLUMN action ENUM(
    'ADD','UPDATE','ASSIGN','CONSUME','RETURN','ADJUST','DISPOSE',
    'STATUS_CHANGE','RETIRE'
  ) NOT NULL,
  ADD COLUMN assignment_id BIGINT UNSIGNED NULL AFTER inventory_id,
  ADD INDEX idx_transaction_assignment(assignment_id),
  ADD CONSTRAINT fk_transaction_assignment
    FOREIGN KEY(assignment_id) REFERENCES inventory_assignments(id) ON DELETE SET NULL;

UPDATE inventory_transactions t
JOIN inventory_assignments a
  ON a.id=CAST(JSON_UNQUOTE(JSON_EXTRACT(t.details,'$.assignment_id')) AS UNSIGNED)
SET t.assignment_id=a.id
WHERE t.assignment_id IS NULL
  AND t.action IN ('ASSIGN','RETURN')
  AND JSON_UNQUOTE(JSON_EXTRACT(t.details,'$.assignment_id')) REGEXP '^[0-9]+$';

UPDATE inventory_assignments a
JOIN inventory_transactions t
  ON t.assignment_id=a.id AND t.action='ASSIGN'
SET a.quantity=t.quantity;

INSERT IGNORE INTO permissions(code,name,description)
VALUES('ASSIGNMENT_CONSUME','Record consumption','Record consumables issued to employees as consumed');

UPDATE roles
SET name='Inventory User',
    description='Inventory issue and operations access'
WHERE name='Department User';

INSERT IGNORE INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id
FROM roles r
JOIN permissions p ON p.code='ASSIGNMENT_CONSUME'
WHERE r.name IN ('Administrator','Inventory User');

DROP TABLE departments;

DELETE rp
FROM role_permissions rp
JOIN permissions p ON p.id=rp.permission_id
WHERE p.code='DEPARTMENTS_MANAGE';

DELETE FROM permissions
WHERE code='DEPARTMENTS_MANAGE';
