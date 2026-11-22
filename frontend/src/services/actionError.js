export function getActionErrorMessage(error) {
  if (!error.response) return 'No se pudo conectar con el servidor. Inténtalo nuevamente.';
  if (error.response.status >= 500) return 'No se pudo completar la operación. Inténtalo nuevamente.';
  return error.response.data?.message || 'No se pudo completar la operación. Inténtalo nuevamente.';
}
