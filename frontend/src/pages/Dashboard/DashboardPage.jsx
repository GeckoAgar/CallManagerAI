import { useEffect, useState } from 'react';
import {
  Area,
  AreaChart,
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
import { formatDuration } from './formatDuration';

function Metric({ title, value, tone }) {
  const toneClasses = {
    brand: 'border-brand-400',
    positive: 'border-emerald-400',
    negative: 'border-rose-400',
    neutral: 'border-slate-600',
  };

  return (
    <div className={`min-w-0 border-l-2 pl-4 ${toneClasses[tone]}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{title}</p>
      <p className="mt-3 break-words text-3xl font-semibold tracking-tight text-white">{value}</p>
    </div>
  );
}

function formatDateLabel(date) {
  const [datePart, time] = date.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const label = new Date(year, month - 1, day, 12).toLocaleDateString('es', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  return time ? `${label}, ${time.slice(0, 5)}` : label;
}

function formatDateTick(date) {
  if (date.includes('T')) return date.split('T')[1].slice(0, 5);
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day, 12).toLocaleDateString('es', {
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
  const [draftPeriod, setDraftPeriod] = useState('last7days');
  const [draftDate, setDraftDate] = useState('');
  const [filter, setFilter] = useState({ period: 'last7days' });

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setError('');
    setSummary(null);

    async function loadSummary() {
      try {
        const { data } = await api.get('/dashboard/summary', { params: filter });
        if (!data.summary || !data.summary.period || !Array.isArray(data.summary.callsByDay) || !Array.isArray(data.summary.averageDurationByDay)) {
          throw new Error('La respuesta del servidor no tiene el formato esperado.');
        }
        if (active) {
          setSummary(data.summary);
          setDraftDate((date) => date || data.summary.period.referenceDate);
        }
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
  }, [filter, retryCount]);

  function applyFilter(event) {
    event.preventDefault();
    setFilter(draftPeriod === 'last7days' ? { period: draftPeriod } : { period: draftPeriod, date: draftDate });
  }

  const callsByDay = summary?.callsByDay || [];
  const hasCallData = callsByDay.some((day) => Number(day.totalCalls) > 0);
  const averageDurationByDay = summary?.averageDurationByDay || [];
  const hasDurationData = averageDurationByDay.some((day) => day.averageDurationSeconds !== null);
  const metrics = [
    { title: 'Llamadas totales', value: summary?.totalCalls ?? 0, tone: 'brand' },
    { title: 'Llamadas completadas', value: summary?.completedCalls ?? 0, tone: 'positive' },
    { title: 'Llamadas fallidas', value: summary?.failedCalls ?? 0, tone: 'negative' },
    { title: 'Duración promedio (min:s)', value: formatDuration(summary?.averageDurationSeconds ?? 0), tone: 'neutral' },
  ];
  const groupLabel = summary?.period.granularity === 'hour' ? 'hora' : 'día';
  const periodLabel = summary && (summary.period.startDate === summary.period.endDate
    ? formatDateLabel(summary.period.startDate)
    : `${formatDateLabel(summary.period.startDate)} - ${formatDateLabel(summary.period.endDate)}`);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-brand-300">Operaciones</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">Dashboard</h1>
        </div>
      </div>

      <form onSubmit={applyFilter} className="card flex flex-wrap items-end gap-4 p-5 sm:p-6" aria-label="Filtrar indicadores por período">
        <div>
          <label htmlFor="dashboard-period" className="mb-2 block text-sm font-medium text-slate-200">Período</label>
          <select
            id="dashboard-period"
            value={draftPeriod}
            onChange={(event) => setDraftPeriod(event.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white focus:border-brand-400 focus:outline-none sm:w-auto"
          >
            <option value="last7days">Últimos 7 días</option>
            <option value="day">Día</option>
            <option value="week">Semana</option>
            <option value="month">Mes</option>
          </select>
        </div>
        {draftPeriod !== 'last7days' && (
          <div>
            <label htmlFor="dashboard-date" className="mb-2 block text-sm font-medium text-slate-200">
              {draftPeriod === 'month' ? 'Mes' : draftPeriod === 'week' ? 'Fecha de la semana' : 'Fecha'}
            </label>
            <input
              id="dashboard-date"
              type={draftPeriod === 'month' ? 'month' : 'date'}
              value={draftPeriod === 'month' ? draftDate.slice(0, 7) : draftDate}
              onChange={(event) => setDraftDate(draftPeriod === 'month' && event.target.value ? `${event.target.value}-01` : event.target.value)}
              required
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white focus:border-brand-400 focus:outline-none sm:w-auto"
            />
          </div>
        )}
        <button type="submit" disabled={isLoading} className="rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-400">
          Aplicar filtro
        </button>
        {summary && <p className="w-full text-xs text-slate-400">Período aplicado: {periodLabel} (hora de MySQL).</p>}
      </form>

      {isLoading ? (
        <div className="card p-6 text-center text-slate-300" role="status">Cargando estadísticas...</div>
      ) : error ? (
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
      ) : summary && (
        <>
      <section className="card p-5 sm:p-6" aria-label="Indicadores de llamadas">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4 xl:gap-8">
          {metrics.map((metric) => (
            <Metric key={metric.title} {...metric} />
          ))}
        </div>
      </section>

      <section className="card p-5 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-white">Volumen de llamadas</h2>
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <span>{periodLabel}</span>
          </div>
        </div>
        {hasCallData ? (
          <div className="h-64 border-t border-slate-800 pt-5 sm:h-72" role="img" aria-label={`Gráfico de llamadas totales y completadas por ${groupLabel} en el período seleccionado`}>
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
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-slate-700 px-4 py-12 text-center">
            <p className="font-medium text-slate-300">No hay llamadas registradas en el período seleccionado.</p>
          </div>
        )}
      </section>

      <section className="card p-5 sm:p-6">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Evolución de duración promedio</h2>
            <p className="mt-1 text-sm text-slate-400">Tiempo promedio de las llamadas completadas por {groupLabel}.</p>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <span>{periodLabel}</span>
            <span>min:s</span>
          </div>
        </div>
        {hasDurationData ? (
          <div className="h-64 border-t border-slate-800 pt-5 sm:h-72" role="img" aria-label={`Gráfico de duración promedio de llamadas completadas por ${groupLabel} en el período seleccionado, en minutos y segundos`}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={averageDurationByDay} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
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
                  tickFormatter={formatDuration}
                  tick={{ fill: '#aaa89e', fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={55}
                />
                <Tooltip
                  labelFormatter={formatDateLabel}
                  formatter={(value) => [formatDuration(value), 'Duración promedio']}
                  contentStyle={{ backgroundColor: '#22231f', border: '1px solid #3b3c35', borderRadius: 8 }}
                  labelStyle={{ color: '#f4f1e8', marginBottom: 4 }}
                  itemStyle={{ color: '#d6d3c9', fontSize: 12 }}
                />
                <Area
                  type="monotone"
                  dataKey="averageDurationSeconds"
                  name="Duración promedio"
                  stroke="#fb923c"
                  fill="#fb923c"
                  fillOpacity={0.16}
                  strokeWidth={2}
                  dot={{ r: 3, fill: '#fb923c' }}
                  activeDot={{ r: 5 }}
                  connectNulls={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-slate-700 px-4 py-12 text-center">
            <p className="font-medium text-slate-300">No hay llamadas completadas con duración válida en el período seleccionado.</p>
          </div>
        )}
      </section>
        </>
      )}
    </div>
  );
}
