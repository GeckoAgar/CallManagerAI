USE callmanagerai;

SET @owner_column_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'contacts'
    AND COLUMN_NAME = 'owner_id'
);
SET @add_owner_column = IF(
  @owner_column_exists = 0,
  'ALTER TABLE contacts ADD COLUMN owner_id INT NULL',
  'SELECT 1'
);
PREPARE owner_column_statement FROM @add_owner_column;
EXECUTE owner_column_statement;
DEALLOCATE PREPARE owner_column_statement;

SET @owner_fk_exists = (
  SELECT COUNT(*)
  FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'contacts'
    AND COLUMN_NAME = 'owner_id'
    AND REFERENCED_TABLE_NAME = 'users'
);
SET @add_owner_fk = IF(
  @owner_fk_exists = 0,
  'ALTER TABLE contacts ADD CONSTRAINT fk_contacts_owner FOREIGN KEY (owner_id) REFERENCES users(id)',
  'SELECT 1'
);
PREPARE owner_fk_statement FROM @add_owner_fk;
EXECUTE owner_fk_statement;
DEALLOCATE PREPARE owner_fk_statement;
