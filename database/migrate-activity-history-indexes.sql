USE company_inventory;

-- Non-destructive indexes for activity type and date-range filtering.
ALTER TABLE inventory_transactions
  ADD INDEX idx_transaction_action_created(action,created_at);

ALTER TABLE audit_logs
  ADD INDEX idx_audit_action_created(action,created_at);

ALTER TABLE purchase_order_history
  ADD INDEX idx_purchase_order_history_action_created(action,created_at);
