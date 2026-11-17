USE callmanagerai;

SET @surveillance_queue_call_index_exists = (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'surveillance_queue'
    AND INDEX_NAME = 'uq_surveillance_queue_call_id'
    AND NON_UNIQUE = 0
    AND COLUMN_NAME = 'call_id'
);
SET @add_surveillance_queue_call_index = IF(
  @surveillance_queue_call_index_exists = 0,
  'ALTER TABLE surveillance_queue ADD UNIQUE KEY uq_surveillance_queue_call_id (call_id)',
  'SELECT 1'
);
PREPARE surveillance_queue_call_index_statement FROM @add_surveillance_queue_call_index;
EXECUTE surveillance_queue_call_index_statement;
DEALLOCATE PREPARE surveillance_queue_call_index_statement;
