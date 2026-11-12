const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const allowedStatuses = {
  user: ['active', 'inactive', 'blocked'],
  contact: ['active', 'inactive'],
  call: ['queued', 'active', 'completed', 'failed'],
  direction: ['inbound', 'outbound'],
};

function isPositiveId(value) {
  return Number.isInteger(Number(value)) && Number(value) > 0;
}

function hasText(value, maxLength) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maxLength;
}

function optionalText(value, maxLength) {
  return value == null || value === '' || (typeof value === 'string' && value.length <= maxLength);
}

function validEmail(value) {
  return typeof value === 'string' && value.length <= 150 && emailPattern.test(value.trim());
}

function validEnum(value, values) {
  return values.includes(value);
}

function validNonNegativeNumber(value, max) {
  return Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= max;
}

function validScore(value) {
  return Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100;
}

module.exports = {
  allowedStatuses,
  hasText,
  isPositiveId,
  optionalText,
  validEmail,
  validEnum,
  validNonNegativeNumber,
  validScore,
};
