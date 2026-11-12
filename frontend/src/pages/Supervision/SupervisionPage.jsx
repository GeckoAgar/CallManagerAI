import { StatusBadge } from '../../components/common/StatusBadge';

const queue = [
  { id: 1, agent: 'Ana López', call: '+56912345678', status: 'monitoring' },
  { id: 2, agent: 'Luis Fernández', call: '+56987654321', status: 'waiting' },
];

export function SupervisionPage() {
  return (
    <div className="card p-5">
      <h3 className="mb-4 text-lg font-semibold text-white">Cola de supervisión</h3>
      <div className="space-y-3">
        {queue.map((item) => (
          <div key={item.id} className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/60 p-4">
            <div>
              <p className="font-medium text-white">{item.agent}</p>
              <p className="text-sm text-slate-400">Llamada {item.call}</p>
            </div>
            <StatusBadge status={item.status} />
          </div>
        ))}
      </div>
    </div>
  );
}
