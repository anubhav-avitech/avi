USE company_inventory;

-- Preserves inventory details and history; duplicate master names are merged. Back up before applying.

CREATE TABLE IF NOT EXISTS glassware_master (
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

CREATE TABLE IF NOT EXISTS equipment_instrument_master (
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

DELIMITER //

DROP PROCEDURE IF EXISTS migrate_glassware_equipment_masters//
CREATE PROCEDURE migrate_glassware_equipment_masters()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inventory_products'
      AND COLUMN_NAME='item_code'
  ) THEN
    ALTER TABLE inventory_products ADD COLUMN item_code VARCHAR(45) NULL AFTER minimum_stock;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inventory_products'
      AND COLUMN_NAME='description'
  ) THEN
    ALTER TABLE inventory_products ADD COLUMN description VARCHAR(500) NULL AFTER item_code;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inventory_products'
      AND COLUMN_NAME='status'
  ) THEN
    ALTER TABLE inventory_products
      ADD COLUMN status ENUM('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE' AFTER description;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inventory_products'
      AND INDEX_NAME='uq_inventory_product_item_code'
  ) THEN
    CREATE UNIQUE INDEX uq_inventory_product_item_code ON inventory_products(item_code);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inventory_products'
      AND INDEX_NAME='idx_inventory_product_status'
  ) THEN
    CREATE INDEX idx_inventory_product_status ON inventory_products(status);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inventory_items'
      AND COLUMN_NAME='glassware_master_id'
  ) THEN
    ALTER TABLE inventory_items ADD COLUMN glassware_master_id BIGINT UNSIGNED NULL AFTER vendor_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inventory_items'
      AND COLUMN_NAME='equipment_master_id'
  ) THEN
    ALTER TABLE inventory_items ADD COLUMN equipment_master_id BIGINT UNSIGNED NULL AFTER glassware_master_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='glassware_master'
      AND COLUMN_NAME='name'
  ) THEN
    ALTER TABLE glassware_master ADD COLUMN name VARCHAR(150) NULL AFTER id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='equipment_instrument_master'
      AND COLUMN_NAME='name'
  ) THEN
    ALTER TABLE equipment_instrument_master ADD COLUMN name VARCHAR(150) NULL AFTER id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inventory_items'
      AND COLUMN_NAME='glassware_type'
  ) THEN
    ALTER TABLE inventory_items ADD COLUMN glassware_type VARCHAR(100) NULL AFTER expiry_date;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inventory_items'
      AND COLUMN_NAME='capacity'
  ) THEN
    ALTER TABLE inventory_items ADD COLUMN capacity DECIMAL(12,3) NULL AFTER glassware_type;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inventory_items'
      AND COLUMN_NAME='capacity_unit'
  ) THEN
    ALTER TABLE inventory_items ADD COLUMN capacity_unit ENUM('ml','L','µl') NULL AFTER capacity;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inventory_items'
      AND COLUMN_NAME='material'
  ) THEN
    ALTER TABLE inventory_items ADD COLUMN material VARCHAR(100) NULL AFTER capacity_unit;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inventory_items'
      AND COLUMN_NAME='glass_class'
  ) THEN
    ALTER TABLE inventory_items ADD COLUMN glass_class ENUM('CLASS_A','CLASS_B','NOT_APPLICABLE') NULL AFTER material;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inventory_items'
      AND COLUMN_NAME='graduation'
  ) THEN
    ALTER TABLE inventory_items ADD COLUMN graduation ENUM('GRADUATED','NON_GRADUATED') NULL AFTER glass_class;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inventory_items'
      AND COLUMN_NAME='equipment_type'
  ) THEN
    ALTER TABLE inventory_items ADD COLUMN equipment_type VARCHAR(100) NULL AFTER graduation;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inventory_items'
      AND COLUMN_NAME='model_number'
  ) THEN
    ALTER TABLE inventory_items ADD COLUMN model_number VARCHAR(100) NULL AFTER equipment_type;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inventory_items'
      AND COLUMN_NAME='technical_specifications'
  ) THEN
    ALTER TABLE inventory_items ADD COLUMN technical_specifications TEXT NULL AFTER model_number;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inventory_items'
      AND COLUMN_NAME='calibration_required'
  ) THEN
    ALTER TABLE inventory_items ADD COLUMN calibration_required TINYINT(1) NULL AFTER technical_specifications;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inventory_items'
      AND COLUMN_NAME='calibration_frequency'
  ) THEN
    ALTER TABLE inventory_items ADD COLUMN calibration_frequency VARCHAR(100) NULL AFTER calibration_required;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inventory_items'
      AND COLUMN_NAME='warranty_applicable'
  ) THEN
    ALTER TABLE inventory_items ADD COLUMN warranty_applicable TINYINT(1) NULL AFTER calibration_frequency;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='inventory_items'
      AND CONSTRAINT_NAME='fk_inventory_glassware_product'
  ) THEN
    ALTER TABLE inventory_items DROP FOREIGN KEY fk_inventory_glassware_product;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='inventory_items'
      AND CONSTRAINT_NAME='fk_inventory_equipment_product'
  ) THEN
    ALTER TABLE inventory_items DROP FOREIGN KEY fk_inventory_equipment_product;
  END IF;

  UPDATE glassware_master m
  JOIN inventory_products p ON p.id=m.product_id
  SET m.name=TRIM(p.name)
  WHERE m.name IS NULL OR m.name='';
  UPDATE equipment_instrument_master m
  JOIN inventory_products p ON p.id=m.product_id
  SET m.name=TRIM(p.name)
  WHERE m.name IS NULL OR m.name='';

  UPDATE inventory_items i
  JOIN glassware_master m ON m.id=i.glassware_master_id
  LEFT JOIN inventory_products p ON p.id=m.product_id
  SET i.description=COALESCE(i.description,p.description),
      i.glassware_type=COALESCE(i.glassware_type,m.glassware_type),
      i.capacity=COALESCE(i.capacity,m.capacity),
      i.capacity_unit=COALESCE(i.capacity_unit,m.capacity_unit),
      i.material=COALESCE(i.material,m.material),
      i.glass_class=COALESCE(i.glass_class,m.glass_class),
      i.graduation=COALESCE(i.graduation,m.graduation);
  UPDATE inventory_items i
  JOIN equipment_instrument_master m ON m.id=i.equipment_master_id
  LEFT JOIN inventory_products p ON p.id=m.product_id
  SET i.description=COALESCE(i.description,p.description),
      i.equipment_type=COALESCE(i.equipment_type,m.equipment_type),
      i.manufacturer=COALESCE(i.manufacturer,m.manufacturer_brand),
      i.model_number=COALESCE(i.model_number,m.model_number),
      i.technical_specifications=COALESCE(i.technical_specifications,m.technical_specifications),
      i.calibration_required=COALESCE(i.calibration_required,m.calibration_required),
      i.calibration_frequency=COALESCE(i.calibration_frequency,m.calibration_frequency),
      i.warranty_applicable=COALESCE(i.warranty_applicable,m.warranty_applicable);

  DROP TEMPORARY TABLE IF EXISTS tmp_glassware_master_names;
  CREATE TEMPORARY TABLE tmp_glassware_master_names AS
    SELECT name,MIN(id) AS keep_id FROM glassware_master GROUP BY name;
  UPDATE inventory_items i
  JOIN glassware_master m ON m.id=i.glassware_master_id
  JOIN tmp_glassware_master_names keep_name ON keep_name.name=m.name
  SET i.glassware_master_id=keep_name.keep_id
  WHERE m.id<>keep_name.keep_id;
  DELETE m FROM glassware_master m
  JOIN tmp_glassware_master_names keep_name ON keep_name.name=m.name
  WHERE m.id<>keep_name.keep_id;
  DROP TEMPORARY TABLE tmp_glassware_master_names;

  DROP TEMPORARY TABLE IF EXISTS tmp_equipment_master_names;
  CREATE TEMPORARY TABLE tmp_equipment_master_names AS
    SELECT name,MIN(id) AS keep_id FROM equipment_instrument_master GROUP BY name;
  UPDATE inventory_items i
  JOIN equipment_instrument_master m ON m.id=i.equipment_master_id
  JOIN tmp_equipment_master_names keep_name ON keep_name.name=m.name
  SET i.equipment_master_id=keep_name.keep_id
  WHERE m.id<>keep_name.keep_id;
  DELETE m FROM equipment_instrument_master m
  JOIN tmp_equipment_master_names keep_name ON keep_name.name=m.name
  WHERE m.id<>keep_name.keep_id;
  DROP TEMPORARY TABLE tmp_equipment_master_names;

  ALTER TABLE glassware_master
    MODIFY name VARCHAR(150) NOT NULL,
    MODIFY product_id BIGINT UNSIGNED NULL,
    MODIFY glassware_type VARCHAR(100) NULL,
    MODIFY capacity DECIMAL(12,3) NULL,
    MODIFY capacity_unit ENUM('ml','L','µl') NULL,
    MODIFY material VARCHAR(100) NULL,
    MODIFY graduation ENUM('GRADUATED','NON_GRADUATED') NULL;
  ALTER TABLE equipment_instrument_master
    MODIFY name VARCHAR(150) NOT NULL,
    MODIFY product_id BIGINT UNSIGNED NULL,
    MODIFY equipment_type VARCHAR(100) NULL;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='glassware_master'
      AND INDEX_NAME='uq_glassware_master_name'
  ) THEN
    CREATE UNIQUE INDEX uq_glassware_master_name ON glassware_master(name);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='equipment_instrument_master'
      AND INDEX_NAME='uq_equipment_master_name'
  ) THEN
    CREATE UNIQUE INDEX uq_equipment_master_name ON equipment_instrument_master(name);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inventory_items'
      AND INDEX_NAME='idx_inventory_glassware_master'
  ) THEN
    CREATE INDEX idx_inventory_glassware_master ON inventory_items(glassware_master_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inventory_items'
      AND INDEX_NAME='idx_inventory_equipment_master'
  ) THEN
    CREATE INDEX idx_inventory_equipment_master ON inventory_items(equipment_master_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inventory_items'
      AND COLUMN_NAME='glassware_master_id'
      AND REFERENCED_TABLE_NAME='glassware_master'
      AND REFERENCED_COLUMN_NAME='id'
  ) THEN
    ALTER TABLE inventory_items
      ADD CONSTRAINT fk_inventory_glassware_master
      FOREIGN KEY(glassware_master_id) REFERENCES glassware_master(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='inventory_items'
      AND COLUMN_NAME='equipment_master_id'
      AND REFERENCED_TABLE_NAME='equipment_instrument_master'
      AND REFERENCED_COLUMN_NAME='id'
  ) THEN
    ALTER TABLE inventory_items
      ADD CONSTRAINT fk_inventory_equipment_master
      FOREIGN KEY(equipment_master_id) REFERENCES equipment_instrument_master(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='inventory_items'
      AND CONSTRAINT_NAME='chk_inventory_single_master'
  ) THEN
    ALTER TABLE inventory_items
      ADD CONSTRAINT chk_inventory_single_master
      CHECK(
        (glassware_master_id IS NULL OR equipment_master_id IS NULL)
        AND (chemical_id IS NULL OR (glassware_master_id IS NULL AND equipment_master_id IS NULL))
      );
  END IF;

  IF NOT EXISTS (
      SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='inventory_items'
        AND CONSTRAINT_NAME='chk_inventory_glassware_capacity'
  ) THEN
      ALTER TABLE inventory_items
        ADD CONSTRAINT chk_inventory_glassware_capacity
        CHECK(capacity IS NULL OR capacity>0);
  END IF;
  IF NOT EXISTS (
      SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='inventory_items'
        AND CONSTRAINT_NAME='chk_inventory_equipment_flags'
  ) THEN
      ALTER TABLE inventory_items
        ADD CONSTRAINT chk_inventory_equipment_flags
        CHECK(
          (calibration_required IS NULL OR calibration_required IN (0,1))
          AND (warranty_applicable IS NULL OR warranty_applicable IN (0,1))
        );
  END IF;
END//

CALL migrate_glassware_equipment_masters()//
DROP PROCEDURE migrate_glassware_equipment_masters//

DELIMITER ;
