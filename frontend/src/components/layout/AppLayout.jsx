import { useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { BriefcaseBusiness, FileText, Headphones, LayoutDashboard, LogOut, Phone, PhoneCall, Settings, ShieldCheck, Users, Volume2 } from 'lucide-react';
import api from '../../services/api';
import { getActionErrorMessage } from '../../services/actionError';
import { useAuthStore } from '../../store/authStore';
import { useToastStore } from '../../store/toastStore';
import { useUiPreferencesStore } from '../../store/uiPreferencesStore';
import { GlobalSearch } from './GlobalSearch';
import { NotificationCenter } from './NotificationCenter';

const navigation = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/users', label: 'Usuarios', icon: Users },
  { to: '/roles', label: 'Roles', icon: ShieldCheck },
  { to: '/contacts', label: 'Contactos', icon: BriefcaseBusiness },
  { to: '/softphone', label: 'Softphone', icon: PhoneCall },
  { to: '/calls', label: 'Llamadas', icon: Phone },
  { to: '/recordings', label: 'Grabaciones', icon: Volume2 },
  { to: '/supervision', label: 'Supervisión', icon: Headphones },
  { to: '/reports', label: 'Reportes', icon: FileText },
  { to: '/settings', label: 'Configuración', icon: Settings },
];

export function AppLayout({ children }) {
  const logout = useAuthStore((state) => state.logout);
  const notify = useToastStore((state) => state.notify);
  const user = useAuthStore((state) => state.user);
  const textSize = useUiPreferencesStore((state) => state.textSize);
  const [logoutError, setLogoutError] = useState('');
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const visibleNavigation = user?.roleName === 'ADMIN'
    ? navigation
    : navigation.filter((item) => item.to !== '/roles' && item.to !== '/supervision');

  useEffect(() => {
    const previousFontSize = document.documentElement.style.fontSize;
    document.documentElement.style.fontSize = textSize === 'large' ? '18px' : '16px';
    return () => {
      document.documentElement.style.fontSize = previousFontSize;
    };
  }, [textSize]);

  async function handleLogout() {
    if (isLoggingOut) return;
    setLogoutError('');
    setIsLoggingOut(true);
    try {
      await api.post('/auth/logout');
      logout();
      notify('success', 'Sesión cerrada correctamente.');
    } catch (requestError) {
      notify('error', getActionErrorMessage(requestError), { announce: false });
      setLogoutError(requestError.response?.data?.message || requestError.message || 'No se pudo cerrar la sesión.');
    } finally {
      setIsLoggingOut(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100 lg:flex-row">
      <aside className="sidebar w-full shrink-0 border-b border-slate-800 px-4 py-4 lg:w-64 lg:border-b-0 lg:border-r lg:px-5 lg:py-6">
        <div className="mb-4 flex items-center gap-3 lg:mb-8 lg:px-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-500/20 text-brand-300">C</div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.35em] text-slate-400">Sistema</p>
            <h1 className="text-xl font-bold text-white">CallManagerAI</h1>
          </div>
        </div>

        <nav aria-label="Navegación principal" className="flex gap-2 overflow-x-auto pb-1 lg:block lg:space-y-1 lg:overflow-visible lg:pb-0">
          {visibleNavigation.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex shrink-0 items-center gap-3 rounded-lg border-l-2 px-3 py-2.5 text-sm transition-colors ${
                  isActive
                    ? 'border-brand-400 bg-brand-500/10 text-brand-200'
                    : 'border-transparent text-slate-300 hover:bg-slate-800 hover:text-white'
                }`
              }
            >
              <Icon size={18} aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="relative z-30 flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 bg-slate-950/80 px-4 py-4 backdrop-blur sm:px-6 lg:flex-nowrap">
          <div>
            <p className="text-[10px] uppercase tracking-[0.32em] text-brand-300">Operaciones</p>
            <h2 className="text-lg font-semibold text-white">Centro de control</h2>
          </div>

          <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto sm:flex-1 sm:justify-end sm:gap-3">
            <GlobalSearch />
            <NotificationCenter key={user?.id} />
            <button
              onClick={handleLogout}
              disabled={isLoggingOut}
              className="flex shrink-0 items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200 hover:text-white disabled:cursor-wait disabled:opacity-60"
            >
              <LogOut size={16} />
              {isLoggingOut ? 'Cerrando sesión...' : 'Cerrar sesión'}
            </button>
          </div>
          {logoutError && <p className="absolute right-6 top-16 z-10 rounded-lg border border-rose-500/30 bg-slate-900 px-3 py-2 text-sm text-rose-200" role="alert">{logoutError}</p>}
        </header>

        <main className="p-4 sm:p-6">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/70 p-3 sm:p-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-brand-500/30 bg-brand-500/10 font-semibold text-brand-200">
                {user?.name?.trim()?.charAt(0).toUpperCase() || 'U'}
              </div>
              <div className="min-w-0">
                <p className="text-xs text-slate-400">Usuario activo</p>
                <p className="truncate text-base font-semibold text-white">{user?.name || 'Administrador'}</p>
              </div>
              {user?.roleName && (
                <span className="rounded-full border border-brand-500/30 bg-brand-500/10 px-2.5 py-1 text-[10px] font-semibold tracking-wide text-brand-200">
                  {user.roleName}
                </span>
              )}
            </div>
            <Link to="/settings" className="shrink-0 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 transition-colors hover:border-brand-500/50 hover:text-white">
              Ajustes
            </Link>
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
