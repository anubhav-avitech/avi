USE company_inventory;

ALTER TABLE chemical_master
  MODIFY COLUMN chemical_type ENUM('LIQUID','POWDER','PALLETS','GRANULES') NULL;

ALTER TABLE inventory_items
  MODIFY COLUMN chemical_form ENUM('LIQUID','POWDER','PALLETS','GRANULES') NULL;

ALTER TABLE inventory_assignments
  MODIFY COLUMN chemical_form ENUM('LIQUID','POWDER','PALLETS','GRANULES') NULL;
