USE company_inventory;

-- Non-destructive migration for the previous four-role version.
-- Back up the database first.

UPDATE roles
SET name='Department User',
    description='Inventory access limited to the assigned department',
    scope='DEPARTMENT',
    status='ACTIVE'
WHERE name='Department Head';

INSERT INTO roles(name,description,scope,status)
VALUES('Department User','Inventory access limited to the assigned department','DEPARTMENT','ACTIVE')
ON DUPLICATE KEY UPDATE
  description=VALUES(description),
  scope=VALUES(scope),
  status='ACTIVE';

UPDATE roles
SET status='INACTIVE'
WHERE name IN ('Inventory Manager','Employee');

-- Department Users can manage inventory and assignments only within their department.
DELETE rp
FROM role_permissions rp
JOIN roles r ON r.id=rp.role_id
WHERE r.name='Department User';

DELETE rp
FROM role_permissions rp
JOIN roles r ON r.id=rp.role_id
JOIN permissions p ON p.id=rp.permission_id
WHERE r.name='Administrator'
  AND p.code IN ('INVENTORY_CREATE','ASSIGNMENT_CREATE');

INSERT IGNORE INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id
FROM roles r JOIN permissions p
ON p.code IN (
  'DASHBOARD_VIEW','INVENTORY_VIEW','INVENTORY_CREATE','INVENTORY_UPDATE','INVENTORY_DELETE',
  'ASSIGNMENT_CREATE','ASSIGNMENT_RETURN'
)
WHERE r.name='Department User';

DELETE rp
FROM role_permissions rp
JOIN roles r ON r.id=rp.role_id
WHERE r.name IN ('Inventory Manager','Employee');

-- Old Employee and Inventory Manager accounts remain in the database but cannot
-- log in because the application accepts only Administrator and Department User.
-- An administrator can change an account's role from the People screen if needed.
