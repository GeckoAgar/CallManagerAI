import { useAuthStore } from '../../store/authStore';
import { CrudManager } from '../../components/common/CrudManager';

const columns = [
  { key: 'id', label: 'ID' },
  { key: 'name', label: 'Nombre' },
  { key: 'company', label: 'Empresa' },
  { key: 'phone', label: 'Teléfono' },
  { key: 'email', label: 'Correo' },
  { key: 'owner_name', label: 'Propietario' },
  { key: 'status', label: 'Estado', type: 'status' },
];

const fields = [
  { name: 'name', label: 'Nombre', required: true, maxLength: 120 },
  { name: 'company', label: 'Empresa', maxLength: 120, optional: true },
  { name: 'phone', label: 'Teléfono', maxLength: 30, optional: true },
  { name: 'email', label: 'Correo', type: 'email', maxLength: 150, optional: true },
  { name: 'owner_id', label: 'Propietario', type: 'select', optional: true, adminOnly: true, optionsEndpoint: '/users', optionsCollection: 'users', labelKey: 'name' },
  { name: 'status', label: 'Estado', type: 'select', required: true, defaultValue: 'active', options: [
    { id: 'active', name: 'Activo' },
    { id: 'inactive', name: 'Inactivo' },
  ] },
];

export function ContactsPage() {
  const isAdmin = useAuthStore((state) => state.user?.roleName === 'ADMIN');
  const visibleColumns = isAdmin ? columns : columns.filter((column) => column.key !== 'owner_name');

  return (
    <CrudManager
      title="Contactos"
      resource="/contacts"
      collection="contacts"
      columns={visibleColumns}
      fields={fields}
      description={isAdmin ? 'ADMIN puede gestionar todos los contactos y asignar un propietario; USER solo administra sus contactos.' : 'Los contactos que crees quedan asociados a tu cuenta.'}
    />
  );
}
