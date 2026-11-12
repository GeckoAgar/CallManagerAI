ALTER TABLE calls
  ADD COLUMN provider_call_sid VARCHAR(64) NULL,
  ADD UNIQUE KEY uq_calls_provider_call_sid (provider_call_sid);

CREATE TABLE IF NOT EXISTS agent_presence (
  user_id INT PRIMARY KEY,
  status ENUM('offline', 'available', 'busy') NOT NULL DEFAULT 'offline',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_agent_presence_user
    FOREIGN KEY (user_id) REFERENCES users(id)
);
