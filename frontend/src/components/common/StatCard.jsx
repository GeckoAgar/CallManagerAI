export function StatusBadge({ status }) {
  const labels = {
    active: 'Activo',
    completed: 'Completada',
    queued: 'En cola',
    failed: 'Fallida',
    blocked: 'Bloqueado',
    inactive: 'Inactivo',
    monitoring: 'Monitoreo',
    waiting: 'Espera',
  };

  const colors = {
    active: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
    completed: 'border-brand-500/30 bg-brand-500/10 text-brand-200',
    queued: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
    failed: 'border-rose-500/30 bg-rose-500/10 text-rose-200',
    blocked: 'border-rose-500/30 bg-rose-500/10 text-rose-200',
    inactive: 'border-slate-500 bg-slate-800 text-slate-200',
    monitoring: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200',
    waiting: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
  };

  return <span className={`badge ${colors[status] || 'border-slate-500 bg-slate-800 text-slate-200'}`}>{labels[status] || status}</span>;
}
