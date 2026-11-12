import { CrudManager } from '../../components/common/CrudManager';

const columns = [
  { key: 'id', label: 'ID' },
  { key: 'name', label: 'Nombre' },
  { key: 'description', label: 'Descripción' },
];

const fields = [
  { name: 'name', label: 'Nombre del rol', required: true, minLength: 2, maxLength: 50 },
  { name: 'description', label: 'Descripción', type: 'textarea', maxLength: 255, optional: true },
];

export function RolesPage() {
  return (
    <CrudManager
      title="Gestión de roles"
      resource="/roles"
      collection="roles"
      columns={columns}
      fields={fields}
      description="ADMIN y USER son roles del sistema: no se pueden renombrar ni eliminar. Los roles asignados no se pueden borrar."
    />
  );
}
