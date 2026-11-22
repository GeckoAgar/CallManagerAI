import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDuration } from '../src/pages/Dashboard/formatDuration.js';

test('la duración para el eje y el tooltip se expresa en minutos y segundos', () => {
  assert.equal(formatDuration(5), '0:05');
  assert.equal(formatDuration(60.5), '1:01');
  assert.equal(formatDuration(125), '2:05');
  assert.equal(formatDuration(3600), '60:00');
});
