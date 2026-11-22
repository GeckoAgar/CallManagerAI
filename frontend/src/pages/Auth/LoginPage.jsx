import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { useToastStore } from '../../store/toastStore';
import api from '../../services/api';
import { getActionErrorMessage } from '../../services/actionError';

export function LoginPage() {
  const navigate = useNavigate();
  const setSession = useAuthStore((state) => state.setSession);
  const notify = useToastStore((state) => state.notify);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const onSubmit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError('');
    setIsSubmitting(true);

    try {
      const { data } = await api.post('/auth/login', {
        email: form.get('email'),
        password: form.get('password'),
      });
      setSession({
        user: data.user,
        token: data.token,
      });
      notify('success', 'Inicio de sesión exitoso.');
      navigate('/');
    } catch (requestError) {
      notify('error', getActionErrorMessage(requestError), { announce: false });
      setError(
        requestError.response?.data?.message ||
        'No se pudo conectar con el servidor. Verifica que la API y MySQL estén disponibles.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-8 sm:px-6">
      <div className="card relative w-full max-w-md overflow-hidden p-6 sm:p-8">
        <div className="absolute inset-x-0 top-0 h-1 bg-brand-500" aria-hidden="true" />
        <div className="mb-8 flex items-center justify-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-brand-500/40 bg-brand-500/10 font-bold tracking-wide text-brand-200">
            CM
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.24em] text-brand-300">Plataforma de operaciones</p>
            <h1 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">CallManagerAI</h1>
          </div>
        </div>
        <div className="mb-6 border-l-2 border-brand-400 pl-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">Acceso de usuario</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight text-white">Iniciar sesión</h2>
        </div>

        <form className="space-y-5" onSubmit={onSubmit} aria-describedby={error ? 'login-error' : undefined}>
          <div>
            <label className="mb-2 block text-sm text-slate-300">Correo</label>
            <input type="email" name="email" autoComplete="email" required className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-white focus:border-brand-400 focus:outline-none" />
          </div>
          <div>
            <label className="mb-2 block text-sm text-slate-300">Contraseña</label>
            <input type="password" name="password" autoComplete="current-password" required className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-white focus:border-brand-400 focus:outline-none" />
          </div>
          {error && <p id="login-error" role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>}
          <button type="submit" disabled={isSubmitting} className="w-full rounded-lg bg-brand-500 px-4 py-3 font-medium text-white hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-60">
            {isSubmitting ? 'Ingresando...' : 'Entrar'}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-slate-400">
          ¿No tienes cuenta? <Link to="/register" className="text-brand-300">Regístrate aquí</Link>
        </p>
      </div>
    </div>
  );
}
