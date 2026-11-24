const { z } = require('zod');

const allowedStatuses = {
  user: ['active', 'inactive', 'blocked'],
  contact: ['active', 'inactive'],
  call: ['queued', 'active', 'completed', 'failed'],
  direction: ['inbound', 'outbound'],
};

const numericInput = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const positiveId = numericInput.refine((value) => Number.isInteger(Number(value)) && Number(value) > 0);
const nonNegativeNumber = (max) => numericInput.refine(
  (value) => Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= max
);
const score = numericInput.refine((value) => Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100);
const text = (max) => z.string().refine((value) => value.trim().length > 0 && value.trim().length <= max);
const optionalText = (max) => z.string().max(max).nullable();
const email = z.string().refine((value) => value.length <= 150 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()));
const deviceSessionId = z.string().regex(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i);
const phoneNumber = z.string().regex(/^\+[1-9]\d{7,14}$/);

function isPositiveId(value) {
  return positiveId.safeParse(value).success;
}

module.exports = {
  allowedStatuses,
  deviceSessionId,
  email,
  isPositiveId,
  nonNegativeNumber,
  optionalText,
  phoneNumber,
  positiveId,
  score,
  text,
};
