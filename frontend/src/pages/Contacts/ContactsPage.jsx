import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { CrudManager } from '../../components/common/CrudManager';

const columns = [
  { key: 'id', label: 'ID' },
  { key: 'name', label: 'Nombre', type: 'primary' },
  { key: 'company', label: 'Empresa', type: 'truncate' },
  { key: 'phone', label: 'Teléfono', type: 'monospace' },
  { key: 'email', label: 'Correo', type: 'truncate' },
  { key: 'owner_name', label: 'Propietario', type: 'truncate' },
  { key: 'status', label: 'Estado', type: 'status' },
];

const fields = [
  { name: 'name', label: 'Nombre', required: true, maxLength: 120 },
  { name: 'company', label: 'Empresa', maxLength: 120, optional: true },
  { name: 'phone', label: 'Teléfono', maxLength: 30, optional: true },
  { name: 'email', label: 'Correo', type: 'email', maxLength: 150, optional: true },
  { name: 'owner_id', label: 'Propietario', type: 'select', optional: true, adminOnly: true, optionsEndpoint: '/users', optionsCollection: 'users', labelKey: 'name' },
  { name: 'status', label: 'Estado', type: 'select', required: true, editOnly: true, options: [
    { id: 'active', name: 'Activo' },
    { id: 'inactive', name: 'Inactivo' },
  ] },
];

export function ContactsPage() {
  const location = useLocation();
  const isAdmin = useAuthStore((state) => state.user?.roleName === 'ADMIN');
  const [showDeleted, setShowDeleted] = useState(false);
  const viewingDeleted = isAdmin && showDeleted;
  const visibleColumns = isAdmin ? columns : columns.filter((column) => column.key !== 'owner_name');

  useEffect(() => {
    if (new URLSearchParams(location.search).has('highlight')) setShowDeleted(false);
  }, [location.key, location.search]);

  return (
    <div className="space-y-4">
      {isAdmin && (
        <div className="flex flex-wrap gap-2" aria-label="Vista de contactos">
          <button type="button" onClick={() => setShowDeleted(false)} aria-pressed={!viewingDeleted} className={`rounded-lg border px-4 py-2 text-sm ${!viewingDeleted ? 'border-brand-500 bg-brand-500/15 text-brand-200' : 'border-slate-700 text-slate-300'}`}>
            Contactos
          </button>
          <button type="button" onClick={() => setShowDeleted(true)} aria-pressed={viewingDeleted} className={`rounded-lg border px-4 py-2 text-sm ${viewingDeleted ? 'border-brand-500 bg-brand-500/15 text-brand-200' : 'border-slate-700 text-slate-300'}`}>
            Contactos eliminados
          </button>
        </div>
      )}
      <CrudManager
        key={viewingDeleted ? 'deleted' : 'current'}
        title={viewingDeleted ? 'Contactos eliminados' : 'Contactos'}
        resource="/contacts"
        collection="contacts"
        columns={viewingDeleted ? [...visibleColumns, { key: 'deleted_at', label: 'Eliminado', type: 'date' }] : visibleColumns}
        fields={fields}
        softDelete
        showDeleted={viewingDeleted}
        searchPlaceholder="Buscar por nombre, empresa, teléfono o correo..."
        description={viewingDeleted ? 'Solo ADMIN puede consultar y restaurar contactos eliminados. Sus llamadas y datos se conservan.' : isAdmin ? 'ADMIN puede gestionar todos los contactos y asignar un propietario; USER solo administra sus contactos.' : 'Los contactos que crees quedan asociados a tu cuenta.'}
      />
    </div>
  );
}
