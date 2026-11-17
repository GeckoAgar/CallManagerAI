USE callmanagerai;

SET @calls_device_session_column_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'calls'
    AND COLUMN_NAME = 'agent_device_session_id'
);
SET @add_calls_device_session_column = IF(
  @calls_device_session_column_exists = 0,
  'ALTER TABLE calls ADD COLUMN agent_device_session_id VARCHAR(36) NULL',
  'SELECT 1'
);
PREPARE calls_device_session_statement FROM @add_calls_device_session_column;
EXECUTE calls_device_session_statement;
DEALLOCATE PREPARE calls_device_session_statement;

SET @presence_device_session_column_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'agent_presence'
    AND COLUMN_NAME = 'device_session_id'
);
SET @add_presence_device_session_column = IF(
  @presence_device_session_column_exists = 0,
  'ALTER TABLE agent_presence ADD COLUMN device_session_id VARCHAR(36) NULL',
  'SELECT 1'
);
PREPARE presence_device_session_statement FROM @add_presence_device_session_column;
EXECUTE presence_device_session_statement;
DEALLOCATE PREPARE presence_device_session_statement;
