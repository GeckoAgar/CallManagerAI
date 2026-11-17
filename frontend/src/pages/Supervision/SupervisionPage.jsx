import { useEffect, useRef, useState } from 'react';
import { StatusBadge } from '../../components/common/StatusBadge';
import api from '../../services/api';

const refreshDelay = 30000;
const numberFormatter = new Intl.NumberFormat('es-AR');

const metricLabels = [
  ['totalAgents', 'Agentes totales'],
  ['availableAgents', 'Disponibles'],
  ['busyAgents', 'Ocupados'],
  ['offlineAgents', 'Desconectados'],
  ['activeCalls', 'Llamadas activas'],
  ['waitingCalls', 'En espera'],
  ['monitoringCalls', 'En monitoreo'],
  ['escalatedCalls', 'Escaladas'],
];

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
    return <div className="card p-6 text-center text-slate-300" role="status">Cargando supervisión...</div>;
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

  const metrics = metricLabels.map(([key, label]) => ({
    label,
    value: numberFormatter.format(data.summary[key] ?? 0),
  }));

  return (
    <div className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <div key={metric.label} className="card p-5">
            <p className="text-sm text-slate-400">{metric.label}</p>
            <p className="mt-3 text-3xl font-bold text-white">{metric.value}</p>
          </div>
        ))}
      </section>

      <section className="card p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-white">Agentes</h3>
          <span className="text-xs text-slate-400">Actualización automática cada 30 segundos</span>
        </div>
        {data.agents.length ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-400">
                <tr>
                  <th className="px-3 py-2 font-medium">Nombre</th>
                  <th className="px-3 py-2 font-medium">Correo</th>
                  <th className="px-3 py-2 font-medium">Estado</th>
                  <th className="px-3 py-2 font-medium">Actualizado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-slate-200">
                {data.agents.map((agent) => (
                  <tr key={agent.id}>
                    <td className="whitespace-nowrap px-3 py-3">{agent.name}</td>
                    <td className="whitespace-nowrap px-3 py-3">{agent.email}</td>
                    <td className="px-3 py-3"><StatusBadge status={agent.status} /></td>
                    <td className="whitespace-nowrap px-3 py-3">{formatDateTime(agent.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-slate-700 px-4 py-10 text-center text-sm text-slate-400">
            No hay agentes activos para supervisar.
          </p>
        )}
      </section>

      <section className="card p-5">
        <h3 className="mb-4 text-lg font-semibold text-white">Cola de supervisión</h3>
        {actionError && <p className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200" role="alert">{actionError}</p>}
        {data.queue.length ? (
          <div className="space-y-3">
            {data.queue.map((item) => (
              <article key={item.id} className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate font-medium text-white">{item.agentName || 'Sin agente asignado'}</p>
                  <p className="mt-1 text-sm text-slate-400">
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
                      className="rounded-lg bg-cyan-700 px-3 py-2 text-xs font-medium text-white hover:bg-cyan-600 disabled:opacity-50"
                    >
                      {activeAction === `${item.id}:monitoring` ? 'Iniciando...' : 'Iniciar supervisión'}
                    </button>
                  )}
                  {['waiting', 'monitoring'].includes(item.status) && (
                    <button
                      type="button"
                      onClick={() => runQueueAction(item, 'escalate')}
                      disabled={activeAction !== ''}
                      className="rounded-lg bg-rose-700 px-3 py-2 text-xs font-medium text-white hover:bg-rose-600 disabled:opacity-50"
                    >
                      {activeAction === `${item.id}:escalate` ? 'Escalando...' : 'Escalar'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => runQueueAction(item, 'remove')}
                    disabled={activeAction !== ''}
                    className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                  >
                    {activeAction === `${item.id}:remove` ? 'Retirando...' : 'Retirar de la cola'}
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-slate-700 px-4 py-10 text-center text-sm text-slate-400">
            La cola de supervisión está vacía.
          </p>
        )}
      </section>
    </div>
  );
}
