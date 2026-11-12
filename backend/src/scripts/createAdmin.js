const readline = require('readline');
const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');

function ask(question) {
  const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    terminal.question(question, (answer) => {
      terminal.close();
      resolve(answer.trim());
    });
  });
}

function askSecret(question) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    throw new Error('Admin creation requires an interactive terminal so the password is not echoed.');
  }

  return new Promise((resolve, reject) => {
    let value = '';
    const onData = (chunk) => {
      const character = chunk.toString();
      if (character === '\u0003') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener('data', onData);
        reject(new Error('Admin creation cancelled.'));
        return;
      }

      if (character === '\r' || character === '\n') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(value);
        return;
      }

      if (character === '\u007f' || character === '\b') {
        value = value.slice(0, -1);
        return;
      }

      if (character >= ' ') {
        value += character;
      }
    };

    process.stdout.write(question);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', onData);
  });
}

async function createAdmin() {
  const name = await ask('Administrator name: ');
  const email = (await ask('Administrator email: ')).toLowerCase();
  const password = await askSecret('Administrator password (hidden): ');

  if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12) {
    throw new Error('Provide a name, valid email, and a password of at least 12 characters.');
  }

  const [existing] = await pool.query('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
  if (existing.length) {
    throw new Error('That email already exists. This command only creates a new administrator and will not change existing accounts.');
  }

  const [roles] = await pool.query('SELECT id FROM roles WHERE name = ? LIMIT 1', ['ADMIN']);
  if (!roles.length) {
    throw new Error('ADMIN role not found. Run backend/database/schema.sql first.');
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await pool.query(
    'INSERT INTO users (name, email, password_hash, role_id, status) VALUES (?, ?, ?, ?, ?)',
    [name, email, passwordHash, roles[0].id, 'active']
  );
  console.log(`Administrator created for ${email}.`);
}

createAdmin()
  .catch((error) => {
    console.error(`Administrator creation failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
