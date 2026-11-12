export function SettingsPage() {
  return (
    <div className="card p-5">
      <h3 className="text-lg font-semibold text-white">Configuración general</h3>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
          <p className="text-sm text-slate-400">Horario laboral</p>
          <p className="mt-2 text-xl font-semibold text-white">Lun - Vie, 08:00 - 18:00</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
          <p className="text-sm text-slate-400">Canal de salida</p>
          <p className="mt-2 text-xl font-semibold text-white">PBX + CRM</p>
        </div>
      </div>
    </div>
  );
}
