import { useEffect, useState } from 'react';
import { CrudManager } from '../../components/common/CrudManager';
import { StatusBadge } from '../../components/common/StatusBadge';
import api from '../../services/api';
import { useAuthStore } from '../../store/authStore';

const columns = [
  { key: 'id', label: 'ID' },
  { key: 'name', label: 'Nombre' },
  { key: 'email', label: 'Correo' },
  { key: 'role_name', label: 'Rol' },
  { key: 'status', label: 'Estado', type: 'status' },
  { key: 'created_at', label: 'Creado', type: 'date' },
];

const fields = [
  { name: 'name', label: 'Nombre', required: true, minLength: 2, maxLength: 120 },
  { name: 'email', label: 'Correo', type: 'email', required: true, maxLength: 150 },
  { name: 'password', label: 'Contraseña', type: 'password', required: true, minLength: 6 },
  { name: 'role_id', label: 'Rol', type: 'select', required: true, optionsEndpoint: '/roles', optionsCollection: 'roles', adminOnly: true },
  { name: 'status', label: 'Estado', type: 'select', required: true, options: [
    { id: 'active', name: 'Activo' },
    { id: 'inactive', name: 'Inactivo' },
    { id: 'blocked', name: 'Bloqueado' },
  ], defaultValue: 'active' },
];

export function UsersPage() {
  const user = useAuthStore((state) => state.user);
  const isAdmin = user?.roleName === 'ADMIN';
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(!isAdmin);

  useEffect(() => {
    if (isAdmin || !user?.id) return undefined;
    let active = true;
    api.get(`/users/${user.id}`)
      .then(({ data }) => { if (active) setProfile(data.user); })
      .catch((requestError) => {
        if (active) setError(requestError.response?.data?.message || 'No se pudo cargar tu perfil.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [isAdmin, user?.id]);

  if (!isAdmin) {
    return (
      <section className="card max-w-2xl p-6">
        <h3 className="text-lg font-semibold text-white">Mi perfil</h3>
        {loading && <p className="mt-4 text-sm text-slate-400">Cargando...</p>}
        {error && <p role="alert" className="mt-4 text-sm text-rose-300">{error}</p>}
        {profile && (
          <dl className="mt-5 grid gap-4 sm:grid-cols-2">
            <div><dt className="text-sm text-slate-400">Nombre</dt><dd className="mt-1 text-white">{profile.name}</dd></div>
            <div><dt className="text-sm text-slate-400">Correo</dt><dd className="mt-1 text-white">{profile.email}</dd></div>
            <div><dt className="text-sm text-slate-400">Rol</dt><dd className="mt-1 text-white">{profile.role_name}</dd></div>
            <div><dt className="text-sm text-slate-400">Estado</dt><dd className="mt-1"><StatusBadge status={profile.status} /></dd></div>
          </dl>
        )}
      </section>
    );
  }

  return (
    <CrudManager
      title="Gestión de usuarios"
      resource="/users"
      collection="users"
      columns={columns}
      fields={fields}
      description="Los cambios de rol y estado se validan en el servidor. No se puede eliminar ni desactivar al último administrador activo."
    />
  );
}
