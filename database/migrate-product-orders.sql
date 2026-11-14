USE company_inventory;

CREATE TABLE IF NOT EXISTS company_settings (
  id TINYINT UNSIGNED PRIMARY KEY,
  company_name VARCHAR(150) NOT NULL,
  address VARCHAR(500) NULL,
  contact_number VARCHAR(30) NULL,
  email VARCHAR(254) NULL,
  tax_registration_number VARCHAR(30) NULL,
  logo_path VARCHAR(255) NOT NULL DEFAULT '/logo.png',
  jurisdiction VARCHAR(150) NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

INSERT IGNORE INTO company_settings(id,company_name,address,contact_number,email,tax_registration_number,logo_path,jurisdiction)
VALUES(1,'AVITECH NUTRITION PVT. LTD.','GP-37, Sector 18, HSIIDC, Gurugram, Haryana, India 122015',
  '+91-124-4011148','purchase@avitechnutrition.com',NULL,'/logo.png','Gurugram jurisdiction');

CREATE TABLE IF NOT EXISTS purchase_orders (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  po_number VARCHAR(40) NULL UNIQUE,
  order_date DATE NOT NULL,
  vendor_id BIGINT UNSIGNED NOT NULL,
  vendor_name VARCHAR(150) NOT NULL,
  vendor_contact_number VARCHAR(30) NOT NULL,
  vendor_address VARCHAR(500) NOT NULL,
  vendor_email VARCHAR(254) NULL,
  company_name VARCHAR(150) NOT NULL,
  company_address VARCHAR(500) NULL,
  company_contact_number VARCHAR(30) NULL,
  company_email VARCHAR(254) NULL,
  company_tax_registration_number VARCHAR(30) NULL,
  company_logo_path VARCHAR(255) NOT NULL,
  company_jurisdiction VARCHAR(150) NULL,
  total_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  advance_percent DECIMAL(5,2) NULL DEFAULT NULL,
  advance_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  remaining_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  payment_conditions VARCHAR(1000) NULL,
  notes VARCHAR(2000) NULL,
  created_by BIGINT UNSIGNED NULL,
  updated_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY(vendor_id) REFERENCES vendor_master(id) ON DELETE RESTRICT,
  FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(updated_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_purchase_order_date(order_date),
  INDEX idx_purchase_order_vendor(vendor_id),
  CHECK(advance_percent>=0 AND advance_percent<=100),
  CHECK(total_amount>=0 AND advance_amount>=0 AND remaining_amount>=0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  purchase_order_id BIGINT UNSIGNED NOT NULL,
  serial_number INT UNSIGNED NOT NULL,
  product_name VARCHAR(200) NOT NULL,
  description VARCHAR(1000) NULL,
  quantity DECIMAL(12,3) NOT NULL,
  unit VARCHAR(30) NOT NULL,
  rate DECIMAL(15,2) NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  FOREIGN KEY(purchase_order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE,
  UNIQUE KEY uq_purchase_order_serial(purchase_order_id,serial_number),
  CHECK(quantity>0 AND rate>=0 AND amount>=0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS purchase_order_history (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  purchase_order_id BIGINT UNSIGNED NULL,
  po_number VARCHAR(40) NOT NULL,
  action ENUM('CREATED','UPDATED','DELETED') NOT NULL,
  actor_id BIGINT UNSIGNED NULL,
  snapshot JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(purchase_order_id) REFERENCES purchase_orders(id) ON DELETE SET NULL,
  FOREIGN KEY(actor_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_purchase_order_history_order(purchase_order_id),
  INDEX idx_purchase_order_history_created(created_at)
) ENGINE=InnoDB;
