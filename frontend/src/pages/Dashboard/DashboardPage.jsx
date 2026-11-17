import { useEffect, useState } from 'react';
import api from '../../services/api';

function StatCard({ title, value }) {
  return (
    <div className="card p-5">
      <span className="text-sm text-slate-400">{title}</span>
      <div className="mt-5 text-3xl font-bold text-white">{value}</div>
    </div>
  );
}

function formatDuration(seconds) {
  const numericSeconds = Number(seconds);
  const totalSeconds = Number.isFinite(numericSeconds) ? Math.max(0, Math.round(numericSeconds)) : 0;
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${remainingSeconds}`;
}

function formatDateLabel(date) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day, 12).toLocaleDateString('es', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  });
}

function getErrorMessage(error) {
  return error.response?.data?.message || error.message || 'No se pudieron cargar las estadísticas.';
}

export function DashboardPage() {
  const [summary, setSummary] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setError('');
    setSummary(null);

    async function loadSummary() {
      try {
        const { data } = await api.get('/dashboard/summary');
        if (!data.summary || !Array.isArray(data.summary.callsByDay)) {
          throw new Error('La respuesta del servidor no tiene el formato esperado.');
        }
        if (active) setSummary(data.summary);
      } catch (requestError) {
        if (active) setError(getErrorMessage(requestError));
      } finally {
        if (active) setIsLoading(false);
      }
    }

    loadSummary();
    return () => {
      active = false;
    };
  }, [retryCount]);

  if (isLoading) {
    return <div className="card p-6 text-center text-slate-300" role="status">Cargando estadísticas...</div>;
  }

  if (error) {
    return (
      <div className="card p-6 text-center">
        <p className="text-sm text-rose-200" role="alert">{error}</p>
        <button
          type="button"
          onClick={() => setRetryCount((count) => count + 1)}
          className="mt-4 rounded-xl bg-brand-500 px-4 py-2 font-medium text-white hover:bg-brand-400"
        >
          Reintentar
        </button>
      </div>
    );
  }

  const callsByDay = summary.callsByDay;
  const maxCalls = Math.max(1, ...callsByDay.map((day) => Number(day.totalCalls) || 0));
  const metrics = [
    { title: 'Llamadas totales', value: summary.totalCalls ?? 0 },
    { title: 'Llamadas completadas', value: summary.completedCalls ?? 0 },
    { title: 'Llamadas fallidas', value: summary.failedCalls ?? 0 },
    { title: 'Duración promedio (min:s)', value: formatDuration(summary.averageDurationSeconds ?? 0) },
  ];

  return (
    <div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <StatCard key={metric.title} {...metric} />
        ))}
      </div>

      <div className="mt-6">
        <div className="card p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-lg font-semibold text-white">Volumen de llamadas</h3>
            <div className="flex items-center gap-4 text-xs text-slate-400">
              <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm bg-brand-400" />Totales</span>
              <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-400" />Completadas</span>
              <span>Últimos 7 días</span>
            </div>
          </div>
          <div className="h-72">
            <div className="flex h-full items-end gap-2">
              {callsByDay.map((item) => (
                <div key={item.date} className="flex min-w-0 flex-1 flex-col items-center gap-2">
                  <div className="flex h-full w-full items-end justify-center gap-1">
                    <div
                      className="w-1/2 rounded-t-md bg-brand-400"
                      title={`${item.totalCalls} llamadas totales`}
                      style={{ height: `${(item.totalCalls / maxCalls) * 100}%` }}
                    />
                    <div
                      className="w-1/2 rounded-t-md bg-emerald-400"
                      title={`${item.completedCalls} llamadas completadas`}
                      style={{ height: `${(item.completedCalls / maxCalls) * 100}%` }}
                    />
                  </div>
                  <span className="text-center text-xs text-slate-400">{formatDateLabel(item.date)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
