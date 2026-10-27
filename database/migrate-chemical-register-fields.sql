ALTER TABLE inventory_items
  ADD COLUMN vendor_name VARCHAR(150) NULL AFTER manufacturer,
  ADD COLUMN vendor_bill_no VARCHAR(100) NULL AFTER vendor_name,
  ADD COLUMN make_grade VARCHAR(150) NULL AFTER vendor_bill_no,
  ADD COLUMN received_by VARCHAR(150) NULL AFTER make_grade,
  ADD COLUMN received_date DATE NULL AFTER received_by;
