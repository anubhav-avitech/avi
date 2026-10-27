USE company_inventory;

-- Keep assignment and transaction rows while automatically clearing references
-- when a login account is permanently deleted.
ALTER TABLE inventory_assignments
  DROP FOREIGN KEY inventory_assignments_ibfk_2,
  DROP FOREIGN KEY inventory_assignments_ibfk_4,
  MODIFY COLUMN assigned_by BIGINT UNSIGNED NULL,
  ADD CONSTRAINT fk_inventory_assignments_user
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_inventory_assignments_assigned_by
    FOREIGN KEY(assigned_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE inventory_transactions
  DROP FOREIGN KEY inventory_transactions_ibfk_2,
  DROP FOREIGN KEY inventory_transactions_ibfk_4,
  MODIFY COLUMN actor_id BIGINT UNSIGNED NULL,
  ADD CONSTRAINT fk_inventory_transactions_user
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_inventory_transactions_actor
    FOREIGN KEY(actor_id) REFERENCES users(id) ON DELETE SET NULL;
