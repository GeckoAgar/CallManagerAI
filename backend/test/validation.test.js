const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { registerValidation, loginValidation } = require('../src/validators/authValidators');
const {
  callCreateSchema, callUpdateSchema, contactCreateSchema, contactUpdateSchema,
  recordingCreateSchema, recordingUpdateSchema, roleCreateSchema, roleUpdateSchema,
  userCreateSchema, userUpdateSchema, validationError,
} = require('../src/validators/resourceSchemas');
const { parsePagination } = require('../src/utils/pagination');

test('los esquemas de recursos validan creación, actualización y límites', () => {
  const cases = [
    [contactCreateSchema, { name: ' Ana ', company: null, owner_id: '2' }, null],
    [contactCreateSchema, { name: 'Ana', status: 'inactive' }, 'Campos de contacto inválidos.'],
    [contactCreateSchema, { name: '  ' }, 'El nombre del contacto es obligatorio.'],
    [contactUpdateSchema, { email: 'incorrecto' }, 'Correo inválido.'],
    [contactUpdateSchema, { status: 'deleted' }, 'Estado inválido.'],
    [contactUpdateSchema, { name: 'Ana', extra: 1 }, 'Campos de contacto inválidos.'],
    [callCreateSchema, { phone_number: '123', duration_seconds: '0', score: '100' }, null],
    [callCreateSchema, { phone_number: '123', score: 101 }, 'La calificación debe estar entre 0 y 100.'],
    [callUpdateSchema, { duration_seconds: -1 }, 'Duración inválida.'],
    [callUpdateSchema, { contact_id: null }, null],
    [recordingCreateSchema, { call_id: '1', file_name: 'audio', url: 'https://example.test/a' }, null],
    [recordingCreateSchema, { call_id: 0, file_name: 'audio' }, 'La llamada es obligatoria.'],
    [recordingUpdateSchema, { url: 'ftp://example.test/a' }, 'La URL debe usar HTTP o HTTPS.'],
    [recordingUpdateSchema, { url: 'no es una URL' }, 'URL inválida.'],
    [userCreateSchema, { name: 'Ana', email: 'ana@example.test', password: '123456', role_id: 1 }, null],
    [userUpdateSchema, { password: '12345' }, 'La contraseña debe tener al menos 6 caracteres.'],
    [userUpdateSchema, {}, 'Proporciona campos válidos para actualizar.'],
    [roleCreateSchema, { name: ' equipo_1 ', description: 'Equipo' }, null],
    [roleUpdateSchema, { name: '1equipo' }, 'Nombre de rol inválido.'],
    [roleUpdateSchema, { description: null }, 'Descripción inválida.'],
  ];
  for (const [schema, input, expected] of cases) {
    assert.equal(validationError(schema, input), expected, JSON.stringify(input));
  }
});

test('la paginación valida formato, tamaño y rango', () => {
  assert.deepEqual(parsePagination({ page: '2', limit: '25', search: ' texto ' }), {
    page: 2, limit: 25, search: 'texto',
  });
  assert.equal(parsePagination({ page: '0' }).error, 'El parámetro page debe ser un entero positivo.');
  assert.equal(parsePagination({ limit: '11' }).error, 'El parámetro limit debe ser 10, 25 o 50.');
  assert.equal(parsePagination({ page: '9007199254740992' }).error, 'El parámetro page está fuera del rango permitido.');
});

test('autenticación normaliza entradas y devuelve errores de validación', async () => {
  const app = express();
  app.use(express.json());
  app.post('/register', registerValidation, (req, res) => res.json(req.body));
  app.post('/login', loginValidation, (req, res) => res.json(req.body));
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    async function post(url, body) {
      const response = await fetch(`${base}${url}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    }

    const valid = await post('/register', { name: ' Ana ', email: ' ana@example.test ', password: '123456' });
    assert.equal(valid.status, 200);
    assert.equal(valid.body.name, 'Ana');
    assert.equal(valid.body.email, 'ana@example.test');
    const international = await post('/login', { email: ' josé@example.test ', password: '123456' });
    assert.equal(international.status, 200);
    assert.equal(international.body.email, 'josé@example.test');
    const invalid = await post('/register', { name: ' ', email: 'malo', password: '123' });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.message, 'Datos inválidos');
    assert.deepEqual(invalid.body.errors.map((error) => error.path), ['name', 'email', 'password']);
    const login = await post('/login', { email: 'ana@example.test', password: '' });
    assert.equal(login.status, 400);
    assert.equal(login.body.errors[0].msg, 'La contraseña es obligatoria.');
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
