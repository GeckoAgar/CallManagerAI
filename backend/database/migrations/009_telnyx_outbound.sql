CREATE TABLE IF NOT EXISTS telnyx_outbound_calls (
  call_id INT PRIMARY KEY,
  reservation_id CHAR(36) NOT NULL UNIQUE,
  call_control_id VARCHAR(512) NULL,
  call_session_id VARCHAR(64) NULL,
  started_at DATETIME NULL,
  phase ENUM('reserved', 'transferring', 'active', 'finished') NOT NULL DEFAULT 'reserved',
  CONSTRAINT fk_telnyx_outbound_call FOREIGN KEY (call_id) REFERENCES calls(id) ON DELETE CASCADE,
  INDEX idx_telnyx_outbound_session (call_session_id)
);
