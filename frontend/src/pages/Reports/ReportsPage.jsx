const summary = [
  { label: 'Satisfacción', value: '92%' },
  { label: 'Resolución', value: '89%' },
  { label: 'Promedio', value: '3m 42s' },
  { label: 'Escaladas', value: '8' },
];

export function ReportsPage() {
  return (
    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
      {summary.map((item) => (
        <div key={item.label} className="card p-5">
          <p className="text-sm text-slate-400">{item.label}</p>
          <p className="mt-3 text-3xl font-bold text-white">{item.value}</p>
        </div>
      ))}
    </div>
  );
}
