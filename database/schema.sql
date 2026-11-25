CREATE DATABASE IF NOT EXISTS company_inventory CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE company_inventory;

-- Fresh schema. If you already have data you need to keep, back it up before rebuilding.
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS inventory_transactions;
DROP TABLE IF EXISTS inventory_assignments;
DROP TABLE IF EXISTS employees;
DROP TABLE IF EXISTS inventory_items;
DROP TABLE IF EXISTS equipment_instrument_master;
DROP TABLE IF EXISTS glassware_master;
DROP TABLE IF EXISTS inventory_products;
DROP TABLE IF EXISTS vendor_master;
DROP TABLE IF EXISTS chemical_master;
DROP TABLE IF EXISTS user_permissions;
DROP TABLE IF EXISTS role_permissions;
DROP TABLE IF EXISTS permissions;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS roles;
DROP TABLE IF EXISTS departments;

CREATE TABLE roles (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  description VARCHAR(500) NULL,
  status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE permissions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(100) NOT NULL UNIQUE,
  name VARCHAR(150) NOT NULL,
  description VARCHAR(500) NULL
) ENGINE=InnoDB;

CREATE TABLE role_permissions (
  role_id BIGINT UNSIGNED NOT NULL,
  permission_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY(role_id, permission_id),
  FOREIGN KEY(role_id) REFERENCES roles(id) ON DELETE CASCADE,
  FOREIGN KEY(permission_id) REFERENCES permissions(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(150) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role_id BIGINT UNSIGNED NOT NULL,
  status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY(role_id) REFERENCES roles(id) ON DELETE RESTRICT,
  INDEX idx_users_status(status)
) ENGINE=InnoDB;

CREATE TABLE user_permissions (
  user_id BIGINT UNSIGNED NOT NULL,
  permission_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY(user_id, permission_id),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(permission_id) REFERENCES permissions(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE employees (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(150) NOT NULL,
  status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_employees_status(status)
) ENGINE=InnoDB;

CREATE TABLE inventory_products (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  item_type ENUM('ASSET','CONSUMABLE') NOT NULL,
  unit VARCHAR(30) NOT NULL,
  minimum_stock DECIMAL(12,3) NOT NULL DEFAULT 15,
  item_code VARCHAR(45) NULL,
  description VARCHAR(500) NULL,
  status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_inventory_product_status(status),
  UNIQUE KEY uq_inventory_product_item_code(item_code),
  UNIQUE KEY uq_inventory_product_name_type_unit(name,item_type,unit)
) ENGINE=InnoDB;

CREATE TABLE chemical_master (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL UNIQUE,
  chemical_type ENUM('LIQUID','POWDER','PALLETS','GRANULES') NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE vendor_master (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL UNIQUE,
  contact_number VARCHAR(30) NOT NULL,
  address VARCHAR(500) NOT NULL,
  email VARCHAR(254) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE glassware_master (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  product_id BIGINT UNSIGNED NULL UNIQUE,
  glassware_type VARCHAR(100) NULL,
  capacity DECIMAL(12,3) NULL,
  capacity_unit ENUM('ml','L','µl') NULL,
  material VARCHAR(100) NULL,
  glass_class ENUM('CLASS_A','CLASS_B','NOT_APPLICABLE') NULL DEFAULT 'NOT_APPLICABLE',
  graduation ENUM('GRADUATED','NON_GRADUATED') NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY(product_id) REFERENCES inventory_products(id) ON DELETE RESTRICT,
  UNIQUE KEY uq_glassware_master_name(name)
) ENGINE=InnoDB;

CREATE TABLE equipment_instrument_master (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  product_id BIGINT UNSIGNED NULL UNIQUE,
  equipment_type VARCHAR(100) NULL,
  manufacturer_brand VARCHAR(150) NULL,
  model_number VARCHAR(100) NULL,
  technical_specifications TEXT NULL,
  calibration_required TINYINT(1) NULL DEFAULT 0,
  calibration_frequency VARCHAR(100) NULL,
  warranty_applicable TINYINT(1) NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY(product_id) REFERENCES inventory_products(id) ON DELETE RESTRICT,
  UNIQUE KEY uq_equipment_master_name(name)
) ENGINE=InnoDB;

CREATE TABLE inventory_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  product_id BIGINT UNSIGNED NOT NULL,
  chemical_id BIGINT UNSIGNED NULL,
  vendor_id BIGINT UNSIGNED NULL,
  glassware_master_id BIGINT UNSIGNED NULL,
  equipment_master_id BIGINT UNSIGNED NULL,
  asset_code VARCHAR(80) NOT NULL UNIQUE,
  name VARCHAR(150) NOT NULL,
  item_type ENUM('ASSET','CONSUMABLE') NOT NULL DEFAULT 'ASSET',
  category VARCHAR(100) NULL,
  description VARCHAR(500) NULL,
  serial_number VARCHAR(150) NULL UNIQUE,
  quantity DECIMAL(12,3) NOT NULL DEFAULT 1,
  unit VARCHAR(30) NOT NULL DEFAULT 'Piece',
  status ENUM('AVAILABLE','ASSIGNED','MAINTENANCE','LOST','DAMAGED','RETIRED') NOT NULL DEFAULT 'AVAILABLE',
  location VARCHAR(150) NULL,
  batch_number VARCHAR(100) NULL,
  chemical_batch_key VARCHAR(100) NULL,
  manufacturer VARCHAR(150) NULL,
  vendor_name VARCHAR(150) NULL,
  vendor_bill_no VARCHAR(100) NULL,
  make_grade VARCHAR(150) NULL,
  received_by VARCHAR(150) NULL,
  received_date DATE NULL,
  expiry_date DATE NULL,
  glassware_type VARCHAR(100) NULL,
  capacity DECIMAL(12,3) NULL,
  capacity_unit ENUM('ml','L','µl') NULL,
  material VARCHAR(100) NULL,
  glass_class ENUM('CLASS_A','CLASS_B','NOT_APPLICABLE') NULL,
  graduation ENUM('GRADUATED','NON_GRADUATED') NULL,
  equipment_type VARCHAR(100) NULL,
  model_number VARCHAR(100) NULL,
  technical_specifications TEXT NULL,
  calibration_required TINYINT(1) NULL,
  calibration_frequency VARCHAR(100) NULL,
  warranty_applicable TINYINT(1) NULL,
  chemical_form ENUM('LIQUID','POWDER','PALLETS','GRANULES') NULL,
  container_capacity DECIMAL(12,3) NULL,
  container_unit ENUM('L','ml','kg','g','mg') NULL,
  package_count DECIMAL(12,3) NULL,
  packaging_type VARCHAR(100) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY(product_id) REFERENCES inventory_products(id) ON DELETE RESTRICT,
  FOREIGN KEY(chemical_id) REFERENCES chemical_master(id) ON DELETE RESTRICT,
  FOREIGN KEY(vendor_id) REFERENCES vendor_master(id) ON DELETE RESTRICT,
  FOREIGN KEY(glassware_master_id) REFERENCES glassware_master(id) ON DELETE RESTRICT,
  FOREIGN KEY(equipment_master_id) REFERENCES equipment_instrument_master(id) ON DELETE RESTRICT,
  INDEX idx_inventory_product(product_id),
  INDEX idx_inventory_chemical(chemical_id),
  INDEX idx_inventory_vendor(vendor_id),
  INDEX idx_inventory_glassware_master(glassware_master_id),
  INDEX idx_inventory_equipment_master(equipment_master_id),
  INDEX idx_inventory_status(status),
  INDEX idx_inventory_type(item_type),
  INDEX idx_inventory_expiry(expiry_date),
  UNIQUE KEY uq_inventory_chemical_batch_key(chemical_id,chemical_batch_key),
  CONSTRAINT chk_inventory_glassware_capacity CHECK(capacity IS NULL OR capacity>0),
  CONSTRAINT chk_inventory_equipment_flags CHECK(
    (calibration_required IS NULL OR calibration_required IN (0,1))
    AND (warranty_applicable IS NULL OR warranty_applicable IN (0,1))
  ),
  CONSTRAINT chk_inventory_single_master CHECK(
    (glassware_master_id IS NULL OR equipment_master_id IS NULL)
    AND (chemical_id IS NULL OR (glassware_master_id IS NULL AND equipment_master_id IS NULL))
  )
) ENGINE=InnoDB;

CREATE TABLE inventory_stock_receipts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  inventory_id BIGINT UNSIGNED NOT NULL,
  package_count DECIMAL(12,3) NOT NULL,
  package_capacity DECIMAL(12,3) NOT NULL,
  measurement_unit VARCHAR(30) NOT NULL,
  received_quantity DECIMAL(12,3) NOT NULL,
  packaging_type VARCHAR(100) NULL,
  receipt_date DATE NULL,
  vendor_id BIGINT UNSIGNED NULL,
  vendor_bill_no VARCHAR(100) NULL,
  received_by VARCHAR(150) NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(inventory_id) REFERENCES inventory_items(id) ON DELETE RESTRICT,
  FOREIGN KEY(vendor_id) REFERENCES vendor_master(id) ON DELETE RESTRICT,
  FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_stock_receipt_inventory(inventory_id),
  INDEX idx_stock_receipt_date(receipt_date)
) ENGINE=InnoDB;

CREATE TABLE inventory_assignments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  inventory_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NULL,
  employee_id BIGINT UNSIGNED NULL,
  remarks VARCHAR(500) NULL,
  quantity DECIMAL(12,3) NOT NULL,
  unit VARCHAR(30) NOT NULL,
  chemical_form ENUM('LIQUID','POWDER','PALLETS','GRANULES') NULL,
  batch_number VARCHAR(100) NULL,
  expiry_date DATE NULL,
  container_capacity DECIMAL(12,3) NULL,
  container_unit ENUM('L','ml','kg','g','mg') NULL,
  assigned_by BIGINT UNSIGNED NULL,
  assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(inventory_id) REFERENCES inventory_items(id) ON DELETE RESTRICT,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
  FOREIGN KEY(assigned_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_assignment_inventory(inventory_id),
  INDEX idx_assignment_user(user_id),
  INDEX idx_assignment_employee(employee_id)
) ENGINE=InnoDB;

CREATE TABLE inventory_transactions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  inventory_id BIGINT UNSIGNED NOT NULL,
  assignment_id BIGINT UNSIGNED NULL,
  user_id BIGINT UNSIGNED NULL,
  employee_id BIGINT UNSIGNED NULL,
  actor_id BIGINT UNSIGNED NULL,
  action ENUM('ADD','UPDATE','ASSIGN','CONSUME','RETURN','ADJUST','DISPOSE','STATUS_CHANGE','RETIRE') NOT NULL,
  quantity DECIMAL(12,3) NULL,
  unit VARCHAR(30) NULL,
  details JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(inventory_id) REFERENCES inventory_items(id) ON DELETE RESTRICT,
  FOREIGN KEY(assignment_id) REFERENCES inventory_assignments(id) ON DELETE SET NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE SET NULL,
  FOREIGN KEY(actor_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_transaction_inventory(inventory_id),
  INDEX idx_transaction_employee(employee_id),
  INDEX idx_transaction_created(created_at),
  INDEX idx_transaction_action_created(action,created_at)
) ENGINE=InnoDB;

CREATE TABLE audit_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  actor_id BIGINT UNSIGNED NULL,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(100) NOT NULL,
  entity_id VARCHAR(100) NULL,
  details JSON NULL,
  ip_address VARCHAR(45) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(actor_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_audit_created(created_at),
  INDEX idx_audit_actor(actor_id),
  INDEX idx_audit_action_created(action,created_at)
) ENGINE=InnoDB;

INSERT INTO roles(name,description) VALUES
('Administrator','Full system administration access'),
('Inventory User','Inventory issue and operations access');

INSERT INTO permissions(code,name,description) VALUES
('DASHBOARD_VIEW','View dashboard','View permitted dashboard information'),
('INVENTORY_VIEW','View inventory','View permitted inventory'),
('INVENTORY_CREATE','Create inventory','Add inventory records'),
('INVENTORY_UPDATE','Update inventory','Edit inventory records'),
('INVENTORY_DELETE','Retire inventory','Retire inventory without destroying history'),
('ASSIGNMENT_CREATE','Assign inventory','Issue inventory to employees'),
('ASSIGNMENT_RETURN','Return inventory','Return assigned equipment to available stock'),
('ASSIGNMENT_CONSUME','Record consumption','Record consumables issued to employees as consumed'),
('USERS_VIEW','View users','Administrator-only user administration'),
('USERS_MANAGE','Manage users','Administrator-only user management'),
('ROLES_MANAGE','Manage roles','Administrator-only role/permission management'),
('AUDIT_VIEW','View audit logs','Administrator-only system audit history'),
('CHEMICAL_MASTER_ACCESS','Access chemical master','Access chemical master pages'),
('VENDOR_MASTER_ACCESS','Access vendor master','Access vendor master pages'),
('GLASSWARE_MASTER_ACCESS','Access glassware master','Access glassware master pages'),
('EQUIPMENT_MASTER_ACCESS','Access equipment master','Access equipment and instruments master pages');

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.name='Administrator';

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p
ON p.code IN ('DASHBOARD_VIEW','INVENTORY_VIEW','INVENTORY_CREATE','INVENTORY_UPDATE','INVENTORY_DELETE','ASSIGNMENT_CREATE','ASSIGNMENT_RETURN','ASSIGNMENT_CONSUME')
WHERE r.name='Inventory User';
