import { StatusBadge } from '../../components/common/StatusBadge';

const metrics = [
  { title: 'Llamadas totales', value: '1.284', delta: '+12.4%', tone: 'blue' },
  { title: 'Tasa de resolución', value: '94.8%', delta: '+4.2%', tone: 'green' },
  { title: 'Tiempo promedio', value: '03:42', delta: '-0:16', tone: 'amber' },
  { title: 'Alertas', value: '12', delta: '+2', tone: 'red' },
];

const chartData = [
  { day: 'Lun', calls: 120, answered: 102 },
  { day: 'Mar', calls: 140, answered: 125 },
  { day: 'Mié', calls: 176, answered: 160 },
  { day: 'Jue', calls: 132, answered: 116 },
  { day: 'Vie', calls: 200, answered: 182 },
  { day: 'Sáb', calls: 110, answered: 90 },
];

function StatCard({ title, value, delta, tone = 'blue' }) {
  const toneClasses = {
    blue: 'border-brand-500/20 bg-brand-500/10 text-brand-200',
    green: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200',
    red: 'border-rose-500/20 bg-rose-500/10 text-rose-200',
    amber: 'border-amber-500/20 bg-amber-500/10 text-amber-200',
  };

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-400">{title}</span>
        <div className={`rounded-lg border px-2 py-1 text-xs ${toneClasses[tone]}`}>{delta}</div>
      </div>
      <div className="mt-5 text-3xl font-bold text-white">{value}</div>
    </div>
  );
}

export function DashboardPage() {
  return (
    <div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <StatCard key={metric.title} {...metric} />
        ))}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <div className="card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-white">Volumen de llamadas</h3>
            <span className="text-sm text-slate-400">Últimos 7 días</span>
          </div>
          <div className="h-72">
            <div className="flex h-full items-end gap-2">
              {chartData.map((item) => (
                <div key={item.day} className="flex flex-1 flex-col items-center gap-2">
                  <div className="flex h-full w-full items-end justify-center gap-1">
                    <div className="w-1/2 rounded-t-md bg-brand-400" style={{ height: `${item.calls / 2.2}%` }}></div>
                    <div className="w-1/2 rounded-t-md bg-emerald-400" style={{ height: `${item.answered / 2.2}%` }}></div>
                  </div>
                  <span className="text-xs text-slate-400">{item.day}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="card p-5">
          <h3 className="mb-4 text-lg font-semibold text-white">Resumen operativo</h3>
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
              <p className="text-sm text-slate-400">Horas pico</p>
              <p className="mt-2 text-2xl font-bold text-white">10:00 - 12:00</p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
              <p className="text-sm text-slate-400">NPS promedio</p>
              <p className="mt-2 text-2xl font-bold text-white">72 / 100</p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
              <p className="text-sm text-slate-400">Escaladas</p>
              <p className="mt-2 text-2xl font-bold text-white">8</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
