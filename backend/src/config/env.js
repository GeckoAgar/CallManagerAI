const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32 || secret.startsWith('replace_with_')) {
    throw new Error('JWT_SECRET must be set in the project .env file and contain at least 32 characters.');
  }
  return secret;
}

module.exports = { getJwtSecret };
