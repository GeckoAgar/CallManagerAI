import { useEffect, useState } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import api from './services/api';
import { LoginPage } from './pages/Auth/LoginPage';
import { RegisterPage } from './pages/Auth/RegisterPage';
import { DashboardPage } from './pages/Dashboard/DashboardPage';
import { UsersPage } from './pages/Users/UsersPage';
import { RolesPage } from './pages/Roles/RolesPage';
import { ContactsPage } from './pages/Contacts/ContactsPage';
import { CallsPage } from './pages/Calls/CallsPage';
import { RecordingsPage } from './pages/Recordings/RecordingsPage';
import { SupervisionPage } from './pages/Supervision/SupervisionPage';
import { ReportsPage } from './pages/Reports/ReportsPage';
import { SettingsPage } from './pages/Settings/SettingsPage';
import { SoftphonePage } from './pages/Softphone/SoftphonePage';
import { AppLayout } from './components/layout/AppLayout';

function ProtectedRoute() {
  const token = useAuthStore((state) => state.token);
  return token ? <AppLayout><Outlet /></AppLayout> : <Navigate to="/login" replace />;
}

function AdminRoute() {
  const roleName = useAuthStore((state) => state.user?.roleName);
  return roleName === 'ADMIN' ? <Outlet /> : <Navigate to="/users" replace />;
}

export default function App() {
  const token = useAuthStore((state) => state.token);
  const setUser = useAuthStore((state) => state.setUser);
  const logout = useAuthStore((state) => state.logout);
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    let active = true;
    setSessionReady(false);

    async function restoreSession() {
      if (!token) {
        if (active) setSessionReady(true);
        return;
      }

      try {
        const { data } = await api.get('/auth/me');
        if (active) setUser(data.user);
      } catch {
        if (active) logout();
      } finally {
        if (active) setSessionReady(true);
      }
    }

    restoreSession();
    return () => {
      active = false;
    };
  }, [token, setUser, logout]);

  if (!sessionReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-300">
        Verificando sesión...
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/contacts" element={<ContactsPage />} />
        <Route path="/calls" element={<CallsPage />} />
        <Route path="/softphone" element={<SoftphonePage />} />
        <Route path="/recordings" element={<RecordingsPage />} />
        <Route path="/supervision" element={<SupervisionPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route element={<AdminRoute />}>
          <Route path="/roles" element={<RolesPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
