USE company_inventory;

ALTER TABLE inventory_items
  ADD COLUMN chemical_form ENUM('LIQUID','POWDER') NULL AFTER expiry_date,
  ADD COLUMN container_capacity DECIMAL(12,3) NULL AFTER chemical_form,
  ADD COLUMN container_unit ENUM('ml','L','g','kg') NULL AFTER container_capacity;

ALTER TABLE inventory_assignments
  ADD COLUMN chemical_form ENUM('LIQUID','POWDER') NULL AFTER unit,
  ADD COLUMN batch_number VARCHAR(100) NULL AFTER chemical_form,
  ADD COLUMN expiry_date DATE NULL AFTER batch_number,
  ADD COLUMN container_capacity DECIMAL(12,3) NULL AFTER expiry_date,
  ADD COLUMN container_unit ENUM('ml','L','g','kg') NULL AFTER container_capacity;

INSERT IGNORE INTO permissions(code,name,description)
VALUES('ASSIGNMENT_RETURN','Return inventory','Process inventory returns within permitted scope');

INSERT IGNORE INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id
FROM roles r
JOIN permissions p ON p.code='ASSIGNMENT_RETURN'
WHERE r.name='Administrator';
