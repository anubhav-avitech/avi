USE company_inventory;

DELIMITER //

DROP PROCEDURE IF EXISTS migrate_single_lab_department//
CREATE PROCEDURE migrate_single_lab_department()
BEGIN
  DECLARE lab_count INT DEFAULT 0;
  DECLARE linked_department_count INT DEFAULT 0;

  SELECT COUNT(*) INTO lab_count
  FROM departments
  WHERE name='Lab';

  IF lab_count <> 1 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT='Expected exactly one Lab department; migration stopped.';
  END IF;

  SELECT COUNT(*) INTO linked_department_count
  FROM departments d
  WHERE d.name<>'Lab'
    AND (
      EXISTS (SELECT 1 FROM users u WHERE u.department_id=d.id)
      OR EXISTS (SELECT 1 FROM employees e WHERE e.department_id=d.id)
      OR EXISTS (SELECT 1 FROM inventory_items i WHERE i.department_id=d.id)
    );

  IF linked_department_count > 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT='Non-Lab departments contain users, employees, or inventory; migration stopped without deleting departments.';
  END IF;

  START TRANSACTION;
  UPDATE departments SET status='ACTIVE' WHERE name='Lab';
  DELETE FROM departments WHERE name<>'Lab';
  DELETE rp
  FROM role_permissions rp
  JOIN permissions p ON p.id=rp.permission_id
  WHERE p.code='DEPARTMENTS_MANAGE';
  DELETE FROM permissions WHERE code='DEPARTMENTS_MANAGE';
  COMMIT;
END//

CALL migrate_single_lab_department()//
DROP PROCEDURE migrate_single_lab_department//

DELIMITER ;
