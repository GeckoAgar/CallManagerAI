import { useEffect } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { useToastStore } from '../../store/toastStore';

const toastTypes = {
  success: { Icon: CheckCircle2, label: 'Éxito', color: 'text-emerald-300', border: 'border-l-emerald-500' },
  error: { Icon: AlertCircle, label: 'Error', color: 'text-rose-300', border: 'border-l-rose-500' },
  warning: { Icon: AlertTriangle, label: 'Aviso', color: 'text-amber-300', border: 'border-l-amber-500' },
  info: { Icon: Info, label: 'Información', color: 'text-sky-300', border: 'border-l-sky-500' },
};

function Toast({ toast }) {
  const dismiss = useToastStore((state) => state.dismiss);
  const remove = useToastStore((state) => state.remove);
  const { Icon, label, color, border } = toastTypes[toast.type];

  useEffect(() => {
    const timer = window.setTimeout(
      () => toast.exiting ? remove(toast.id) : dismiss(toast.id),
      toast.exiting ? 180 : 6000
    );
    return () => window.clearTimeout(timer);
  }, [toast.id, toast.exiting, dismiss, remove]);

  return (
    <div
      className={`toast pointer-events-auto flex items-start gap-3 rounded-lg border border-slate-700 border-l-4 ${border} bg-slate-900 p-4 shadow-soft ${toast.exiting ? 'toast-exit' : 'toast-enter'}`}
      role={toast.announce ? (toast.type === 'error' ? 'alert' : 'status') : undefined}
      aria-atomic="true"
    >
      <Icon size={19} className={`mt-0.5 shrink-0 ${color}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className={`text-xs font-semibold ${color}`}>{label}</p>
        <p className="mt-1 break-words text-sm leading-5 text-slate-100">{toast.message}</p>
      </div>
      <button
        type="button"
        onClick={() => dismiss(toast.id)}
        aria-label={`Cerrar notificación: ${label}`}
        className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}

export function ToastViewport() {
  const toasts = useToastStore((state) => state.toasts);

  return (
    <section
      aria-label="Notificaciones"
      className="pointer-events-none fixed right-3 top-3 z-[100] flex max-h-[calc(100vh-1.5rem)] w-[calc(100%-1.5rem)] max-w-sm flex-col gap-2 overflow-y-auto sm:right-5 sm:top-5"
    >
      {toasts.map((toast) => <Toast key={toast.id} toast={toast} />)}
    </section>
  );
}
