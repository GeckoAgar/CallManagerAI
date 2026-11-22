import test from 'node:test';
import assert from 'node:assert/strict';
import { useToastStore } from '../src/store/toastStore.js';
import { getActionErrorMessage } from '../src/services/actionError.js';

test('notificaciones simultáneas se cierran y eliminan de forma independiente', () => {
  useToastStore.setState({ toasts: [] });
  const { notify, dismiss, remove } = useToastStore.getState();
  notify('success', 'Guardado');
  notify('success', 'Guardado');
  notify('error', 'Error', { announce: false });

  const [first, second, third] = useToastStore.getState().toasts;
  assert.notEqual(first.id, second.id);
  assert.equal(first.announce, true);
  assert.equal(third.announce, false);
  dismiss(second.id);
  assert.deepEqual(useToastStore.getState().toasts.map((toast) => toast.exiting), [false, true, false]);
  remove(second.id);
  assert.deepEqual(useToastStore.getState().toasts.map((toast) => toast.id), [first.id, third.id]);
  useToastStore.setState({ toasts: [] });
});

test('errores de conexión, servidor y permisos producen mensajes apropiados', () => {
  assert.match(getActionErrorMessage({}), /conectar con el servidor/);
  assert.equal(getActionErrorMessage({ response: { status: 500, data: { message: 'detalle técnico' } } }),
    'No se pudo completar la operación. Inténtalo nuevamente.');
  assert.equal(getActionErrorMessage({ response: { status: 403, data: { message: 'Sin permisos.' } } }), 'Sin permisos.');
});
