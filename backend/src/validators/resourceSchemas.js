const { z } = require('zod');
const {
  allowedStatuses, email, nonNegativeNumber, optionalText, positiveId, score, text,
} = require('../utils/resourceValidation');

const field = (schema, message) => schema.describe(message);
const optionalField = (schema, message) => schema.optional().describe(message);
const nullableId = positiveId.nullable().or(z.literal(''));
const password = z.string().min(6);

function contactSchema(partial) {
  return z.object({
    name: partial ? optionalField(text(120), 'Nombre inválido.') : field(text(120), 'El nombre del contacto es obligatorio.'),
    company: optionalField(optionalText(120), 'Empresa inválida.'),
    phone: optionalField(optionalText(30), 'Teléfono inválido.'),
    email: optionalField(email.or(z.literal('')), 'Correo inválido.'),
    status: optionalField(z.enum(allowedStatuses.contact), 'Estado inválido.'),
    owner_id: optionalField(nullableId, 'Propietario inválido.'),
  }).strict('Campos de contacto inválidos.').describe('Campos de contacto inválidos.');
}

function callSchema(partial) {
  return z.object({
    phone_number: partial ? optionalField(text(30), 'Número telefónico inválido.') : field(text(30), 'El número telefónico es obligatorio.'),
    contact_id: optionalField(nullableId, 'Contacto inválido.'),
    agent_id: optionalField(nullableId, 'Asesor inválido.'),
    direction: optionalField(z.enum(allowedStatuses.direction), 'Dirección de llamada inválida.'),
    status: optionalField(z.enum(allowedStatuses.call), 'Estado de llamada inválido.'),
    duration_seconds: optionalField(nonNegativeNumber(2147483647), 'Duración inválida.'),
    score: optionalField(score, 'La calificación debe estar entre 0 y 100.'),
  }).strict('Campos de llamada inválidos.').describe('Campos de llamada inválidos.');
}

const recordingUrl = optionalText(255).superRefine((value, ctx) => {
  if (!value) return;
  let url;
  try {
    url = new URL(value);
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'URL inválida.' });
    return;
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'La URL debe usar HTTP o HTTPS.' });
  }
});

function recordingSchema(partial) {
  return z.object({
    call_id: partial ? optionalField(positiveId, 'Llamada inválida.') : field(positiveId, 'La llamada es obligatoria.'),
    file_name: partial ? optionalField(text(200), 'Nombre de archivo inválido.') : field(text(200), 'El nombre del archivo es obligatorio.'),
    url: recordingUrl.optional().describe('URL inválida.'),
    duration_seconds: optionalField(nonNegativeNumber(2147483647), 'Duración inválida.'),
    transcription: optionalField(optionalText(65535), 'Transcripción demasiado larga.'),
  }).strict('Campos de grabación inválidos.').describe('Campos de grabación inválidos.');
}

const userCreateSchema = z.object({
  name: field(text(120), 'Nombre, correo, contraseña, rol y estado válidos son obligatorios.'),
  email: field(email, 'Nombre, correo, contraseña, rol y estado válidos son obligatorios.'),
  password: field(password, 'Nombre, correo, contraseña, rol y estado válidos son obligatorios.'),
  role_id: field(positiveId, 'Nombre, correo, contraseña, rol y estado válidos son obligatorios.'),
  status: optionalField(z.enum(allowedStatuses.user), 'Nombre, correo, contraseña, rol y estado válidos son obligatorios.'),
}).passthrough().describe('Nombre, correo, contraseña, rol y estado válidos son obligatorios.');

const userUpdateSchema = z.object({
  name: optionalField(text(120), 'Nombre inválido.'),
  email: optionalField(email, 'Correo inválido.'),
  password: optionalField(password, 'La contraseña debe tener al menos 6 caracteres.'),
  role_id: optionalField(positiveId, 'Rol inválido.'),
  status: optionalField(z.enum(allowedStatuses.user), 'Estado inválido.'),
}).strict('Proporciona campos válidos para actualizar.')
  .refine((body) => Object.keys(body).length > 0, 'Proporciona campos válidos para actualizar.')
  .describe('Proporciona campos válidos para actualizar.');

const roleName = z.string().refine((value) => /^[A-Za-z][A-Za-z0-9_]{1,49}$/.test(value.trim()));
const roleCreateSchema = z.object({
  name: field(roleName, 'Nombre de rol (2-50 caracteres, letras, números y _) y descripción válidos son obligatorios.'),
  description: optionalField(z.string().max(255), 'Nombre de rol (2-50 caracteres, letras, números y _) y descripción válidos son obligatorios.'),
}).passthrough().describe('Nombre de rol (2-50 caracteres, letras, números y _) y descripción válidos son obligatorios.');
const roleUpdateSchema = z.object({
  name: optionalField(roleName, 'Nombre de rol inválido.'),
  description: optionalField(z.string().max(255), 'Descripción inválida.'),
}).strict('Proporciona un nombre o descripción válidos para actualizar.')
  .refine((body) => Object.keys(body).length > 0, 'Proporciona un nombre o descripción válidos para actualizar.')
  .describe('Proporciona un nombre o descripción válidos para actualizar.');

function validationError(schema, input) {
  const result = schema.safeParse(input);
  if (result.success) return null;
  const issue = result.error.issues.find((item) => item.code === z.ZodIssueCode.unrecognized_keys) || result.error.issues[0];
  if (!issue.path.length) return issue.code === z.ZodIssueCode.invalid_type ? (schema.description || issue.message) : issue.message;
  if (issue.path[0] === 'url' && issue.code === z.ZodIssueCode.custom) return issue.message;
  const objectSchema = schema instanceof z.ZodEffects ? schema.innerType() : schema;
  return objectSchema.shape[issue.path[0]]?.description || issue.message;
}

module.exports = {
  callCreateSchema: callSchema(false),
  callUpdateSchema: callSchema(true),
  contactCreateSchema: contactSchema(false),
  contactUpdateSchema: contactSchema(true),
  recordingCreateSchema: recordingSchema(false),
  recordingUpdateSchema: recordingSchema(true),
  roleCreateSchema,
  roleUpdateSchema,
  userCreateSchema,
  userUpdateSchema,
  validationError,
};
