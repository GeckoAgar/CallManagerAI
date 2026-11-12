const { getJwtSecret } = require('./config/env');
const { testConnection, pool } = require('./config/db');
const app = require('./app');

const PORT = Number(process.env.PORT) || 4000;

(async () => {
  getJwtSecret();
  const connected = await testConnection();
  if (!connected) {
    console.error('API startup aborted. Configure MySQL and the project .env file, then restart.');
    await pool.end();
    process.exitCode = 1;
    return;
  }

  app.listen(PORT, () => {
    console.log(`CallManagerAI API running on http://localhost:${PORT}`);
  });
})().catch((error) => {
  console.error(`API startup failed: ${error.message}`);
  process.exitCode = 1;
});
