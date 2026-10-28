USE company_inventory;

-- Allow Department Users to edit inventory within their assigned department.
INSERT IGNORE INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id
FROM roles r
JOIN permissions p ON p.code='INVENTORY_UPDATE'
WHERE r.name='Department User'
  AND r.scope='DEPARTMENT'
  AND r.status='ACTIVE';
