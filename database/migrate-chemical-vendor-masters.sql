USE company_inventory;

CREATE TABLE IF NOT EXISTS chemical_master (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS vendor_master (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL UNIQUE,
  contact_number VARCHAR(30) NOT NULL,
  address VARCHAR(500) NOT NULL,
  email VARCHAR(254) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

INSERT IGNORE INTO chemical_master(name)
SELECT DISTINCT TRIM(name)
FROM inventory_items
WHERE chemical_form IS NOT NULL AND TRIM(name)<>'';

INSERT IGNORE INTO vendor_master(name,contact_number,address,email)
SELECT DISTINCT TRIM(vendor_name),'Not provided','Not provided',NULL
FROM inventory_items
WHERE vendor_name IS NOT NULL AND TRIM(vendor_name)<>'';

ALTER TABLE inventory_items
  ADD COLUMN chemical_id BIGINT UNSIGNED NULL AFTER product_id,
  ADD COLUMN vendor_id BIGINT UNSIGNED NULL AFTER chemical_id,
  ADD INDEX idx_inventory_chemical(chemical_id),
  ADD INDEX idx_inventory_vendor(vendor_id),
  ADD CONSTRAINT fk_inventory_chemical_master
    FOREIGN KEY(chemical_id) REFERENCES chemical_master(id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_inventory_vendor_master
    FOREIGN KEY(vendor_id) REFERENCES vendor_master(id) ON DELETE RESTRICT;

UPDATE inventory_items i
JOIN chemical_master c ON c.name=TRIM(i.name)
SET i.chemical_id=c.id
WHERE i.chemical_form IS NOT NULL;

UPDATE inventory_items i
JOIN vendor_master v ON v.name=TRIM(i.vendor_name)
SET i.vendor_id=v.id
WHERE i.vendor_name IS NOT NULL;
