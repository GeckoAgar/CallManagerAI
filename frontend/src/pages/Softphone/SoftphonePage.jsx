import { useCallback, useEffect, useRef, useState } from 'react';
import { Device } from '@twilio/voice-sdk';
import { Check, Mic, MicOff, Phone, PhoneCall, PhoneIncoming, PhoneOff, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import api from '../../services/api';
import { useAuthStore } from '../../store/authStore';

const phoneNumberPattern = /^\+[1-9]\d{7,14}$/;
const presenceHeartbeatDelay = 30000;
const reconnectInitialDelay = 1000;
const reconnectMaxDelay = 30000;
const terminalTwilioErrorCodes = new Set([20101, 20103, 20104, 31204, 31205]);
const presenceLabels = {
  offline: 'Desconectado',
  available: 'Disponible',
  busy: 'Ocupado',
};
const callStatusLabels = {
  queued: 'Iniciando',
  active: 'En curso',
  completed: 'Finalizada',
  failed: 'No completada',
};

function getErrorMessage(error) {
  return error.response?.data?.message || error.message || 'No se pudo completar la operación.';
}

function isAuthenticationFailure(error) {
  return [401, 403].includes(error.response?.status) ||
    terminalTwilioErrorCodes.has(Number(error.code));
}

export function SoftphonePage() {
  const deviceRef = useRef(null);
  const callRef = useRef(null);
  const deviceSessionIdRef = useRef('');
  const shouldBeAvailableRef = useRef(false);
  const activateDeviceRef = useRef(null);
  const stopDeviceRef = useRef(null);
  const scheduleReconnectRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const userId = useAuthStore((state) => state.user?.id);
  const authToken = useAuthStore((state) => state.token);
  const [deviceInitialized, setDeviceInitialized] = useState(false);
  const [deviceReady, setDeviceReady] = useState(false);
  const [deviceSessionId, setDeviceSessionId] = useState('');
  const [presence, setPresence] = useState('offline');
  const [number, setNumber] = useState('');
  const [callState, setCallState] = useState('idle');
  const [callLabel, setCallLabel] = useState('');
  const [incomingCall, setIncomingCall] = useState(false);
  const [muted, setMuted] = useState(false);
  const [calls, setCalls] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRegistering, setIsRegistering] = useState(false);
  const [error, setError] = useState('');

  const loadCalls = useCallback(async () => {
    try {
      const { data } = await api.get('/calls');
      setCalls((data.calls || []).slice(0, 8));
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsLoading(false);
    }
  }, []);

  const changePresence = useCallback(async (status) => {
    const { data } = await api.patch('/softphone/presence', {
      status,
      ...(deviceSessionIdRef.current ? { deviceSessionId: deviceSessionIdRef.current } : {}),
    });
    setPresence(status);
    return data.presence;
  }, []);

  const finishCall = useCallback(async () => {
    callRef.current = null;
    setIncomingCall(false);
    setCallState('idle');
    setCallLabel('');
    setMuted(false);
    await loadCalls();
    const isRegistered = shouldBeAvailableRef.current && deviceRef.current?.state === 'registered';
    try {
      if (isRegistered) {
        await changePresence('available');
      } else {
        setPresence('offline');
        await changePresence('offline');
      }
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    }
  }, [changePresence, loadCalls]);

  const bindCallEvents = useCallback((call, isIncoming = false) => {
    callRef.current = call;
    setIncomingCall(isIncoming);
    setCallState(isIncoming ? 'incoming' : 'connecting');
    setCallLabel(isIncoming ? `Llamada entrante de ${call.parameters.From || 'número desconocido'}` : 'Conectando llamada...');
    call.on('accept', () => {
      setIncomingCall(false);
      setCallState('active');
      setCallLabel('Llamada en curso');
      changePresence('busy').catch((requestError) => setError(getErrorMessage(requestError)));
    });
    call.on('disconnect', finishCall);
    call.on('cancel', finishCall);
    call.on('reject', finishCall);
    call.on('error', (callError) => {
      setError(getErrorMessage(callError));
      finishCall();
    });
  }, [changePresence, finishCall]);

  useEffect(() => {
    let active = true;
    let historyTimer;
    const sessionId = window.crypto.randomUUID();
    let activationPromise;
    deviceSessionIdRef.current = sessionId;
    setDeviceSessionId(sessionId);
    shouldBeAvailableRef.current = false;
    setDeviceInitialized(false);
    setDeviceReady(false);
    setPresence('offline');

    function clearReconnectTimer() {
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    }

    async function markOffline() {
      await api.patch('/softphone/presence', { status: 'offline', deviceSessionId: sessionId });
    }

    function stopRegistration(message) {
      shouldBeAvailableRef.current = false;
      clearReconnectTimer();
      setDeviceReady(false);
      setPresence('offline');
      setIsRegistering(false);
      if (message) setError(message);
      markOffline().catch((requestError) => {
        if (active) setError(getErrorMessage(requestError));
      });
      const device = deviceRef.current;
      if (device && device.state !== 'unregistered') {
        device.unregister().catch((requestError) => {
          if (active) setError(getErrorMessage(requestError));
        });
      }
    }

    async function activateDevice(device) {
      if (!active || !shouldBeAvailableRef.current || deviceRef.current !== device ||
          device.state !== 'registered') return;
      if (activationPromise) return activationPromise;

      activationPromise = (async () => {
        try {
          const { data } = await api.patch('/softphone/presence/register', { deviceSessionId: sessionId });
          if (!active || !shouldBeAvailableRef.current || deviceRef.current !== device) {
            await markOffline();
            return;
          }
          const nextPresence = callRef.current ? 'busy' : data.presence.status;
          if (nextPresence !== data.presence.status) {
            await api.patch('/softphone/presence', { status: nextPresence, deviceSessionId: sessionId });
          }
          reconnectAttemptsRef.current = 0;
          clearReconnectTimer();
          setDeviceReady(true);
          setPresence(nextPresence);
          setIsRegistering(false);
        } catch (requestError) {
          if (!active) return;
          setDeviceReady(false);
          setPresence('offline');
          setError(getErrorMessage(requestError));
          if (isAuthenticationFailure(requestError) || requestError.response?.status === 409) {
            stopRegistration();
          } else {
            scheduleReconnectRef.current?.();
          }
        } finally {
          activationPromise = null;
        }
      })();
      return activationPromise;
    }

    function scheduleReconnect() {
      if (!active || !shouldBeAvailableRef.current || reconnectTimerRef.current) return;
      const delay = Math.min(
        reconnectInitialDelay * (2 ** reconnectAttemptsRef.current),
        reconnectMaxDelay
      );
      reconnectAttemptsRef.current += 1;
      setIsRegistering(true);
      reconnectTimerRef.current = window.setTimeout(async () => {
        reconnectTimerRef.current = null;
        const device = deviceRef.current;
        if (!active || !shouldBeAvailableRef.current || !device) {
          setIsRegistering(false);
          return;
        }
        if (!window.navigator.onLine) {
          setIsRegistering(false);
          scheduleReconnect();
          return;
        }
        try {
          const { data } = await api.get('/softphone/token', { params: { deviceSessionId: sessionId } });
          if (!active || !shouldBeAvailableRef.current || deviceRef.current !== device) return;
          device.updateToken(data.token);
          if (device.state !== 'registered') await device.register();
          if (device.state === 'registered') await activateDevice(device);
        } catch (requestError) {
          if (!active) return;
          setIsRegistering(false);
          setError(getErrorMessage(requestError));
          if (isAuthenticationFailure(requestError) || requestError.response?.status === 409) {
            stopRegistration();
          } else {
            scheduleReconnect();
          }
        }
      }, delay);
    }

    activateDeviceRef.current = activateDevice;
    stopDeviceRef.current = stopRegistration;
    scheduleReconnectRef.current = scheduleReconnect;

    async function initialize() {
      await loadCalls();
      try {
        if (!authToken || !userId) return;
        const { data } = await api.get('/softphone/token', { params: { deviceSessionId: sessionId } });
        if (!active) return;
        const device = new Device(data.token, { logLevel: 'error' });
        deviceRef.current = device;
        setDeviceInitialized(true);
        device.on('registered', () => {
          if (!active) return;
          if (shouldBeAvailableRef.current) {
            activateDevice(device);
          } else {
            setDeviceReady(false);
            if (device.state === 'registered') {
              device.unregister().catch((requestError) => {
                if (active) setError(getErrorMessage(requestError));
              });
            }
          }
        });
        device.on('unregistered', () => {
          if (!active) return;
          setDeviceReady(false);
          setPresence('offline');
          markOffline().catch((requestError) => {
            if (active) setError(getErrorMessage(requestError));
          });
          if (shouldBeAvailableRef.current) scheduleReconnect();
        });
        device.on('incoming', (call) => {
          if (!active) return;
          bindCallEvents(call, true);
          changePresence('busy').catch((requestError) => setError(getErrorMessage(requestError)));
        });
        device.on('tokenWillExpire', async () => {
          try {
            const { data: refreshed } = await api.get('/softphone/token', { params: { deviceSessionId: sessionId } });
            if (active && shouldBeAvailableRef.current && deviceRef.current === device) {
              device.updateToken(refreshed.token);
            }
          } catch (requestError) {
            if (!active) return;
            setError(getErrorMessage(requestError));
            if (isAuthenticationFailure(requestError)) {
              stopRegistration(getErrorMessage(requestError));
            } else if (shouldBeAvailableRef.current) {
              scheduleReconnect();
            }
          }
        });
        device.on('error', (deviceError) => {
          if (!active) return;
          setError(getErrorMessage(deviceError));
          if (isAuthenticationFailure(deviceError)) {
            stopRegistration(getErrorMessage(deviceError));
          } else if (shouldBeAvailableRef.current && device.state === 'unregistered') {
            scheduleReconnect();
          }
        });
        historyTimer = window.setInterval(loadCalls, 15000);
      } catch (requestError) {
        if (active) setError(getErrorMessage(requestError));
      }
    }

    function handleNetworkOffline() {
      setDeviceReady(false);
      setPresence('offline');
      markOffline().catch((requestError) => {
        if (active) setError(getErrorMessage(requestError));
      });
    }

    function handleNetworkOnline() {
      const device = deviceRef.current;
      if (!active || !shouldBeAvailableRef.current || !device) return;
      if (device.state === 'registered') {
        activateDevice(device);
      } else {
        scheduleReconnect();
      }
    }

    window.addEventListener('offline', handleNetworkOffline);
    window.addEventListener('online', handleNetworkOnline);
    initialize();
    return () => {
      active = false;
      window.clearInterval(historyTimer);
      clearReconnectTimer();
      window.removeEventListener('offline', handleNetworkOffline);
      window.removeEventListener('online', handleNetworkOnline);
      shouldBeAvailableRef.current = false;
      if (deviceRef.current) deviceRef.current.destroy();
      deviceRef.current = null;
      if (sessionId) {
        api.patch('/softphone/presence', { status: 'offline', deviceSessionId: sessionId })
          .catch((requestError) => console.error('Unable to clear softphone presence on unmount:', requestError));
      }
      if (deviceSessionIdRef.current === sessionId) deviceSessionIdRef.current = '';
      activateDeviceRef.current = null;
      stopDeviceRef.current = null;
      scheduleReconnectRef.current = null;
      callRef.current = null;
    };
  }, [authToken, bindCallEvents, changePresence, loadCalls, userId]);

  useEffect(() => {
    if (presence === 'offline' || !deviceSessionId) return undefined;

    let active = true;
    let timeoutId;
    let controller;
    async function sendHeartbeat() {
      controller = new AbortController();
      try {
        const { data } = await api.patch(
          '/softphone/presence/heartbeat',
          { deviceSessionId },
          { signal: controller.signal }
        );
        if (active && !data.refreshed) {
          const device = deviceRef.current;
          if (data.reason === 'expired' && shouldBeAvailableRef.current && device?.state === 'registered') {
            await activateDeviceRef.current?.(device);
          } else {
            stopDeviceRef.current?.(
              data.reason === 'session_replaced'
                ? 'La sesión del dispositivo fue reemplazada por otra conexión.'
                : ''
            );
          }
        }
      } catch (requestError) {
        if (active && requestError.name !== 'CanceledError') {
          setError(getErrorMessage(requestError));
          if (isAuthenticationFailure(requestError)) {
            stopDeviceRef.current?.(getErrorMessage(requestError));
          }
        }
      } finally {
        if (active) timeoutId = window.setTimeout(sendHeartbeat, presenceHeartbeatDelay);
      }
    }

    timeoutId = window.setTimeout(sendHeartbeat, presenceHeartbeatDelay);
    return () => {
      active = false;
      window.clearTimeout(timeoutId);
      controller?.abort();
    };
  }, [deviceSessionId, presence]);

  async function toggleAvailability() {
    setError('');
    setIsRegistering(true);
    const device = deviceRef.current;
    if (!device) {
      setError('El teléfono no pudo inicializarse.');
      setIsRegistering(false);
      return;
    }

    if (presence === 'offline') {
      shouldBeAvailableRef.current = true;
      try {
        const { data } = await api.get('/softphone/token', {
          params: { deviceSessionId: deviceSessionIdRef.current },
        });
        if (!shouldBeAvailableRef.current) return;
        device.updateToken(data.token);
        if (device.state !== 'registered') await device.register();
        if (device.state === 'registered') await activateDeviceRef.current?.(device);
      } catch (requestError) {
        setDeviceReady(false);
        setPresence('offline');
        setError(getErrorMessage(requestError));
        if (isAuthenticationFailure(requestError)) {
          stopDeviceRef.current?.(getErrorMessage(requestError));
        } else {
          scheduleReconnectRef.current?.();
        }
      } finally {
        setIsRegistering(false);
      }
    } else {
      shouldBeAvailableRef.current = false;
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      try {
        await changePresence('offline');
      } catch (requestError) {
        setError(getErrorMessage(requestError));
      } finally {
        setPresence('offline');
        setDeviceReady(false);
        if (device.state !== 'unregistered') {
          try {
            await device.unregister();
          } catch (requestError) {
            setError(getErrorMessage(requestError));
          }
        }
        setIsRegistering(false);
      }
    }
  }

  async function makeCall(event) {
    event.preventDefault();
    if (!phoneNumberPattern.test(number)) {
      setError('Ingresa un número internacional válido, por ejemplo +5491123456789.');
      return;
    }
    const device = deviceRef.current;
    if (!device || device.state !== 'registered' || presence !== 'available' ||
        !shouldBeAvailableRef.current) {
      setError('Conéctate y verifica que el dispositivo esté disponible antes de llamar.');
      return;
    }
    setError('');
    setCallState('connecting');
    setCallLabel('Conectando llamada...');
    try {
      const call = await device.connect({
        params: { To: number, DeviceSessionId: deviceSessionIdRef.current },
      });
      bindCallEvents(call);
    } catch (requestError) {
      setCallState('idle');
      setCallLabel('');
      setError(getErrorMessage(requestError));
    }
  }

  function answerCall() {
    callRef.current?.accept();
  }

  function rejectCall() {
    callRef.current?.reject();
    setIncomingCall(false);
  }

  function hangUp() {
    callRef.current?.disconnect();
  }

  function toggleMute() {
    if (!callRef.current) return;
    const nextMuted = !muted;
    callRef.current.mute(nextMuted);
    setMuted(nextMuted);
  }

  function appendDigit(digit) {
    setNumber((current) => `${current}${digit}`);
  }

  const isOnCall = callState === 'connecting' || callState === 'active' || callState === 'incoming';

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(320px,0.9fr)_1.1fr]">
      <section className="card p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-white">Softphone</h2>
            <p className="mt-1 text-sm text-slate-400">Llamadas del navegador mediante Twilio Voice.</p>
          </div>
          <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${
            presence === 'available' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
              : presence === 'busy' ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
                : 'border-slate-700 bg-slate-800 text-slate-300'
          }`}>
            {presence === 'offline' ? <WifiOff size={15} /> : <Wifi size={15} />}
            {presenceLabels[presence]}
          </span>
        </div>

        <div className="mt-6 rounded-xl border border-slate-800 bg-slate-950/70 p-4">
          <p className="text-sm text-slate-400">Estado del dispositivo</p>
          <p className="mt-1 flex items-center gap-2 font-medium text-white">
            <span className={`h-2.5 w-2.5 rounded-full ${deviceReady ? 'bg-emerald-400' : 'bg-slate-600'}`} />
            {deviceReady ? 'Conectado a Twilio' : 'Desconectado'}
          </p>
          <button
            type="button"
            onClick={toggleAvailability}
            disabled={!deviceInitialized || isRegistering || isOnCall}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-500 px-4 py-3 font-medium text-white hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isRegistering ? <RefreshCw size={17} className="animate-spin" /> : presence === 'offline' ? <Wifi size={17} /> : <WifiOff size={17} />}
            {isRegistering ? 'Conectando...' : presence === 'offline' ? 'Conectarme y quedar disponible' : 'Desconectarme'}
          </button>
        </div>

        <div className="mt-6 rounded-xl border border-slate-800 bg-slate-950/70 p-5">
          <div className="mb-4 text-center">
            <p className="text-sm text-slate-400">Teléfono</p>
            <p className="mt-2 min-h-8 text-xl font-semibold text-white">{number || 'Ingresa un número'}</p>
          </div>
          <div className="mx-auto grid max-w-xs grid-cols-3 gap-3">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '+', '0', '⌫'].map((digit) => (
              <button
                key={digit}
                type="button"
                onClick={() => digit === '⌫' ? setNumber((current) => current.slice(0, -1)) : appendDigit(digit)}
                className="rounded-xl border border-slate-800 bg-slate-900 py-3 text-lg font-medium text-slate-100 hover:bg-slate-800"
              >
                {digit}
              </button>
            ))}
          </div>
          <form onSubmit={makeCall} className="mt-4 space-y-3">
            <input
              aria-label="Número de destino"
              type="tel"
              autoComplete="tel"
              placeholder="+5491123456789"
              value={number}
              onChange={(event) => setNumber(event.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-3 text-white placeholder:text-slate-500 focus:border-brand-400 focus:outline-none"
            />
            <button
              type="submit"
              disabled={!deviceReady || presence !== 'available' || isOnCall}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Phone size={18} /> Llamar
            </button>
          </form>

          {isOnCall && (
            <div className="mt-4 rounded-xl border border-brand-500/30 bg-brand-500/10 p-4">
              <p className="text-center text-sm font-medium text-brand-100">{callLabel}</p>
              <div className="mt-4 flex justify-center gap-3">
                {incomingCall ? (
                  <>
                    <button type="button" onClick={answerCall} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-500">
                      <PhoneIncoming size={17} /> Atender
                    </button>
                    <button type="button" onClick={rejectCall} className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-rose-500">
                      <PhoneOff size={17} /> Rechazar
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" onClick={toggleMute} disabled={callState !== 'active'} className="inline-flex items-center gap-2 rounded-xl border border-slate-600 px-4 py-2.5 text-sm text-white hover:bg-slate-800 disabled:opacity-50">
                      {muted ? <MicOff size={17} /> : <Mic size={17} />} {muted ? 'Activar micrófono' : 'Silenciar'}
                    </button>
                    <button type="button" onClick={hangUp} className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-rose-500">
                      <PhoneOff size={17} /> Colgar
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {error && <p role="alert" className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>}
      </section>

      <section className="card p-6">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-white">Historial reciente</h2>
            <p className="mt-1 text-sm text-slate-400">Se actualiza automáticamente cada 15 segundos.</p>
          </div>
          <button type="button" onClick={loadCalls} aria-label="Actualizar historial" className="rounded-lg border border-slate-700 p-2 text-slate-300 hover:bg-slate-800">
            <RefreshCw size={17} />
          </button>
        </div>

        {isLoading ? (
          <p className="py-10 text-center text-sm text-slate-400">Cargando historial...</p>
        ) : calls.length ? (
          <div className="space-y-3">
            {calls.map((call) => (
              <article key={call.id} className="flex items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span className={`rounded-lg p-2 ${call.direction === 'inbound' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-brand-500/10 text-brand-300'}`}>
                    {call.direction === 'inbound' ? <PhoneIncoming size={18} /> : <PhoneCall size={18} />}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-white">{call.phone_number || 'Sin número'}</p>
                    <p className="mt-1 text-xs text-slate-400">{new Date(call.created_at).toLocaleString()}</p>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p className={`inline-flex items-center gap-1 text-sm ${call.status === 'completed' ? 'text-emerald-300' : 'text-slate-300'}`}>
                    {call.status === 'completed' && <Check size={14} />}
                    {callStatusLabels[call.status] || call.status}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">{call.duration_seconds || 0} s</p>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-slate-700 py-12 text-center text-sm text-slate-400">Todavía no hay llamadas registradas.</p>
        )}
      </section>
    </div>
  );
}
