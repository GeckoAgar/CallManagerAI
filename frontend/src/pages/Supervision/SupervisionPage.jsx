import { useEffect, useRef, useState } from 'react';
import { StatusBadge } from '../../components/common/StatusBadge';
import api from '../../services/api';

const refreshDelay = 30000;
const numberFormatter = new Intl.NumberFormat('es-AR');

const metricGroups = [
  {
    title: 'Agentes',
    metrics: [
      ['totalAgents', 'Agentes totales', 'neutral'],
      ['availableAgents', 'Disponibles', 'positive'],
      ['busyAgents', 'Ocupados', 'warning'],
      ['offlineAgents', 'Desconectados', 'negative'],
    ],
  },
  {
    title: 'Llamadas y monitoreo',
    metrics: [
      ['activeCalls', 'Llamadas activas', 'brand'],
      ['waitingCalls', 'En espera', 'warning'],
      ['monitoringCalls', 'En monitoreo', 'positive'],
      ['escalatedCalls', 'Escaladas', 'negative'],
    ],
  },
];

const metricToneClasses = {
  neutral: 'border-slate-600',
  positive: 'border-emerald-500',
  warning: 'border-amber-400',
  negative: 'border-rose-500',
  brand: 'border-brand-400',
};

function getErrorMessage(error) {
  return error.response?.data?.message || error.message || 'No se pudieron cargar los datos de supervisión.';
}

function formatDateTime(value) {
  if (!value) return 'Sin registro';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Fecha inválida' : date.toLocaleString('es');
}

export function SupervisionPage() {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [activeAction, setActiveAction] = useState('');
  const [retryCount, setRetryCount] = useState(0);
  const actionControllerRef = useRef(null);

  useEffect(() => {
    let active = true;
    let timeoutId;
    let controller;
    setIsLoading(true);
    setError('');

    async function refresh(showLoading = false) {
      if (showLoading) setIsLoading(true);
      controller = new AbortController();
      try {
        const [summaryResponse, agentsResponse, queueResponse] = await Promise.all([
          api.get('/supervision/summary', { signal: controller.signal }),
          api.get('/supervision/agents', { signal: controller.signal }),
          api.get('/supervision/queue', { signal: controller.signal }),
        ]);
        if (!summaryResponse.data.summary ||
            !Array.isArray(agentsResponse.data.agents) ||
            !Array.isArray(queueResponse.data.queue)) {
          throw new Error('La respuesta del servidor no tiene el formato esperado.');
        }
        if (active) {
          setData({
            summary: summaryResponse.data.summary,
            agents: agentsResponse.data.agents,
            queue: queueResponse.data.queue,
          });
          setError('');
        }
      } catch (requestError) {
        controller.abort();
        if (active) {
          setData(null);
          setError(getErrorMessage(requestError));
        }
      } finally {
        if (active) {
          setIsLoading(false);
          timeoutId = window.setTimeout(() => refresh(), refreshDelay);
        }
      }
    }

    refresh(true);
    return () => {
      active = false;
      window.clearTimeout(timeoutId);
      controller?.abort();
    };
  }, [retryCount]);

  useEffect(() => () => {
    actionControllerRef.current?.abort();
  }, []);

  async function runQueueAction(item, action) {
    const controller = new AbortController();
    actionControllerRef.current?.abort();
    actionControllerRef.current = controller;
    setActiveAction(`${item.id}:${action}`);
    setActionError('');

    try {
      if (action === 'monitoring') {
        await api.post(`/supervision/queue/${item.id}/monitoring`, {}, { signal: controller.signal });
      } else if (action === 'escalate') {
        await api.post(`/supervision/queue/${item.id}/escalate`, {}, { signal: controller.signal });
      } else {
        await api.delete(`/supervision/queue/${item.id}`, { signal: controller.signal });
      }
      setRetryCount((count) => count + 1);
    } catch (requestError) {
      if (!controller.signal.aborted) setActionError(getErrorMessage(requestError));
    } finally {
      if (!controller.signal.aborted) {
        actionControllerRef.current = null;
        setActiveAction('');
      }
    }
  }

  if (isLoading) {
    return (
      <div className="card flex items-center justify-center gap-3 p-8 text-slate-300" role="status">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-brand-300" aria-hidden="true" />
        <span className="text-sm">Cargando supervisión...</span>
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

  const formattedMetricGroups = metricGroups.map((group) => ({
    ...group,
    metrics: group.metrics.map(([key, label, tone]) => ({
      label,
      tone,
      value: numberFormatter.format(data.summary[key] ?? 0),
    })),
  }));

  return (
    <div className="min-w-0 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-brand-300">Operaciones</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">Supervisión</h1>
        </div>
        <p className="rounded-md border border-slate-800 bg-slate-900/70 px-3 py-2 text-xs text-slate-400">
          Actualización automática cada 30 segundos
        </p>
      </div>

      <div className="grid min-w-0 gap-4 xl:grid-cols-2">
        {formattedMetricGroups.map((group) => (
          <section key={group.title} className="card min-w-0 p-4 sm:p-5">
            <div className="mb-4 flex items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <h2 className="text-sm font-semibold text-white">{group.title}</h2>
              <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">Resumen</span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {group.metrics.map((metric) => (
                <div key={metric.label} className={`min-w-0 border-l-2 pl-3 ${metricToneClasses[metric.tone]}`}>
                  <p className="text-xs leading-5 text-slate-400">{metric.label}</p>
                  <p className="mt-2 text-2xl font-semibold tabular-nums text-white">{metric.value}</p>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <section className="card min-w-0 overflow-hidden p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-slate-800 pb-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Disponibilidad</p>
            <h2 className="mt-1 text-lg font-semibold text-white">Agentes</h2>
          </div>
          <span className="text-xs text-slate-400">Estado y última actualización</span>
        </div>
        {data.agents.length ? (
          <div className="overflow-x-auto">
            <table className="min-w-[680px] w-full text-left text-sm">
              <thead className="bg-slate-950/70 text-[11px] uppercase tracking-wide text-slate-400">
                <tr>
                  <th scope="col" className="whitespace-nowrap px-4 py-3 font-semibold">Nombre</th>
                  <th scope="col" className="whitespace-nowrap px-4 py-3 font-semibold">Correo</th>
                  <th scope="col" className="whitespace-nowrap px-4 py-3 font-semibold">Estado</th>
                  <th scope="col" className="whitespace-nowrap px-4 py-3 font-semibold">Actualizado</th>
                </tr>
              </thead>
              <tbody className="text-slate-200">
                {data.agents.map((agent) => (
                  <tr key={agent.id} className="border-t border-slate-800/80 transition-colors hover:bg-slate-800/30">
                    <td className="whitespace-nowrap px-4 py-3.5 font-medium text-white">{agent.name}</td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-slate-400">{agent.email}</td>
                    <td className="px-4 py-3.5"><StatusBadge status={agent.status} /></td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-xs tabular-nums text-slate-400">{formatDateTime(agent.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-slate-700 px-4 py-10 text-center">
            <p className="font-medium text-slate-300">No hay agentes activos para supervisar.</p>
          </div>
        )}
      </section>

      <section className="card min-w-0 p-4 sm:p-5">
        <div className="mb-4 border-b border-slate-800 pb-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Operaciones pendientes</p>
          <h2 className="mt-1 text-lg font-semibold text-white">Cola de supervisión</h2>
        </div>
        {actionError && <p className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200" role="alert">{actionError}</p>}
        {data.queue.length ? (
          <div className="space-y-3">
            {data.queue.map((item) => (
              <article key={item.id} className="flex min-w-0 flex-col gap-3 rounded-lg border border-slate-800 bg-slate-950/60 p-4 transition-colors hover:bg-slate-900/80 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate font-medium text-white">{item.agentName || 'Sin agente asignado'}</p>
                  <p className="mt-1 break-words text-sm text-slate-400">
                    Llamada {item.callId == null ? 'sin asociar' : `#${item.callId}`}
                    {item.phoneNumber ? ` · ${item.phoneNumber}` : ''}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">{formatDateTime(item.createdAt)}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                  <StatusBadge status={item.status} />
                  {item.status === 'waiting' && (
                    <button
                      type="button"
                      onClick={() => runQueueAction(item, 'monitoring')}
                      disabled={activeAction !== ''}
                      className="min-h-10 rounded-lg bg-brand-500 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-brand-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {activeAction === `${item.id}:monitoring` ? 'Iniciando...' : 'Iniciar supervisión'}
                    </button>
                  )}
                  {['waiting', 'monitoring'].includes(item.status) && (
                    <button
                      type="button"
                      onClick={() => runQueueAction(item, 'escalate')}
                      disabled={activeAction !== ''}
                      className="min-h-10 rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-rose-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-300 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {activeAction === `${item.id}:escalate` ? 'Escalando...' : 'Escalar'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => runQueueAction(item, 'remove')}
                    disabled={activeAction !== ''}
                    className="min-h-10 rounded-lg border border-slate-700 px-3 py-2 text-xs font-medium text-slate-200 transition-colors hover:border-slate-500 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {activeAction === `${item.id}:remove` ? 'Retirando...' : 'Retirar de la cola'}
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-slate-700 px-4 py-10 text-center">
            <p className="font-medium text-slate-300">La cola de supervisión está vacía.</p>
          </div>
        )}
      </section>
    </div>
  );
}
