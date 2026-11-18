import { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
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

function formatDateTick(date) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day, 12).toLocaleDateString('es', {
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
    return (
      <div className="card flex items-center justify-center gap-3 p-8 text-slate-300" role="status">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-brand-300" aria-hidden="true" />
        <span className="text-sm">Cargando reportes...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card flex flex-col items-center p-8 text-center sm:p-10">
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300" aria-hidden="true">!</div>
        <p className="max-w-xl text-sm leading-6 text-rose-200" role="alert">{error}</p>
        <button
          type="button"
          onClick={() => setRetryCount((count) => count + 1)}
          className="mt-5 rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300"
        >
          Reintentar
        </button>
      </div>
    );
  }

  const callsByDay = reports.callsByDay;
  const hasCallData = callsByDay.some((day) => Number(day.totalCalls) > 0);
  const metrics = [
    { label: 'Llamadas totales', value: numberFormatter.format(reports.summary.totalCalls ?? 0), tone: 'brand' },
    { label: 'Llamadas completadas', value: numberFormatter.format(reports.summary.completedCalls ?? 0), tone: 'positive' },
    { label: 'Llamadas fallidas', value: numberFormatter.format(reports.summary.failedCalls ?? 0), tone: 'negative' },
    { label: 'Duración promedio (min:s)', value: formatDuration(reports.summary.averageDurationSeconds ?? 0), tone: 'neutral' },
  ];
  const metricToneClasses = {
    brand: 'border-brand-400',
    positive: 'border-emerald-500',
    negative: 'border-rose-500',
    neutral: 'border-slate-600',
  };

  return (
    <div className="min-w-0 space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-brand-300">Operaciones</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">Reportes</h1>
          <p className="mt-1 text-sm text-slate-400">Indicadores de llamadas y actividad por agente.</p>
        </div>
      </header>

      <section className="card p-4 sm:p-6" aria-label="Indicadores de llamadas">
        <div className="mb-4 border-b border-slate-800 pb-3">
          <h2 className="text-sm font-semibold text-white">Resumen de actividad</h2>
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4 xl:gap-8">
          {metrics.map((item) => (
            <div key={item.label} className={`min-w-0 border-l-2 pl-4 ${metricToneClasses[item.tone]}`}>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{item.label}</p>
              <p className="mt-2 break-words text-2xl font-semibold tabular-nums tracking-tight text-white sm:text-3xl">{item.value}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <section className="card min-w-0 overflow-hidden p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 pb-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Tendencia</p>
              <h2 className="mt-1 text-lg font-semibold text-white">Llamadas por día</h2>
            </div>
          </div>
          {hasCallData ? (
            <div className="h-64 border-t border-slate-800 pt-5 sm:h-72" role="img" aria-label="Gráfico de llamadas totales, completadas y fallidas por día durante los últimos siete días">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={callsByDay} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid stroke="#3b3c35" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={formatDateTick}
                    tick={{ fill: '#aaa89e', fontSize: 10 }}
                    tickLine={false}
                    axisLine={{ stroke: '#3b3c35' }}
                    minTickGap={8}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fill: '#aaa89e', fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    width={34}
                  />
                  <Tooltip
                    labelFormatter={formatDateLabel}
                    formatter={(value, name) => [value, name]}
                    contentStyle={{ backgroundColor: '#22231f', border: '1px solid #3b3c35', borderRadius: 8 }}
                    labelStyle={{ color: '#f4f1e8', marginBottom: 4 }}
                    itemStyle={{ color: '#d6d3c9', fontSize: 12 }}
                    cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                  />
                  <Legend
                    formatter={(value) => <span className="text-xs text-slate-400">{value}</span>}
                    iconType="circle"
                    iconSize={8}
                    wrapperStyle={{ paddingTop: 12 }}
                  />
                  <Bar dataKey="totalCalls" name="Totales" fill="#fbbf24" radius={[3, 3, 0, 0]} maxBarSize={28} />
                  <Bar dataKey="completedCalls" name="Completadas" fill="#34d399" radius={[3, 3, 0, 0]} maxBarSize={28} />
                  <Bar dataKey="failedCalls" name="Fallidas" fill="#fb7185" radius={[3, 3, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-slate-700 px-4 py-12 text-center">
              <p className="font-medium text-slate-300">No hay datos diarios para mostrar.</p>
            </div>
          )}
        </section>

        <section className="card min-w-0 overflow-hidden p-4 sm:p-5">
          <div className="mb-4 border-b border-slate-800 pb-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Rendimiento</p>
            <h2 className="mt-1 text-lg font-semibold text-white">Estadísticas por agente</h2>
          </div>
          {reports.agents.length ? (
            <div className="overflow-x-auto">
              <table className="min-w-[640px] w-full text-left text-sm">
                <thead className="bg-slate-950/70 text-[11px] uppercase tracking-wide text-slate-400">
                  <tr>
                    <th scope="col" className="whitespace-nowrap px-4 py-3 font-semibold">Agente</th>
                    <th scope="col" className="whitespace-nowrap px-4 py-3 text-right font-semibold">Total</th>
                    <th scope="col" className="whitespace-nowrap px-4 py-3 text-right font-semibold">Completadas</th>
                    <th scope="col" className="whitespace-nowrap px-4 py-3 text-right font-semibold">Fallidas</th>
                    <th scope="col" className="whitespace-nowrap px-4 py-3 text-right font-semibold">Promedio</th>
                  </tr>
                </thead>
                <tbody className="text-slate-200">
                  {reports.agents.map((agent) => (
                    <tr key={agent.agentId} className="border-t border-slate-800/80 transition-colors hover:bg-slate-800/30">
                      <td className="whitespace-nowrap px-4 py-3.5 font-medium text-white">{agent.agentName}</td>
                      <td className="px-4 py-3.5 text-right tabular-nums">{numberFormatter.format(agent.totalCalls ?? 0)}</td>
                      <td className="px-4 py-3.5 text-right tabular-nums text-emerald-300">{numberFormatter.format(agent.completedCalls ?? 0)}</td>
                      <td className="px-4 py-3.5 text-right tabular-nums text-rose-300">{numberFormatter.format(agent.failedCalls ?? 0)}</td>
                      <td className="whitespace-nowrap px-4 py-3.5 text-right tabular-nums text-slate-300">{formatDuration(agent.averageDurationSeconds ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-slate-700 px-4 py-10 text-center">
              <p className="font-medium text-slate-300">No hay agentes con llamadas registradas.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
