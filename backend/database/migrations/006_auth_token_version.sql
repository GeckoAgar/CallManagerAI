USE callmanagerai;

SET @users_token_version_column_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'token_version'
);
SET @add_users_token_version_column = IF(
  @users_token_version_column_exists = 0,
  'ALTER TABLE users ADD COLUMN token_version INT UNSIGNED NOT NULL DEFAULT 0',
  'SELECT 1'
);
PREPARE users_token_version_statement FROM @add_users_token_version_column;
EXECUTE users_token_version_statement;
DEALLOCATE PREPARE users_token_version_statement;
