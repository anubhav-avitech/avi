CREATE DATABASE IF NOT EXISTS company_inventory CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE company_inventory;

-- Fresh schema. If you already have data you need to keep, back it up before rebuilding.
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS inventory_transactions;
DROP TABLE IF EXISTS inventory_assignments;
DROP TABLE IF EXISTS employees;
DROP TABLE IF EXISTS inventory_items;
DROP TABLE IF EXISTS role_permissions;
DROP TABLE IF EXISTS permissions;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS roles;
DROP TABLE IF EXISTS departments;

CREATE TABLE departments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  description VARCHAR(500) NULL,
  status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE roles (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  description VARCHAR(500) NULL,
  scope ENUM('ALL','DEPARTMENT') NOT NULL,
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
  department_id BIGINT UNSIGNED NULL,
  role_id BIGINT UNSIGNED NOT NULL,
  status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY(department_id) REFERENCES departments(id) ON DELETE SET NULL,
  FOREIGN KEY(role_id) REFERENCES roles(id) ON DELETE RESTRICT,
  INDEX idx_users_department(department_id),
  INDEX idx_users_status(status)
) ENGINE=InnoDB;

CREATE TABLE employees (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(150) NOT NULL,
  department_id BIGINT UNSIGNED NOT NULL,
  status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY(department_id) REFERENCES departments(id) ON DELETE RESTRICT,
  INDEX idx_employees_department(department_id),
  INDEX idx_employees_status(status)
) ENGINE=InnoDB;

CREATE TABLE inventory_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  asset_code VARCHAR(80) NOT NULL UNIQUE,
  name VARCHAR(150) NOT NULL,
  item_type ENUM('ASSET','CONSUMABLE') NOT NULL DEFAULT 'ASSET',
  category VARCHAR(100) NULL,
  description VARCHAR(500) NULL,
  serial_number VARCHAR(150) NULL UNIQUE,
  quantity DECIMAL(12,3) NOT NULL DEFAULT 1,
  unit VARCHAR(30) NOT NULL DEFAULT 'Piece',
  department_id BIGINT UNSIGNED NOT NULL,
  status ENUM('AVAILABLE','ASSIGNED','MAINTENANCE','LOST','DAMAGED','RETIRED') NOT NULL DEFAULT 'AVAILABLE',
  location VARCHAR(150) NULL,
  batch_number VARCHAR(100) NULL,
  manufacturer VARCHAR(150) NULL,
  vendor_name VARCHAR(150) NULL,
  vendor_bill_no VARCHAR(100) NULL,
  make_grade VARCHAR(150) NULL,
  received_by VARCHAR(150) NULL,
  received_date DATE NULL,
  expiry_date DATE NULL,
  chemical_form ENUM('LIQUID','POWDER') NULL,
  container_capacity DECIMAL(12,3) NULL,
  container_unit ENUM('ml','L','g','kg') NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY(department_id) REFERENCES departments(id) ON DELETE RESTRICT,
  INDEX idx_inventory_department(department_id),
  INDEX idx_inventory_status(status),
  INDEX idx_inventory_type(item_type),
  INDEX idx_inventory_expiry(expiry_date)
) ENGINE=InnoDB;

CREATE TABLE inventory_assignments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  inventory_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NULL,
  employee_id BIGINT UNSIGNED NULL,
  quantity DECIMAL(12,3) NOT NULL,
  unit VARCHAR(30) NOT NULL,
  chemical_form ENUM('LIQUID','POWDER') NULL,
  batch_number VARCHAR(100) NULL,
  expiry_date DATE NULL,
  container_capacity DECIMAL(12,3) NULL,
  container_unit ENUM('ml','L','g','kg') NULL,
  assigned_by BIGINT UNSIGNED NULL,
  assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  returned_at TIMESTAMP NULL,
  returned_quantity DECIMAL(12,3) NULL,
  return_note VARCHAR(500) NULL,
  FOREIGN KEY(inventory_id) REFERENCES inventory_items(id) ON DELETE RESTRICT,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE RESTRICT,
  FOREIGN KEY(assigned_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_assignment_inventory(inventory_id),
  INDEX idx_assignment_user(user_id),
  INDEX idx_assignment_employee(employee_id),
  INDEX idx_assignment_active(returned_at)
) ENGINE=InnoDB;

CREATE TABLE inventory_transactions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  inventory_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NULL,
  employee_id BIGINT UNSIGNED NULL,
  actor_id BIGINT UNSIGNED NULL,
  action ENUM('ADD','UPDATE','ASSIGN','RETURN','STATUS_CHANGE','RETIRE') NOT NULL,
  quantity DECIMAL(12,3) NULL,
  unit VARCHAR(30) NULL,
  details JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(inventory_id) REFERENCES inventory_items(id) ON DELETE RESTRICT,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE SET NULL,
  FOREIGN KEY(actor_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_transaction_inventory(inventory_id),
  INDEX idx_transaction_employee(employee_id),
  INDEX idx_transaction_created(created_at)
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
  INDEX idx_audit_actor(actor_id)
) ENGINE=InnoDB;

INSERT INTO departments(name,description) VALUES
('IT','Information Technology'),
('HR','Human Resources'),
('Production','Production Department'),
('Quality','Quality Department'),
('Accounts','Accounts Department'),
('Lab','Laboratory');

INSERT INTO roles(name,description,scope) VALUES
('Administrator','Full company-wide system access','ALL'),
('Department User','Inventory access limited to the assigned department','DEPARTMENT');

INSERT INTO permissions(code,name,description) VALUES
('DASHBOARD_VIEW','View dashboard','View permitted dashboard information'),
('INVENTORY_VIEW','View inventory','View permitted inventory'),
('INVENTORY_CREATE','Create inventory','Add inventory records'),
('INVENTORY_UPDATE','Update inventory','Edit inventory records'),
('INVENTORY_DELETE','Retire inventory','Retire inventory without destroying history'),
('ASSIGNMENT_CREATE','Assign inventory','Assign inventory within permitted department scope'),
('ASSIGNMENT_RETURN','Return inventory','Process inventory returns within permitted scope'),
('USERS_VIEW','View users','Administrator-only user administration'),
('USERS_MANAGE','Manage users','Administrator-only user management'),
('DEPARTMENTS_MANAGE','Manage departments','Administrator-only department management'),
('ROLES_MANAGE','Manage roles','Administrator-only role/permission management'),
('AUDIT_VIEW','View audit logs','Administrator-only system audit history');

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.name='Administrator'
  AND p.code NOT IN ('INVENTORY_CREATE','ASSIGNMENT_CREATE');

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p
ON p.code IN ('DASHBOARD_VIEW','INVENTORY_VIEW','INVENTORY_CREATE','INVENTORY_UPDATE','INVENTORY_DELETE','ASSIGNMENT_CREATE','ASSIGNMENT_RETURN')
WHERE r.name='Department User';
