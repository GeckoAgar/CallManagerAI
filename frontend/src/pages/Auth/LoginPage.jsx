import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import api from '../../services/api';

export function LoginPage() {
  const navigate = useNavigate();
  const setSession = useAuthStore((state) => state.setSession);
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
      navigate('/');
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
        'No se pudo conectar con el servidor. Verifica que la API y MySQL estén disponibles.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-6">
      <div className="card w-full max-w-md p-8">
        <div className="mb-6 text-center">
          <p className="text-xs uppercase tracking-[0.3em] text-brand-300">CallManagerAI</p>
          <h1 className="mt-3 text-3xl font-bold text-white">Iniciar sesión</h1>
        </div>

        <form className="space-y-4" onSubmit={onSubmit}>
          <div>
            <label className="mb-2 block text-sm text-slate-300">Correo</label>
            <input type="email" name="email" autoComplete="email" required className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-white focus:border-brand-400 focus:outline-none" />
          </div>
          <div>
            <label className="mb-2 block text-sm text-slate-300">Contraseña</label>
            <input type="password" name="password" autoComplete="current-password" required className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-white focus:border-brand-400 focus:outline-none" />
          </div>
          {error && <p role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>}
          <button type="submit" disabled={isSubmitting} className="w-full rounded-xl bg-brand-500 px-4 py-3 font-medium text-white hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-60">
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
