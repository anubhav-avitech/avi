USE company_inventory;

CREATE TABLE IF NOT EXISTS user_permissions (
  user_id BIGINT UNSIGNED NOT NULL,
  permission_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY(user_id, permission_id),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(permission_id) REFERENCES permissions(id) ON DELETE CASCADE
) ENGINE=InnoDB;

INSERT IGNORE INTO permissions(code,name,description) VALUES
('CHEMICAL_MASTER_ACCESS','Access chemical master','Access chemical master pages'),
('VENDOR_MASTER_ACCESS','Access vendor master','Access vendor master pages'),
('GLASSWARE_MASTER_ACCESS','Access glassware master','Access glassware master pages'),
('EQUIPMENT_MASTER_ACCESS','Access equipment master','Access equipment and instruments master pages');

INSERT IGNORE INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id
FROM roles r
JOIN permissions p ON p.code IN (
  'CHEMICAL_MASTER_ACCESS',
  'VENDOR_MASTER_ACCESS',
  'GLASSWARE_MASTER_ACCESS',
  'EQUIPMENT_MASTER_ACCESS'
)
WHERE r.name='Administrator';
