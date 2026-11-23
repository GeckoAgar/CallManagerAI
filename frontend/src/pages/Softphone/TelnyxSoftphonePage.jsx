import { useCallback, useEffect, useRef, useState } from 'react';
import { TelnyxRTC } from '@telnyx/webrtc';
import { ArrowDownLeft, ArrowUpRight, Clock3, Delete, History, Mic, MicOff, Phone, PhoneCall, PhoneOff, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { StatusBadge } from '../../components/common/StatusBadge';
import { formatDuration } from '../Dashboard/formatDuration';
import api from '../../services/api';

const phonePattern = /^\+[1-9]\d{7,14}$/;
const historyRefreshInterval = 15000;

function message(error) {
  return error.response?.data?.message || error.message || 'No se pudo completar la operación.';
}

function formatCallDate(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return 'Fecha no disponible';
  return date.toLocaleString('es-AR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function TelnyxSoftphonePage() {
  const [number, setNumber] = useState('');
  const [status, setStatus] = useState('offline');
  const [callStatus, setCallStatus] = useState('idle');
  const [error, setError] = useState('');
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [muted, setMuted] = useState(false);
  const clientRef = useRef(null);
  const callRef = useRef(null);
  const sessionRef = useRef(crypto.randomUUID());
  const reservationRef = useRef('');
  const callerNumberRef = useRef('');
  const connectedRef = useRef(false);
  const callAttemptRef = useRef(0);
  const mountedRef = useRef(true);
  const historyRequestRef = useRef(0);

  const loadHistory = useCallback(async () => {
    const request = ++historyRequestRef.current;
    if (mountedRef.current) setHistoryLoading(true);
    try {
      const { data } = await api.get('/calls');
      if (!Array.isArray(data.calls)) throw new Error('La respuesta del historial no es válida.');
      if (mountedRef.current && request === historyRequestRef.current) {
        setHistory(data.calls.slice(0, 8));
        setHistoryLoaded(true);
        setHistoryError('');
      }
    } catch (requestError) {
      if (mountedRef.current && request === historyRequestRef.current) setHistoryError(message(requestError));
    } finally {
      if (mountedRef.current && request === historyRequestRef.current) setHistoryLoading(false);
    }
  }, []);

  const markOffline = useCallback(async () => {
    await api.patch('/softphone/presence', { status: 'offline', deviceSessionId: sessionRef.current });
  }, []);

  const finishCall = useCallback(async () => {
    callAttemptRef.current += 1;
    const reservation = reservationRef.current;
    callRef.current = null;
    if (reservation) {
      try {
        const response = await api.post('/softphone/telnyx/calls/end', { reservation });
        if (response.status === 202) {
          if (mountedRef.current) setCallStatus('ending');
          return;
        }
      } catch (requestError) {
        if (mountedRef.current) setError(message(requestError));
        return;
      }
    }
    if (reservationRef.current === reservation) reservationRef.current = '';
    if (mountedRef.current) {
      setCallStatus('idle');
      setMuted(false);
      setStatus(connectedRef.current ? 'available' : 'offline');
    }
    await loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    mountedRef.current = true;
    loadHistory();
    const timer = window.setInterval(loadHistory, historyRefreshInterval);
    return () => {
      mountedRef.current = false;
      connectedRef.current = false;
      window.clearInterval(timer);
      if (callRef.current) callRef.current.hangup().catch((err) => console.error('Error al colgar:', err));
      if (clientRef.current) {
        clientRef.current.disconnect().catch((err) => console.error('Error al desconectar Telnyx:', err));
      }
      if (reservationRef.current) {
        api.post('/softphone/telnyx/calls/end', { reservation: reservationRef.current })
          .catch((err) => console.error('Error al finalizar la llamada:', err));
      }
      markOffline().catch((err) => console.error('Error al desconectar el softphone:', err));
    };
  }, [loadHistory, markOffline]);

  useEffect(() => {
    if (status !== 'available' && status !== 'busy') return undefined;
    const timer = window.setInterval(async () => {
      try {
        const { data } = await api.patch('/softphone/presence/heartbeat', { deviceSessionId: sessionRef.current });
        if (!data.refreshed) {
          connectedRef.current = false;
          if (clientRef.current) await clientRef.current.disconnect();
          clientRef.current = null;
          setStatus('offline');
          setError('La sesión del teléfono venció. Volvé a conectarte.');
        }
      } catch (requestError) {
        setError(message(requestError));
      }
    }, 30000);
    return () => window.clearInterval(timer);
  }, [status]);

  useEffect(() => {
    if (callStatus === 'idle') return undefined;
    const timer = window.setInterval(async () => {
      const reservation = reservationRef.current;
      if (!reservation) return;
      try {
        const { data } = await api.post('/softphone/telnyx/calls/status', { reservation });
        if (reservation !== reservationRef.current) return;
        if (data.call.status === 'active') setCallStatus((current) => current === 'ending' ? current : 'active');
        if (['completed', 'failed'].includes(data.call.status)) {
          if (data.call.status === 'failed') setError('La llamada no se pudo completar.');
          if (callRef.current) await callRef.current.hangup();
          await finishCall();
        }
      } catch (requestError) {
        setError(message(requestError));
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [callStatus, finishCall]);

  async function connect() {
    setError('');
    setStatus('connecting');
    try {
      await api.patch('/softphone/presence/register', { deviceSessionId: sessionRef.current });
      const { data } = await api.post('/softphone/telnyx/token', { deviceSessionId: sessionRef.current });
      callerNumberRef.current = data.callerNumber;
      await new Promise((resolve) => window.setTimeout(resolve, 5000));
      if (!mountedRef.current) {
        await markOffline();
        return;
      }
      const client = new TelnyxRTC({ login_token: data.token });
      client.remoteElement = 'telnyx-remote-audio';
      clientRef.current = client;
      client.on('telnyx.ready', () => {
        if (!mountedRef.current || clientRef.current !== client) return;
        connectedRef.current = true;
        setStatus('available');
      });
      client.on('telnyx.socket.close', () => {
        if (!mountedRef.current || !connectedRef.current) return;
        connectedRef.current = false;
        clientRef.current = null;
        setStatus('offline');
        setError('Se perdió la conexión con Telnyx. Volvé a conectarte.');
        client.disconnect().catch((err) => setError(message(err)));
        markOffline().catch((err) => setError(message(err)));
      });
      client.on('telnyx.error', (err) => {
        if (!mountedRef.current || clientRef.current !== client) return;
        setError(message(err));
        if (!connectedRef.current) {
          clientRef.current = null;
          client.disconnect().catch((disconnectError) => setError(message(disconnectError)));
          setStatus('offline');
          markOffline().catch((offlineError) => setError(message(offlineError)));
        }
      });
      client.on('telnyx.notification', (notification) => {
        if (notification.type !== 'callUpdate' || !notification.call) return;
        const call = notification.call;
        if (call.direction === 'inbound' && call.state === 'ringing') {
          call.hangup().catch((err) => setError(message(err)));
        } else if (callRef.current?.id === call.id && ['done', 'destroy'].includes(call.state)) {
          finishCall();
        }
      });
      await client.connect();
    } catch (requestError) {
      setError(message(requestError));
      setStatus('offline');
      try {
        await markOffline();
      } catch (offlineError) {
        setError(message(offlineError));
      }
    }
  }

  async function disconnect() {
    connectedRef.current = false;
    try {
      if (clientRef.current) await clientRef.current.disconnect();
      clientRef.current = null;
      await markOffline();
      setStatus('offline');
    } catch (requestError) {
      setError(message(requestError));
    }
  }

  async function makeCall(event) {
    event.preventDefault();
    if (!phonePattern.test(number)) {
      setError('Ingresá un número internacional válido, por ejemplo +5491123456789.');
      return;
    }
    if (!connectedRef.current || !clientRef.current || status !== 'available') return;
    setError('');
    setStatus('busy');
    setCallStatus('connecting');
    const attempt = ++callAttemptRef.current;
    try {
      const { data } = await api.post('/softphone/telnyx/calls', {
        deviceSessionId: sessionRef.current, phoneNumber: number,
      });
      if (attempt !== callAttemptRef.current || !mountedRef.current) {
        await api.post('/softphone/telnyx/calls/end', { reservation: data.reservation });
        return;
      }
      reservationRef.current = data.reservation;
      callRef.current = clientRef.current.newCall({
        destinationNumber: number,
        callerNumber: callerNumberRef.current,
        callerName: callerNumberRef.current,
        audio: true,
        video: false,
        customHeaders: [{ name: 'X-CallManager-Reservation', value: data.reservation }],
      });
    } catch (requestError) {
      setError(message(requestError));
      await finishCall();
    }
  }

  async function hangup() {
    try {
      if (callRef.current) await callRef.current.hangup();
      await finishCall();
    } catch (requestError) {
      setError(message(requestError));
    }
  }

  function toggleMute() {
    if (!callRef.current) return;
    if (muted) callRef.current.unmuteAudio();
    else callRef.current.muteAudio();
    setMuted(!muted);
  }

  const statusLabel = status === 'connecting' ? 'Conectando...' : status === 'offline' ? 'Desconectado' : status === 'busy' ? 'Ocupado' : 'Conectado a Telnyx';
  const StatusIcon = status === 'offline' ? WifiOff : Wifi;

  return (
    <div className="min-w-0 space-y-6">
      <header>
        <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-brand-300">Operaciones</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">Softphone</h1>
        <p className="mt-1 text-sm text-slate-400">Realizá llamadas salientes y consultá tu actividad reciente.</p>
      </header>

      <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="card min-w-0 p-4 sm:p-6" aria-labelledby="dialer-heading">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-brand-500/20 bg-brand-500/10 text-brand-300">
              <PhoneCall className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h2 id="dialer-heading" className="text-lg font-semibold text-white">Marcador</h2>
              <p className="text-sm text-slate-400">Telefonía mediante Telnyx</p>
            </div>
          </div>
          <audio id="telnyx-remote-audio" autoPlay />

          <div className="mt-5 rounded-2xl border border-slate-700/70 bg-slate-950/60 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${status === 'available' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>
                  <StatusIcon className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Estado del dispositivo</p>
                  <p className="mt-1 text-sm font-medium text-slate-100" role="status">{statusLabel}</p>
                </div>
              </div>
              <button type="button" onClick={status === 'offline' ? connect : disconnect}
                disabled={status === 'connecting' || status === 'busy'}
                className="min-h-10 rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-50">
                {status === 'offline' ? 'Conectarme y quedar disponible' : 'Desconectarme'}
              </button>
            </div>
          </div>

          <form onSubmit={makeCall} className="mx-auto mt-6 max-w-sm">
            <label htmlFor="telnyx-number" className="block text-sm font-medium text-slate-200">Número de destino</label>
            <input id="telnyx-number" type="tel" value={number} onChange={(event) => setNumber(event.target.value)}
              placeholder="+5491123456789" autoComplete="tel"
              className="mt-2 min-h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 text-center text-lg tracking-wide text-white placeholder:text-slate-600 focus:border-brand-400 focus:outline-none" />
            <p className="mt-2 text-xs text-slate-400">Ingresá el número completo con código de país.</p>

            <div className="mt-5 grid grid-cols-3 gap-2.5">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '+', '0', '⌫'].map((digit) => (
                <button key={digit} type="button"
                  aria-label={digit === '⌫' ? 'Borrar último dígito' : `Agregar ${digit}`}
                  onClick={() => setNumber((current) => digit === '⌫' ? current.slice(0, -1) : `${current}${digit}`)}
                  className="flex min-h-12 items-center justify-center rounded-xl border border-slate-700 bg-slate-900 text-xl font-medium text-slate-100 transition hover:border-brand-500/50 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400">
                  {digit === '⌫' ? <Delete className="h-5 w-5" aria-hidden="true" /> : digit}
                </button>
              ))}
            </div>
            <button type="submit" disabled={status !== 'available' || callStatus !== 'idle'}
              className="mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40">
              <Phone className="h-4 w-4" aria-hidden="true" /> Llamar
            </button>
          </form>

          {callStatus !== 'idle' && (
            <div className="mt-5 rounded-xl border border-brand-500/30 bg-brand-500/5 p-4">
              <p className="text-sm font-medium text-brand-100" role="status">
                {callStatus === 'active' ? 'Llamada en curso' : callStatus === 'ending' ? 'Esperando confirmación de Telnyx...' : 'Conectando llamada...'}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={toggleMute} disabled={callStatus !== 'active'}
                  className="flex min-h-10 items-center gap-2 rounded-xl border border-slate-600 px-4 text-sm text-slate-100 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">
                  {muted ? <Mic className="h-4 w-4" aria-hidden="true" /> : <MicOff className="h-4 w-4" aria-hidden="true" />}
                  {muted ? 'Activar micrófono' : 'Silenciar'}
                </button>
                <button type="button" onClick={hangup}
                  className="flex min-h-10 items-center gap-2 rounded-xl bg-rose-600 px-4 text-sm font-semibold text-white hover:bg-rose-500">
                  <PhoneOff className="h-4 w-4" aria-hidden="true" /> Colgar
                </button>
              </div>
            </div>
          )}
          {error && <p role="alert" className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</p>}
          <p className="mt-5 text-xs text-slate-400">Las llamadas entrantes todavía no están disponibles.</p>
        </section>

        <section className="card min-w-0 p-4 sm:p-6" aria-labelledby="history-heading">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-700 bg-slate-800 text-slate-300">
                <History className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <h2 id="history-heading" className="text-lg font-semibold text-white">Historial reciente</h2>
                <p className="text-sm text-slate-400">Últimas 8 llamadas</p>
              </div>
            </div>
            <button type="button" onClick={loadHistory} disabled={historyLoading}
              className="flex min-h-10 items-center gap-2 rounded-xl border border-slate-700 px-3 text-sm font-medium text-slate-200 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">
              <RefreshCw className={`h-4 w-4 ${historyLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
              Actualizar
            </button>
          </div>
          <p className="mt-4 flex items-center gap-2 text-xs text-slate-400">
            <Clock3 className="h-3.5 w-3.5" aria-hidden="true" /> Actualización automática cada 15 segundos
          </p>
          {historyError && <p role="alert" className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">No se pudo actualizar el historial: {historyError}</p>}
          {!historyLoaded && historyLoading && <p role="status" className="mt-5 text-sm text-slate-400">Cargando historial...</p>}
          {historyLoaded && history.length === 0 && (
            <div className="mt-5 rounded-xl border border-dashed border-slate-700 bg-slate-950/40 px-4 py-8 text-center">
              <History className="mx-auto h-6 w-6 text-slate-500" aria-hidden="true" />
              <p className="mt-3 text-sm font-medium text-slate-300">Todavía no hay llamadas registradas</p>
              <p className="mt-1 text-xs text-slate-500">Las llamadas aparecerán aquí cuando se registren.</p>
            </div>
          )}
          {history.length > 0 && (
            <div className="mt-5 space-y-2">
              {history.map((call) => (
                <article key={call.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/40 p-3 sm:p-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-800 text-brand-300">
                      {call.direction === 'inbound' ? <ArrowDownLeft className="h-4 w-4" aria-hidden="true" /> : <ArrowUpRight className="h-4 w-4" aria-hidden="true" />}
                    </span>
                    <div className="min-w-0">
                      <p className="break-all text-sm font-semibold text-slate-100">{call.phone_number || 'Sin número'}</p>
                      <p className="mt-1 text-xs text-slate-400">{call.direction === 'inbound' ? 'Entrante' : 'Saliente'} · {formatCallDate(call.created_at)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs tabular-nums text-slate-400">{formatDuration(call.duration_seconds)}</span>
                    <StatusBadge status={call.status} />
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
