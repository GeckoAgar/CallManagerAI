USE callmanagerai;

SET @contacts_deleted_at_column_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'contacts'
    AND COLUMN_NAME = 'deleted_at'
);
SET @add_contacts_deleted_at_column = IF(
  @contacts_deleted_at_column_exists = 0,
  'ALTER TABLE contacts ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL',
  'SELECT 1'
);
PREPARE contacts_deleted_at_statement FROM @add_contacts_deleted_at_column;
EXECUTE contacts_deleted_at_statement;
DEALLOCATE PREPARE contacts_deleted_at_statement;
