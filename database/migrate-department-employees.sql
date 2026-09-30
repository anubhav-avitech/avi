USE company_inventory;

-- Run once on an existing database. Back up the database first.

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

ALTER TABLE inventory_assignments
  MODIFY user_id BIGINT UNSIGNED NULL,
  ADD COLUMN employee_id BIGINT UNSIGNED NULL AFTER user_id,
  ADD INDEX idx_assignment_employee(employee_id),
  ADD CONSTRAINT fk_assignment_employee FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE RESTRICT;

ALTER TABLE inventory_transactions
  ADD COLUMN employee_id BIGINT UNSIGNED NULL AFTER user_id,
  ADD INDEX idx_transaction_employee(employee_id),
  ADD CONSTRAINT fk_transaction_employee FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE SET NULL;