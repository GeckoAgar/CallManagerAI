import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Trash2, X } from 'lucide-react';
import api from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { StatusBadge } from './StatusBadge';

function getErrorMessage(error) {
  return error.response?.data?.message || 'No se pudo completar la operación. Inténtalo nuevamente.';
}

function displayValue(value, column) {
  if (value == null || value === '') return '—';
  if (column.type === 'status') return <StatusBadge status={value} />;
  if (column.type === 'date') return new Date(value).toLocaleString();
  return String(value);
}

export function CrudManager({ title, resource, collection, columns, fields, description }) {
  const user = useAuthStore((state) => state.user);
  const isAdmin = user?.roleName === 'ADMIN';
  const [rows, setRows] = useState([]);
  const [optionsByField, setOptionsByField] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [pageError, setPageError] = useState('');
  const [dialogError, setDialogError] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [values, setValues] = useState({});

  const loadRows = useCallback(async () => {
    setPageError('');
    setIsLoading(true);
    try {
      const { data } = await api.get(resource);
      setRows(data[collection] || []);
    } catch (error) {
      setPageError(getErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, [collection, resource]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  useEffect(() => {
    let active = true;
    const optionFields = fields.filter((field) => field.optionsEndpoint && (!field.adminOnly || isAdmin));
    Promise.all(optionFields.map(async (field) => {
      const { data } = await api.get(field.optionsEndpoint);
      return [field.name, data[field.optionsCollection] || []];
    })).then((entries) => {
      if (active) setOptionsByField(Object.fromEntries(entries));
    }).catch((error) => {
      if (active) setPageError(getErrorMessage(error));
    });

    return () => {
      active = false;
    };
  }, [fields, isAdmin]);

  const visibleFields = fields.filter((field) => !field.adminOnly || isAdmin);

  function openCreate() {
    setEditing(null);
    setDialogError('');
    setValues(Object.fromEntries(visibleFields.map((field) => [field.name, field.defaultValue ?? ''])));
    setDialogOpen(true);
  }

  function openEdit(row) {
    setEditing(row);
    setDialogError('');
    setValues(Object.fromEntries(visibleFields.map((field) => [
      field.name,
      field.type === 'password' ? '' : (row[field.name] ?? ''),
    ])));
    setDialogOpen(true);
  }

  async function submitForm(event) {
    event.preventDefault();
    setDialogError('');
    setIsSaving(true);
    const payload = {};

    for (const field of visibleFields) {
      const value = values[field.name];
      if (field.type === 'password' && editing && !value) continue;
      if (value === '' && field.optional) {
        payload[field.name] = null;
        continue;
      }
      if (value === '' && field.type === 'password' && !editing) {
        setDialogError('Completa la contraseña.');
        setIsSaving(false);
        return;
      }
      payload[field.name] = field.type === 'number' && value !== '' ? Number(value) : value;
    }

    try {
      if (editing) {
        await api.patch(`${resource}/${editing.id}`, payload);
      } else {
        await api.post(resource, payload);
      }
      setDialogOpen(false);
      await loadRows();
    } catch (error) {
      setDialogError(getErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteRow(row) {
    if (!window.confirm(`¿Eliminar este registro de ${title.toLowerCase()}? Esta acción no se puede deshacer.`)) return;
    setPageError('');
    try {
      await api.delete(`${resource}/${row.id}`);
      await loadRows();
    } catch (error) {
      setPageError(getErrorMessage(error));
    }
  }

  return (
    <section className="card p-5">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          {description && <p className="mt-1 text-sm text-slate-400">{description}</p>}
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-400"
        >
          <Plus size={16} /> Nuevo
        </button>
      </div>

      {pageError && <p role="alert" className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{pageError}</p>}
      {isLoading ? (
        <p className="py-8 text-center text-sm text-slate-400">Cargando...</p>
      ) : (
        <div className="table-shell overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-950/70 text-slate-400">
              <tr>
                {columns.map((column) => <th key={column.key} className="px-4 py-3">{column.label}</th>)}
                <th className="px-4 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-slate-800">
                  {columns.map((column) => (
                    <td key={column.key} className="px-4 py-3">
                      {displayValue(row[column.key], column)}
                    </td>
                  ))}
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => openEdit(row)} aria-label="Editar" className="rounded-lg border border-slate-700 p-2 text-slate-300 hover:bg-slate-800">
                        <Pencil size={15} />
                      </button>
                      <button type="button" onClick={() => deleteRow(row)} aria-label="Eliminar" className="rounded-lg border border-rose-900/70 p-2 text-rose-300 hover:bg-rose-950">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr><td colSpan={columns.length + 1} className="px-4 py-10 text-center text-slate-500">No hay registros.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {dialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="presentation">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="crud-dialog-title">
            <div className="mb-5 flex items-center justify-between">
              <h4 id="crud-dialog-title" className="text-lg font-semibold text-white">{editing ? 'Editar' : 'Crear'}: {title}</h4>
              <button type="button" onClick={() => setDialogOpen(false)} aria-label="Cerrar" className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <form className="space-y-4" onSubmit={submitForm}>
              <div className="grid gap-4 sm:grid-cols-2">
                {visibleFields.map((field) => (
                  <label key={field.name} className={field.type === 'textarea' ? 'sm:col-span-2' : ''}>
                    <span className="mb-2 block text-sm text-slate-300">{field.label}</span>
                    {field.type === 'select' ? (
                      <select
                        required={field.required && !(editing && field.type === 'password')}
                        value={values[field.name] ?? ''}
                        onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
                        className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-white focus:border-brand-400 focus:outline-none"
                      >
                        <option value="">{field.placeholder || 'Seleccionar...'}</option>
                        {(field.options || optionsByField[field.name] || []).map((option) => (
                          <option key={option[field.valueKey || 'id']} value={option[field.valueKey || 'id']}>
                            {option[field.labelKey || 'name']}
                          </option>
                        ))}
                      </select>
                    ) : field.type === 'textarea' ? (
                      <textarea
                        required={field.required}
                        rows={4}
                        maxLength={field.maxLength}
                        value={values[field.name] ?? ''}
                        onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
                        className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-white focus:border-brand-400 focus:outline-none"
                      />
                    ) : (
                      <input
                        type={field.type || 'text'}
                        required={field.required && !(editing && field.type === 'password')}
                        minLength={field.minLength}
                        maxLength={field.maxLength}
                        min={field.min}
                        max={field.max}
                        step={field.step}
                        placeholder={editing && field.type === 'password' ? 'Dejar vacío para conservar' : ''}
                        value={values[field.name] ?? ''}
                        onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
                        className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-white focus:border-brand-400 focus:outline-none"
                      />
                    )}
                  </label>
                ))}
              </div>

              {dialogError && <p role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{dialogError}</p>}
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setDialogOpen(false)} className="rounded-xl border border-slate-700 px-4 py-2.5 text-sm text-slate-200 hover:bg-slate-800">Cancelar</button>
                <button type="submit" disabled={isSaving} className="rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-400 disabled:opacity-60">
                  {isSaving ? 'Guardando...' : 'Guardar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
