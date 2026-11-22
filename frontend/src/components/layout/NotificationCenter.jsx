import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, Check, CheckCheck, Trash2 } from 'lucide-react';
import api from '../../services/api';
import { getActionErrorMessage } from '../../services/actionError';

export function NotificationCenter() {
  const containerRef = useRef(null);
  const buttonRef = useRef(null);
  const mountedRef = useRef(false);
  const sequenceRef = useRef(0);
  const loadedOlderRef = useRef(false);
  const loadingMoreRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextBefore, setNextBefore] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadNotifications = useCallback(async (signal) => {
    const sequence = ++sequenceRef.current;
    setLoading(true);
    try {
      const { data } = await api.get('/notifications', { signal });
      if (!Array.isArray(data.notifications) || !Number.isInteger(data.unreadCount) ||
          (data.nextBefore !== null && !Number.isInteger(data.nextBefore))) {
        throw new Error('Respuesta de notificaciones inválida.');
      }
      if (mountedRef.current && sequence === sequenceRef.current) {
        setNotifications((previous) => {
          if (!loadedOlderRef.current || data.notifications.length < 50) return data.notifications;
          const lastId = data.notifications[data.notifications.length - 1].id;
          return [...data.notifications, ...previous.filter((item) => item.id < lastId)];
        });
        if (!loadedOlderRef.current || data.notifications.length < 50) setNextBefore(data.nextBefore);
        setUnreadCount(data.unreadCount);
        setError('');
      }
    } catch (requestError) {
      if (mountedRef.current && sequence === sequenceRef.current && !signal?.aborted) {
        setError(requestError.response || requestError.request
          ? getActionErrorMessage(requestError)
          : 'No se pudieron cargar las notificaciones.');
      }
    } finally {
      if (mountedRef.current && sequence === sequenceRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const controller = new AbortController();
    loadNotifications(controller.signal);
    const interval = window.setInterval(() => {
      if (!loadingMoreRef.current) loadNotifications(controller.signal);
    }, 15000);
    return () => {
      mountedRef.current = false;
      sequenceRef.current += 1;
      controller.abort();
      window.clearInterval(interval);
    };
  }, [loadNotifications]);

  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event) {
      if (!containerRef.current?.contains(event.target)) setOpen(false);
    }
    function onKeyDown(event) {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  async function performAction(method, path) {
    if (busy || loadingMore) return;
    setBusy(true);
    setError('');
    sequenceRef.current += 1;
    try {
      await api[method](path);
      if (mountedRef.current) {
        const id = Number(path.split('/')[2]);
        if (path === '/notifications/read-all') {
          setNotifications((items) => items.map((item) => ({ ...item, read_at: item.read_at || new Date().toISOString() })));
        } else if (method === 'patch') {
          setNotifications((items) => items.map((item) => item.id === id ? { ...item, read_at: item.read_at || new Date().toISOString() } : item));
        } else {
          setNotifications((items) => items.filter((item) => item.id !== id));
        }
        await loadNotifications();
      }
    } catch (requestError) {
      if (mountedRef.current) setError(getActionErrorMessage(requestError));
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  function toggle() {
    if (!open) {
      loadedOlderRef.current = false;
      setNotifications([]);
      setNextBefore(null);
      loadNotifications();
    }
    setOpen((value) => !value);
  }

  async function loadMore() {
    if (!nextBefore || busy || loading || loadingMore) return;
    const sequence = ++sequenceRef.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setError('');
    try {
      const { data } = await api.get('/notifications', { params: { before: nextBefore } });
      if (!Array.isArray(data.notifications) || !Number.isInteger(data.unreadCount) ||
          (data.nextBefore !== null && !Number.isInteger(data.nextBefore))) {
        throw new Error('Respuesta de notificaciones inválida.');
      }
      if (mountedRef.current && sequence === sequenceRef.current) {
        loadedOlderRef.current = true;
        setNotifications((previous) => {
          const known = new Set(previous.map((item) => item.id));
          return [...previous, ...data.notifications.filter((item) => !known.has(item.id))];
        });
        setUnreadCount(data.unreadCount);
        setNextBefore(data.nextBefore);
      }
    } catch (requestError) {
      if (mountedRef.current && sequence === sequenceRef.current) {
        setError(requestError.response || requestError.request ? getActionErrorMessage(requestError) : 'No se pudieron cargar las notificaciones.');
      }
    } finally {
      loadingMoreRef.current = false;
      if (mountedRef.current) setLoadingMore(false);
    }
  }

  return (
    <div className="relative shrink-0" ref={containerRef}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={`Notificaciones${unreadCount ? `, ${unreadCount} sin leer` : ''}`}
        aria-expanded={open}
        aria-controls="notification-center"
        onClick={toggle}
        className="relative rounded-lg border border-slate-800 bg-slate-900 p-2.5 text-slate-300 hover:text-white"
      >
        <Bell size={18} aria-hidden="true" />
        {unreadCount > 0 && <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-brand-500 px-1 text-center text-[10px] font-bold text-slate-950">{unreadCount > 99 ? '99+' : unreadCount}</span>}
      </button>
      {open && (
        <section id="notification-center" aria-label="Centro de notificaciones" className="absolute right-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-slate-700 bg-slate-900 shadow-soft">
          <div className="flex items-start justify-between gap-2 border-b border-slate-800 p-4">
            <div>
              <h3 className="font-semibold text-white">Notificaciones</h3>
              <p className="text-xs text-slate-400">{unreadCount} sin leer</p>
            </div>
            <button type="button" disabled={busy || loadingMore || unreadCount === 0} onClick={() => performAction('patch', '/notifications/read-all')} className="flex items-center gap-1 text-xs text-brand-300 hover:text-brand-200 disabled:opacity-40">
              <CheckCheck size={15} aria-hidden="true" /> Marcar todas
            </button>
          </div>
          {error && <p role="alert" className="px-4 py-3 text-sm text-rose-300">{error}</p>}
          {loading && <p role="status" className="px-4 py-2 text-xs text-slate-400">Actualizando notificaciones...</p>}
          {!loading && !error && !notifications.length && <p className="px-4 py-6 text-center text-sm text-slate-400">No hay notificaciones.</p>}
          <ul className="max-h-96 overflow-y-auto">
            {notifications.map((notification) => (
              <li key={notification.id} className={`flex gap-2 border-t border-slate-800 px-4 py-3 ${notification.read_at ? '' : 'bg-brand-500/5'}`}>
                <span aria-hidden="true" className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${notification.read_at ? 'bg-slate-600' : 'bg-brand-400'}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-slate-100">{notification.message}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    {new Date(notification.created_at).toLocaleString('es-AR')} · {notification.read_at ? 'Leída' : 'Sin leer'} · {notification.type === 'warning' ? 'Advertencia' : 'Información'}
                  </p>
                </div>
                {!notification.read_at && (
                  <button type="button" disabled={busy || loadingMore} onClick={() => performAction('patch', `/notifications/${notification.id}/read`)} aria-label="Marcar notificación como leída" className="self-start rounded p-1 text-slate-400 hover:text-brand-300 disabled:opacity-40"><Check size={16} aria-hidden="true" /></button>
                )}
                <button type="button" disabled={busy || loadingMore} onClick={() => performAction('delete', `/notifications/${notification.id}`)} aria-label="Eliminar notificación" className="self-start rounded p-1 text-slate-400 hover:text-rose-300 disabled:opacity-40"><Trash2 size={16} aria-hidden="true" /></button>
              </li>
            ))}
          </ul>
          {nextBefore && <button type="button" disabled={busy || loading || loadingMore} onClick={loadMore} className="w-full border-t border-slate-800 px-4 py-3 text-sm text-brand-300 hover:bg-slate-800 disabled:opacity-40">{loadingMore ? 'Cargando...' : 'Cargar anteriores'}</button>}
        </section>
      )}
    </div>
  );
}
