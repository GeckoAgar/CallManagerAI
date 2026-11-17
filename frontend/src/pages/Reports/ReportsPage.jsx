import { useEffect, useState } from 'react';
import api from '../../services/api';

const numberFormatter = new Intl.NumberFormat('es-AR');

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
  return error.response?.data?.message || error.message || 'No se pudieron cargar los reportes.';
}

export function ReportsPage() {
  const [reports, setReports] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setError('');
    setReports(null);

    async function loadReports() {
      try {
        const [summaryResponse, callsByDayResponse, agentsResponse] = await Promise.all([
          api.get('/reports/summary'),
          api.get('/reports/calls-by-day'),
          api.get('/reports/by-agent'),
        ]);
        if (!summaryResponse.data.summary ||
            !Array.isArray(callsByDayResponse.data.callsByDay) ||
            !Array.isArray(agentsResponse.data.agents)) {
          throw new Error('La respuesta del servidor no tiene el formato esperado.');
        }
        if (active) {
          setReports({
            summary: summaryResponse.data.summary,
            callsByDay: callsByDayResponse.data.callsByDay,
            agents: agentsResponse.data.agents,
          });
        }
      } catch (requestError) {
        if (active) setError(getErrorMessage(requestError));
      } finally {
        if (active) setIsLoading(false);
      }
    }

    loadReports();
    return () => {
      active = false;
    };
  }, [retryCount]);

  if (isLoading) {
    return <div className="card p-6 text-center text-slate-300" role="status">Cargando reportes...</div>;
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

  const callsByDay = reports.callsByDay;
  const maxCalls = Math.max(1, ...callsByDay.map((day) => Number(day.totalCalls) || 0));
  const metrics = [
    { label: 'Llamadas totales', value: numberFormatter.format(reports.summary.totalCalls ?? 0) },
    { label: 'Llamadas completadas', value: numberFormatter.format(reports.summary.completedCalls ?? 0) },
    { label: 'Llamadas fallidas', value: numberFormatter.format(reports.summary.failedCalls ?? 0) },
    { label: 'Duración promedio (min:s)', value: formatDuration(reports.summary.averageDurationSeconds ?? 0) },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((item) => (
          <div key={item.label} className="card p-5">
            <p className="text-sm text-slate-400">{item.label}</p>
            <p className="mt-3 text-3xl font-bold text-white">{item.value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <section className="card p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-lg font-semibold text-white">Llamadas por día</h3>
            <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400">
              <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm bg-brand-400" />Totales</span>
              <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-400" />Completadas</span>
              <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm bg-rose-400" />Fallidas</span>
            </div>
          </div>
          <div className="h-72">
            <div className="flex h-full items-end gap-2">
              {callsByDay.map((item) => (
                <div key={item.date} className="flex min-w-0 flex-1 flex-col items-center gap-2">
                  <div className="flex h-full w-full items-end justify-center gap-1">
                    <div className="w-1/3 rounded-t-md bg-brand-400" title={`${item.totalCalls} llamadas totales`} style={{ height: `${(item.totalCalls / maxCalls) * 100}%` }} />
                    <div className="w-1/3 rounded-t-md bg-emerald-400" title={`${item.completedCalls} llamadas completadas`} style={{ height: `${(item.completedCalls / maxCalls) * 100}%` }} />
                    <div className="w-1/3 rounded-t-md bg-rose-400" title={`${item.failedCalls} llamadas fallidas`} style={{ height: `${(item.failedCalls / maxCalls) * 100}%` }} />
                  </div>
                  <span className="text-center text-xs text-slate-400">{formatDateLabel(item.date)}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="card p-5">
          <h3 className="mb-4 text-lg font-semibold text-white">Estadísticas por agente</h3>
          {reports.agents.length ? (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="text-xs uppercase text-slate-400">
                  <tr>
                    <th className="px-3 py-2 font-medium">Agente</th>
                    <th className="px-3 py-2 font-medium">Total</th>
                    <th className="px-3 py-2 font-medium">Completadas</th>
                    <th className="px-3 py-2 font-medium">Fallidas</th>
                    <th className="px-3 py-2 font-medium">Promedio</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 text-slate-200">
                  {reports.agents.map((agent) => (
                    <tr key={agent.agentId}>
                      <td className="whitespace-nowrap px-3 py-3">{agent.agentName}</td>
                      <td className="px-3 py-3">{numberFormatter.format(agent.totalCalls ?? 0)}</td>
                      <td className="px-3 py-3">{numberFormatter.format(agent.completedCalls ?? 0)}</td>
                      <td className="px-3 py-3">{numberFormatter.format(agent.failedCalls ?? 0)}</td>
                      <td className="whitespace-nowrap px-3 py-3">{formatDuration(agent.averageDurationSeconds ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="rounded-xl border border-dashed border-slate-700 px-4 py-10 text-center text-sm text-slate-400">
              No hay agentes con llamadas registradas.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
