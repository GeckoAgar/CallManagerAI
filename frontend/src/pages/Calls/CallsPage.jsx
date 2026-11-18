import { useAuthStore } from '../../store/authStore';
import { CrudManager } from '../../components/common/CrudManager';

const columns = [
  { key: 'id', label: 'ID' },
  { key: 'phone_number', label: 'Número', type: 'monospace' },
  { key: 'direction', label: 'Dirección', type: 'direction' },
  { key: 'contact_name', label: 'Contacto', type: 'truncate' },
  { key: 'agent_name', label: 'Asesor', type: 'truncate' },
  { key: 'duration_seconds', label: 'Duración (s)', type: 'number' },
  { key: 'score', label: 'Calificación', type: 'number' },
  { key: 'status', label: 'Estado', type: 'status' },
];

const fields = [
  { name: 'phone_number', label: 'Número telefónico', required: true, maxLength: 30 },
  { name: 'contact_id', label: 'Contacto', type: 'select', optional: true, optionsEndpoint: '/contacts', optionsCollection: 'contacts' },
  { name: 'agent_id', label: 'Asesor', type: 'select', optional: true, adminOnly: true, optionsEndpoint: '/users', optionsCollection: 'users' },
  { name: 'direction', label: 'Dirección', type: 'select', required: true, defaultValue: 'inbound', options: [
    { id: 'inbound', name: 'Entrante' },
    { id: 'outbound', name: 'Saliente' },
  ] },
  { name: 'status', label: 'Estado', type: 'select', required: true, defaultValue: 'queued', options: [
    { id: 'queued', name: 'En cola' },
    { id: 'active', name: 'Activa' },
    { id: 'completed', name: 'Completada' },
    { id: 'failed', name: 'Fallida' },
  ] },
  { name: 'duration_seconds', label: 'Duración (segundos)', type: 'number', min: 0, step: 1, defaultValue: 0 },
  { name: 'score', label: 'Calificación (0-100)', type: 'number', min: 0, max: 100, step: 0.01, defaultValue: 0 },
];

export function CallsPage() {
  const isAdmin = useAuthStore((state) => state.user?.roleName === 'ADMIN');
  const visibleColumns = isAdmin ? columns : columns.filter((column) => column.key !== 'agent_name');

  return (
    <CrudManager
      title="Gestión de llamadas"
      resource="/calls"
      collection="calls"
      columns={visibleColumns}
      fields={fields}
      searchPlaceholder="Buscar por teléfono, contacto o agente..."
      description={isAdmin ? 'ADMIN puede gestionar las llamadas del equipo; las eliminaciones relacionadas se rechazan para preservar grabaciones y supervisión.' : 'Solo puedes gestionar las llamadas asignadas a tu cuenta.'}
    />
  );
}
