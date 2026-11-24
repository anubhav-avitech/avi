USE company_inventory;

ALTER TABLE chemical_master
  ADD COLUMN chemical_type ENUM('LIQUID','POWDER') NULL AFTER name;

ALTER TABLE inventory_items
  ADD COLUMN package_count DECIMAL(12,3) NULL AFTER container_unit,
  ADD COLUMN packaging_type VARCHAR(100) NULL AFTER package_count,
  ADD COLUMN chemical_batch_key VARCHAR(100) NULL AFTER batch_number,
  MODIFY COLUMN container_unit ENUM('L','ml','kg','g','mg') NULL;

ALTER TABLE inventory_assignments
  MODIFY COLUMN container_unit ENUM('L','ml','kg','g','mg') NULL;

UPDATE chemical_master cm
SET chemical_type='LIQUID'
WHERE chemical_type IS NULL
  AND EXISTS (
    SELECT 1 FROM inventory_items i
    WHERE i.chemical_id=cm.id
      AND i.chemical_form='LIQUID'
  );

UPDATE chemical_master cm
SET chemical_type='POWDER'
WHERE chemical_type IS NULL
  AND EXISTS (
    SELECT 1 FROM inventory_items i
    WHERE i.chemical_id=cm.id
      AND i.chemical_form='POWDER'
  );

UPDATE inventory_items i
SET packaging_type=i.unit,
    package_count=COALESCE((
      SELECT SUM(t.quantity)
      FROM inventory_transactions t
      WHERE t.inventory_id=i.id AND t.action='ADD'
    ),i.quantity)
WHERE i.chemical_form IS NOT NULL;

UPDATE inventory_items i
JOIN (
  SELECT chemical_id,batch_number,COUNT(*) AS line_count
  FROM inventory_items
  WHERE chemical_id IS NOT NULL AND batch_number IS NOT NULL
  GROUP BY chemical_id,batch_number
) batches
  ON batches.chemical_id=i.chemical_id
 AND batches.batch_number=i.batch_number
 AND batches.line_count=1
SET i.chemical_batch_key=i.batch_number;

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

INSERT INTO inventory_stock_receipts(
  inventory_id,package_count,package_capacity,measurement_unit,received_quantity,
  packaging_type,receipt_date,vendor_id,vendor_bill_no,received_by,created_by
)
SELECT i.id,t.quantity,i.container_capacity,i.container_unit,
       ROUND(t.quantity*i.container_capacity,3),i.packaging_type,DATE(t.created_at),
       CASE WHEN COALESCE(JSON_UNQUOTE(JSON_EXTRACT(t.details,'$.restock')),'false')='true' THEN NULL ELSE i.vendor_id END,
       CASE WHEN COALESCE(JSON_UNQUOTE(JSON_EXTRACT(t.details,'$.restock')),'false')='true' THEN NULL ELSE i.vendor_bill_no END,
       CASE WHEN COALESCE(JSON_UNQUOTE(JSON_EXTRACT(t.details,'$.restock')),'false')='true' THEN NULL ELSE i.received_by END,
       t.actor_id
FROM inventory_items i
JOIN inventory_transactions t ON t.inventory_id=i.id AND t.action='ADD'
WHERE i.chemical_form IS NOT NULL
  AND i.container_capacity IS NOT NULL
  AND i.container_unit IS NOT NULL;

INSERT INTO inventory_stock_receipts(
  inventory_id,package_count,package_capacity,measurement_unit,received_quantity,
  packaging_type,receipt_date,vendor_id,vendor_bill_no,received_by
)
SELECT i.id,i.quantity,i.container_capacity,i.container_unit,
       ROUND(i.quantity*i.container_capacity,3),i.packaging_type,i.received_date,
       i.vendor_id,i.vendor_bill_no,i.received_by
FROM inventory_items i
WHERE i.chemical_form IS NOT NULL
  AND i.container_capacity IS NOT NULL
  AND i.container_unit IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM inventory_stock_receipts r WHERE r.inventory_id=i.id
  );

UPDATE inventory_assignments a
JOIN inventory_items i ON i.id=a.inventory_id
SET a.quantity=ROUND(a.quantity*COALESCE(a.container_capacity,i.container_capacity),3),
    a.unit=COALESCE(a.container_unit,i.container_unit)
WHERE a.chemical_form IS NOT NULL
  AND COALESCE(a.container_capacity,i.container_capacity)>0;

UPDATE inventory_transactions t
JOIN inventory_items i ON i.id=t.inventory_id
SET t.quantity=ROUND(t.quantity*i.container_capacity,3),
    t.unit=i.container_unit,
    t.details=CASE
      WHEN t.details IS NOT NULL AND JSON_CONTAINS_PATH(t.details,'one','$.balance_after')
        THEN JSON_SET(
          t.details,
          '$.balance_after',
          ROUND(
            CAST(JSON_UNQUOTE(JSON_EXTRACT(t.details,'$.balance_after')) AS DECIMAL(15,3))
            * i.container_capacity,
            3
          )
        )
      ELSE t.details
    END
WHERE i.chemical_form IS NOT NULL
  AND t.quantity IS NOT NULL
  AND i.container_capacity IS NOT NULL;

UPDATE inventory_items
SET quantity=ROUND(quantity*container_capacity,3),
    unit=container_unit
WHERE chemical_form IS NOT NULL
  AND container_capacity IS NOT NULL
  AND container_unit IS NOT NULL;

ALTER TABLE inventory_items
  ADD UNIQUE INDEX uq_inventory_chemical_batch_key(chemical_id,chemical_batch_key);
