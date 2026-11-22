import { useEffect, useState } from 'react';
import { Bell, CheckCircle2, CircleAlert, Monitor, RefreshCw, Server, Shield, UserRound } from 'lucide-react';
import { StatusBadge } from '../../components/common/StatusBadge';
import api from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { useUiPreferencesStore } from '../../store/uiPreferencesStore';

function formatTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function SectionHeading({ icon: Icon, eyebrow, title, description }) {
  return (
    <div className="mb-5 flex items-start gap-3 border-b border-slate-800 pb-4">
      <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-brand-500/30 bg-brand-500/10 text-brand-200">
        <Icon size={18} aria-hidden="true" />
      </div>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{eyebrow}</p>
        <h2 className="mt-1 text-base font-semibold text-white">{title}</h2>
        <p className="mt-1 text-sm leading-5 text-slate-400">{description}</p>
      </div>
    </div>
  );
}

export function SettingsPage() {
  const user = useAuthStore((state) => state.user);
  const isAdmin = user?.roleName === 'ADMIN';
  const textSize = useUiPreferencesStore((state) => state.textSize);
  const setTextSize = useUiPreferencesStore((state) => state.setTextSize);
  const [healthAttempt, setHealthAttempt] = useState(0);
  const [health, setHealth] = useState(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState('');

  useEffect(() => {
    if (!isAdmin) return undefined;

    let active = true;
    setHealthLoading(true);
    setHealthError('');

    api.get('/health')
      .then(({ data }) => {
        if (!data?.ok) throw new Error('El backend no confirmó su estado de salud.');
        if (active) setHealth(data);
      })
      .catch((requestError) => {
        if (active) {
          setHealth(null);
          setHealthError(requestError.response?.data?.message || requestError.message || 'No se pudo consultar el backend.');
        }
      })
      .finally(() => {
        if (active) setHealthLoading(false);
      });

    return () => {
      active = false;
    };
  }, [healthAttempt, isAdmin]);

  const normalizedTextSize = textSize === 'large' ? 'large' : 'standard';
  const healthTimestamp = health?.timestamp ? formatTimestamp(health.timestamp) : null;

  return (
    <div className="min-w-0 space-y-5">
      <header>
        <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-brand-300">Cuenta y preferencias</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">Configuración</h1>
        <p className="mt-1 text-sm text-slate-400">Administra tu perfil y las preferencias disponibles para esta interfaz.</p>
      </header>

      <div className="grid min-w-0 gap-5 xl:grid-cols-2">
        <section className="card min-w-0 p-4 sm:p-5">
          <SectionHeading
            icon={UserRound}
            eyebrow="Cuenta"
            title="Perfil"
            description="Datos de la sesión autenticada."
          />
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Nombre</dt>
              <dd className="mt-1 break-words text-sm font-medium text-white">{user?.name || 'No disponible'}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Correo</dt>
              <dd className="mt-1 break-all text-sm font-medium text-white">{user?.email || 'No disponible'}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Rol</dt>
              <dd className="mt-2 text-sm text-white">{user?.roleName || 'No disponible'}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Estado de cuenta</dt>
              <dd className="mt-2">
                {user?.status ? <StatusBadge status={user.status} /> : <span className="text-sm text-slate-400">No disponible</span>}
              </dd>
            </div>
          </dl>
        </section>

        <section className="card min-w-0 p-4 sm:p-5">
          <SectionHeading
            icon={Shield}
            eyebrow="Acceso"
            title="Seguridad"
            description="La contraseña nunca se muestra ni se conserva en esta página."
          />
          <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-4">
            <p className="text-sm font-medium text-amber-100">Cambio de contraseña no disponible</p>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              El backend no ofrece un flujo de cambio propio que verifique la contraseña actual. Por seguridad, no se envía ni se simula un cambio desde aquí.
            </p>
          </div>
        </section>
      </div>

      <section className="card min-w-0 p-4 sm:p-5">
        <SectionHeading
          icon={Monitor}
          eyebrow="Preferencias personales"
          title="Interfaz"
          description="El tamaño seleccionado se aplica a la interfaz y se guarda en este navegador."
        />
        <div className="max-w-xl">
          <label htmlFor="settings-text-size" className="mb-2 block text-sm font-medium text-slate-200">
            Tamaño de interfaz
          </label>
          <select
            id="settings-text-size"
            value={normalizedTextSize}
            onChange={(event) => setTextSize(event.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white focus:border-brand-400 focus:outline-none sm:max-w-sm"
          >
            <option value="standard">Estándar</option>
            <option value="large">Grande</option>
          </select>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            Esta preferencia se mantiene separada de la sesión y no modifica autenticación ni permisos.
          </p>
        </div>
      </section>

      <section className="card min-w-0 p-4 sm:p-5">
        <SectionHeading
          icon={Bell}
          eyebrow="Preferencias personales"
          title="Notificaciones"
          description="Opciones disponibles para tu cuenta."
        />
        <p className="rounded-lg border border-dashed border-slate-700 px-4 py-5 text-sm leading-6 text-slate-400">
          Los avisos temporales aparecen automáticamente. Consulta y administra el historial de eventos desde la campana de la barra superior. No hay opciones de notificación configurables.
        </p>
      </section>

      {isAdmin && (
        <section className="card min-w-0 p-4 sm:p-5">
          <SectionHeading
            icon={Server}
            eyebrow="Solo ADMIN"
            title="Estado del sistema"
            description="Estado obtenido del endpoint de salud del backend."
          />
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0" aria-live="polite">
              {healthLoading ? (
                <p className="text-sm text-slate-300" role="status">Consultando el backend...</p>
              ) : health ? (
                <>
                  <p className="flex items-center gap-2 text-sm font-medium text-emerald-200">
                    <CheckCircle2 size={17} aria-hidden="true" />
                    Backend conectado
                  </p>
                  {health.service && <p className="mt-1 text-xs text-slate-400">{health.service}</p>}
                  {healthTimestamp && <p className="mt-1 text-xs text-slate-500">Respuesta: {healthTimestamp}</p>}
                </>
              ) : (
                <>
                  <p className="flex items-center gap-2 text-sm font-medium text-rose-200">
                    <CircleAlert size={17} aria-hidden="true" />
                    Backend no disponible
                  </p>
                  <p className="mt-1 text-xs text-slate-400">{healthError || 'No se pudo consultar el backend.'}</p>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={() => setHealthAttempt((attempt) => attempt + 1)}
              disabled={healthLoading}
              className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-medium text-slate-200 transition-colors hover:border-brand-500/50 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300"
            >
              <RefreshCw size={15} className={healthLoading ? 'animate-spin' : ''} aria-hidden="true" />
              Actualizar
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
