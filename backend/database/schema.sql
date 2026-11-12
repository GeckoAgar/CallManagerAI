CREATE DATABASE IF NOT EXISTS callmanagerai;
USE callmanagerai;

CREATE TABLE IF NOT EXISTS roles (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(50) NOT NULL UNIQUE,
  description VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role_id INT NOT NULL,
  status ENUM('active', 'inactive', 'blocked') DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (role_id) REFERENCES roles(id)
);

CREATE TABLE IF NOT EXISTS contacts (
  id INT PRIMARY KEY AUTO_INCREMENT,
  owner_id INT NULL,
  name VARCHAR(120) NOT NULL,
  company VARCHAR(120),
  phone VARCHAR(30),
  email VARCHAR(150),
  status ENUM('active', 'inactive') DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS calls (
  id INT PRIMARY KEY AUTO_INCREMENT,
  contact_id INT,
  agent_id INT,
  phone_number VARCHAR(30),
  direction ENUM('inbound', 'outbound') DEFAULT 'inbound',
  status ENUM('queued', 'active', 'completed', 'failed') DEFAULT 'queued',
  duration_seconds INT DEFAULT 0,
  score DECIMAL(5,2) DEFAULT 0.00,
  provider_call_sid VARCHAR(64) NULL UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (contact_id) REFERENCES contacts(id),
  FOREIGN KEY (agent_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS agent_presence (
  user_id INT PRIMARY KEY,
  status ENUM('offline', 'available', 'busy') NOT NULL DEFAULT 'offline',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS recordings (
  id INT PRIMARY KEY AUTO_INCREMENT,
  call_id INT NOT NULL,
  file_name VARCHAR(200),
  url VARCHAR(255),
  duration_seconds INT DEFAULT 0,
  transcription TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (call_id) REFERENCES calls(id)
);

CREATE TABLE IF NOT EXISTS surveillance_queue (
  id INT PRIMARY KEY AUTO_INCREMENT,
  agent_id INT,
  call_id INT,
  status ENUM('waiting', 'monitoring', 'escalated') DEFAULT 'waiting',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (agent_id) REFERENCES users(id),
  FOREIGN KEY (call_id) REFERENCES calls(id)
);

INSERT IGNORE INTO roles (name, description) VALUES
  ('ADMIN', 'Administración total del sistema'),
  ('USER', 'Usuario estándar con permisos de gestión operativa');
