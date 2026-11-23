USE company_inventory;

ALTER TABLE inventory_products
  MODIFY COLUMN minimum_stock DECIMAL(12,3) NOT NULL DEFAULT 15;

UPDATE inventory_products
SET minimum_stock=15;
