import { useEffect, useRef, useState } from 'react';
import { AlertCircle, ChevronLeft, ChevronRight, Database, LoaderCircle, Pencil, Plus, RotateCcw, Search, Trash2, X } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import api from '../../services/api';
import { getActionErrorMessage } from '../../services/actionError';
import { useAuthStore } from '../../store/authStore';
import { useToastStore } from '../../store/toastStore';
import { StatusBadge } from './StatusBadge';

const resourceMessages = {
  '/users': { name: 'Usuario', created: 'creado', updated: 'actualizado', deleted: 'eliminado' },
  '/roles': { name: 'Rol', created: 'creado', updated: 'actualizado', deleted: 'eliminado' },
  '/contacts': { name: 'Contacto', created: 'creado', updated: 'actualizado', deleted: 'eliminado' },
  '/calls': { name: 'Llamada', created: 'creada', updated: 'actualizada', deleted: 'eliminada' },
  '/recordings': { name: 'Grabación', created: 'creada', updated: 'actualizada', deleted: 'eliminada' },
};

function getErrorMessage(error) {
  if (error.response || error.request) return getActionErrorMessage(error);
  return 'No se pudo completar la operación. Inténtalo nuevamente.';
}

function displayValue(value, column) {
  if (value == null || value === '') return '—';
  if (column.type === 'status') return <StatusBadge status={value} />;
  if (column.type === 'date') return new Date(value).toLocaleString();
  if (column.type === 'role') {
    const roleClass = value === 'ADMIN'
      ? 'border-brand-500/30 bg-brand-500/10 text-brand-200'
      : 'border-slate-600 bg-slate-800 text-slate-200';
    return <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold tracking-wide ${roleClass}`}>{value}</span>;
  }
  if (column.type === 'direction') {
    const isInbound = value === 'inbound';
    const directionClass = isInbound
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
      : value === 'outbound'
        ? 'border-brand-500/30 bg-brand-500/10 text-brand-200'
        : 'border-slate-600 bg-slate-800 text-slate-200';
    const directionLabel = isInbound ? 'Entrante' : value === 'outbound' ? 'Saliente' : String(value);
    return <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-medium ${directionClass}`}>{directionLabel}</span>;
  }
  if (column.type === 'primary') return <span className="font-medium text-white">{String(value)}</span>;
  if (column.type === 'monospace') return <span className="font-mono text-xs tabular-nums text-slate-200">{String(value)}</span>;
  if (column.type === 'truncate') {
    return <span className="block max-w-[18rem] truncate" title={String(value)}>{String(value)}</span>;
  }
  if (column.type === 'number') return <span className="tabular-nums">{String(value)}</span>;
  return String(value);
}

function getPageItems(currentPage, totalPages) {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);

  const pages = [...new Set([1, currentPage - 1, currentPage, currentPage + 1, totalPages])]
    .filter((page) => page >= 1 && page <= totalPages)
    .sort((left, right) => left - right);

  return pages.reduce((items, page, index) => {
    if (index > 0) {
      const gap = page - pages[index - 1];
      if (gap === 2) items.push(pages[index - 1] + 1);
      if (gap > 2) items.push(`ellipsis-${pages[index - 1]}-${page}`);
    }
    items.push(page);
    return items;
  }, []);
}

export function CrudManager({ title, resource, columns, fields, description, searchPlaceholder, softDelete = false, showDeleted = false }) {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const selectedId = showDeleted ? null : params.get('highlight');
  const selectedSearch = params.get('search') || '';
  const selectedRowRef = useRef(null);
  const focusedLocationRef = useRef(null);
  const user = useAuthStore((state) => state.user);
  const notify = useToastStore((state) => state.notify);
  const isAdmin = user?.roleName === 'ADMIN';
  const [rows, setRows] = useState([]);
  const [loadedQuery, setLoadedQuery] = useState(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [searchInput, setSearchInput] = useState(selectedId ? selectedSearch : '');
  const [searchTerm, setSearchTerm] = useState(selectedId ? selectedSearch : '');
  const [refreshVersion, setRefreshVersion] = useState(0);
  const skipPageReload = useRef(false);
  const [optionsByField, setOptionsByField] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [pageError, setPageError] = useState('');
  const [dialogError, setDialogError] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [values, setValues] = useState({});
  const [deletingRow, setDeletingRow] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [restoringId, setRestoringId] = useState(null);

  useEffect(() => {
    if (!selectedId) return;
    setSearchInput(selectedSearch);
    setSearchTerm(selectedSearch);
    setPage(1);
  }, [location.key, selectedId, selectedSearch]);

  useEffect(() => {
    if (!isLoading && selectedId && focusedLocationRef.current !== location.key &&
        loadedQuery?.search === selectedSearch && loadedQuery.page === 1 && searchTerm === selectedSearch &&
        searchInput.trim() === selectedSearch && selectedRowRef.current) {
      selectedRowRef.current.scrollIntoView({ block: 'center', behavior: 'auto' });
      selectedRowRef.current.focus({ preventScroll: true });
      focusedLocationRef.current = location.key;
    }
  }, [isLoading, rows, loadedQuery, location.key, selectedId, selectedSearch, searchInput, searchTerm]);

  useEffect(() => {
    const nextSearchTerm = searchInput.trim();
    if (nextSearchTerm === searchTerm) return undefined;

    const timeout = setTimeout(() => {
      setSearchTerm(nextSearchTerm);
      setPage(1);
    }, 350);

    return () => clearTimeout(timeout);
  }, [searchInput, searchTerm]);

  useEffect(() => {
    if (skipPageReload.current) {
      skipPageReload.current = false;
      return undefined;
    }

    let active = true;
    const controller = new AbortController();
    setPageError('');
    setIsLoading(true);

    const params = { page, limit };
    if (showDeleted) params.deleted = 'true';
    if (searchTerm) params.search = searchTerm;

    api.get(resource, { params, signal: controller.signal })
      .then(({ data }) => {
        if (!Array.isArray(data.data) || !Number.isInteger(data.total) ||
            !Number.isInteger(data.page) || !Number.isInteger(data.limit) ||
            !Number.isInteger(data.totalPages)) {
          throw new Error('La respuesta de paginación no es válida.');
        }
        if (!active) return;
        setRows(data.data);
        setLoadedQuery({ search: searchTerm, page: data.page });
        setTotal(data.total);
        if (data.page !== page) {
          skipPageReload.current = true;
          setPage(data.page);
        }
      })
      .catch((error) => {
        if (!active) return;
        setRows([]);
        setTotal(0);
        setPageError(getErrorMessage(error));
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [limit, page, refreshVersion, resource, searchTerm, showDeleted]);

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
  const resourceLabel = title.replace(/^Gestión de /i, '').toLowerCase();
  const messages = resourceMessages[resource] || { name: 'Registro', created: 'creado', updated: 'actualizado', deleted: 'eliminado' };

  function showValidationWarning() {
    const message = 'Revisa los campos obligatorios y los datos ingresados.';
    if (!useToastStore.getState().toasts.some((toast) => toast.type === 'warning' && toast.message === message && !toast.exiting)) {
      notify('warning', message);
    }
  }

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
        showValidationWarning();
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
      notify('success', `${messages.name} ${editing ? messages.updated : messages.created} correctamente.`);
      setDialogOpen(false);
      if (!editing && page !== 1) setPage(1);
      else setRefreshVersion((version) => version + 1);
    } catch (error) {
      setDialogError(getErrorMessage(error));
      notify('error', getActionErrorMessage(error), { announce: false });
    } finally {
      setIsSaving(false);
    }
  }

  function requestDelete(row) {
    setDeleteError('');
    setDeletingRow(row);
  }

  async function confirmDelete() {
    if (!deletingRow || isDeleting) return;
    setPageError('');
    setDeleteError('');
    setIsDeleting(true);
    try {
      await api.delete(`${resource}/${deletingRow.id}`);
      notify('success', `${messages.name} ${messages.deleted} correctamente.`);
      setDeletingRow(null);
      if (rows.length === 1 && page > 1) setPage((currentPage) => currentPage - 1);
      else setRefreshVersion((version) => version + 1);
    } catch (error) {
      setDeleteError(getErrorMessage(error));
      notify('error', getActionErrorMessage(error), { announce: false });
    } finally {
      setIsDeleting(false);
    }
  }

  async function restore(row) {
    if (restoringId !== null) return;
    setPageError('');
    setRestoringId(row.id);
    try {
      await api.post(`${resource}/${row.id}/restore`);
      notify('success', 'Contacto restaurado correctamente.');
      if (rows.length === 1 && page > 1) setPage((currentPage) => currentPage - 1);
      else setRefreshVersion((version) => version + 1);
    } catch (error) {
      setPageError(getErrorMessage(error));
      notify('error', getActionErrorMessage(error), { announce: false });
    } finally {
      setRestoringId(null);
    }
  }

  const tableMinWidthClass = columns.length >= 6 ? 'min-w-[900px]' : columns.length >= 4 ? 'min-w-[720px]' : 'min-w-[560px]';
  const startRecord = total === 0 ? 0 : (page - 1) * limit + 1;
  const endRecord = Math.min(page * limit, total);
  const totalPages = Math.ceil(total / limit);

  return (
    <section className="card p-4 sm:p-5">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-brand-300">Gestión de datos</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-white sm:text-2xl">{title}</h1>
          {description && <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">{description}</p>}
        </div>
        {!showDeleted && (
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300"
          >
            <Plus size={16} aria-hidden="true" /> Nuevo registro
          </button>
        )}
      </div>

      <div className="mb-4">
        <label htmlFor="crud-search" className="sr-only">Buscar en {title.toLowerCase()}</label>
        <div className="relative w-full sm:max-w-xl">
          <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden="true" />
          <input
            id="crud-search"
            type="text"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder={searchPlaceholder || 'Buscar registros...'}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2.5 pl-10 pr-10 text-sm text-slate-100 placeholder:text-slate-500 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400/40"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => setSearchInput('')}
              aria-label="Limpiar búsqueda"
              title="Limpiar búsqueda"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-300"
            >
              <X size={15} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {pageError && (
        <div role="alert" className="mb-4 flex items-start gap-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          <AlertCircle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
          <p>{pageError}</p>
          <button type="button" onClick={() => setRefreshVersion((version) => version + 1)} className="ml-auto shrink-0 font-semibold underline underline-offset-2">
            Reintentar
          </button>
        </div>
      )}
      {isLoading ? (
        <div className="card flex items-center justify-center gap-3 px-4 py-12 text-sm text-slate-400" role="status">
          <LoaderCircle size={18} className="animate-spin text-brand-300" aria-hidden="true" />
          <span>Cargando registros...</span>
        </div>
      ) : (
        <div className="table-shell overflow-x-auto">
          {rows.length ? (
            <table className={`${tableMinWidthClass} w-full text-left text-sm text-slate-300`}>
              <thead className="bg-slate-950/80 text-[11px] uppercase tracking-wide text-slate-400">
                <tr>
                  {columns.map((column) => <th key={column.key} scope="col" className="whitespace-nowrap px-4 py-3 font-semibold">{column.label}</th>)}
                  <th scope="col" className="whitespace-nowrap px-4 py-3 text-right font-semibold">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    ref={selectedId === String(row.id) && searchTerm === selectedSearch ? selectedRowRef : null}
                    tabIndex={selectedId === String(row.id) && searchTerm === selectedSearch ? -1 : undefined}
                    className={`border-t border-slate-800/80 transition-colors hover:bg-slate-800/30 ${selectedId === String(row.id) && searchTerm === selectedSearch ? 'bg-brand-500/15 outline outline-2 outline-brand-400' : ''}`}
                  >
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        className={`px-4 py-3.5 align-top ${column.type === 'truncate' ? 'max-w-[18rem]' : ''} ${column.type === 'number' ? 'tabular-nums text-slate-200' : ''}`}
                      >
                        {displayValue(row[column.key], column)}
                      </td>
                    ))}
                    <td className="px-4 py-3.5 align-top">
                      <div className="flex justify-end gap-2">
                        {showDeleted ? (
                          <button
                            type="button"
                            onClick={() => restore(row)}
                            disabled={restoringId !== null}
                            aria-label={`Restaurar registro ${row.id}`}
                            title="Restaurar"
                            className="inline-flex items-center gap-2 rounded-md border border-emerald-700 px-3 py-2 text-emerald-200 hover:bg-emerald-950 disabled:cursor-wait disabled:opacity-60"
                          >
                            <RotateCcw size={15} aria-hidden="true" />
                            {restoringId === row.id ? 'Restaurando...' : 'Restaurar'}
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => openEdit(row)}
                              aria-label={`Editar registro ${row.id}`}
                              title="Editar"
                              className="rounded-md border border-slate-700 p-2 text-slate-300 transition-colors hover:border-brand-500/50 hover:bg-slate-800 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300"
                            >
                              <Pencil size={15} aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              onClick={() => requestDelete(row)}
                              aria-label={`Eliminar registro ${row.id}`}
                              title="Eliminar"
                              className="rounded-md border border-rose-900/70 p-2 text-rose-300 transition-colors hover:border-rose-500/50 hover:bg-rose-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-300"
                            >
                              <Trash2 size={15} aria-hidden="true" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : pageError ? null : (
            <div className="flex flex-col items-center px-5 py-12 text-center">
              <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-slate-400">
                <Database size={20} aria-hidden="true" />
              </div>
              <p className="font-medium text-slate-200">
                {searchTerm ? 'No se encontraron coincidencias' : 'No hay registros'}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                {searchTerm ? 'Prueba con otro término de búsqueda.' : 'Cuando existan datos, aparecerán en esta lista.'}
              </p>
            </div>
          )}
        </div>
      )}

      {!isLoading && !pageError && (
        <div className="mt-4 flex flex-col gap-3 border-t border-slate-800 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-400">
            <p aria-live="polite">Mostrando {startRecord}–{endRecord} de {total} registros</p>
            <label className="flex items-center gap-2">
              <span>Por página</span>
              <select
                value={limit}
                onChange={(event) => {
                  setPage(1);
                  setLimit(Number(event.target.value));
                }}
                className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-200 focus:border-brand-400 focus:outline-none"
              >
                {[10, 25, 50].map((pageSize) => <option key={pageSize} value={pageSize}>{pageSize}</option>)}
              </select>
            </label>
          </div>

          <nav aria-label="Paginación de registros" className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() => setPage((currentPage) => Math.max(1, currentPage - 1))}
              disabled={isLoading || page <= 1}
              className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2.5 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft size={16} aria-hidden="true" /> Anterior
            </button>
            {getPageItems(page, totalPages).map((pageItem) => (
              typeof pageItem === 'number' ? (
                <button
                  key={pageItem}
                  type="button"
                  onClick={() => setPage(pageItem)}
                  aria-current={pageItem === page ? 'page' : undefined}
                  aria-label={`Página ${pageItem}`}
                  disabled={isLoading || pageItem === page}
                  className={`min-w-9 rounded-md border px-2.5 py-2 text-sm disabled:cursor-default ${
                    pageItem === page
                      ? 'border-brand-500/50 bg-brand-500/15 font-semibold text-brand-200'
                      : 'border-slate-700 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  {pageItem}
                </button>
              ) : (
                <span key={pageItem} className="px-1 text-slate-500" aria-hidden="true">…</span>
              )
            ))}
            <button
              type="button"
              onClick={() => setPage((currentPage) => Math.min(totalPages, currentPage + 1))}
              disabled={isLoading || totalPages === 0 || page >= totalPages}
              className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2.5 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Siguiente <ChevronRight size={16} aria-hidden="true" />
            </button>
          </nav>
        </div>
      )}

      {dialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm sm:p-6" role="presentation">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-4 shadow-soft sm:p-6" role="dialog" aria-modal="true" aria-labelledby="crud-dialog-title">
            <div className="mb-5 flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-brand-300">{editing ? 'Editar registro' : 'Nuevo registro'}</p>
                <h2 id="crud-dialog-title" className="mt-1 text-lg font-semibold text-white">{title}</h2>
              </div>
              <button type="button" onClick={() => setDialogOpen(false)} aria-label="Cerrar" title="Cerrar" className="rounded-md border border-slate-700 p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white">
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <form
              className="space-y-5"
              onSubmit={submitForm}
              onInvalid={(event) => {
                if (event.target === event.currentTarget.querySelector(':invalid')) showValidationWarning();
              }}
              aria-describedby={dialogError ? 'crud-dialog-error' : undefined}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                {visibleFields.map((field) => (
                  <label key={field.name} className={field.type === 'textarea' ? 'sm:col-span-2' : ''}>
                    <span className="mb-2 block text-sm font-medium text-slate-200">
                      {field.label}
                      {field.required && !(editing && field.type === 'password') && <span className="ml-1 text-brand-300" aria-hidden="true">*</span>}
                    </span>
                    {field.type === 'select' ? (
                      <select
                        required={field.required && !(editing && field.type === 'password')}
                        value={values[field.name] ?? ''}
                        onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
                        className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-white focus:border-brand-400 focus:outline-none"
                      >
                        <option value="">{field.placeholder || 'Seleccionar...'}</option>
                        {editing && field.currentLabelKey && values[field.name] &&
                          !(field.options || optionsByField[field.name] || []).some(
                            (option) => String(option[field.valueKey || 'id']) === String(values[field.name])
                          ) && (
                            <option value={values[field.name]}>
                              {editing[field.currentLabelKey] || `ID ${values[field.name]}`} (no disponible)
                            </option>
                          )}
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

              {dialogError && (
                <div id="crud-dialog-error" role="alert" className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-sm text-rose-200">
                  <AlertCircle size={17} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <p>{dialogError}</p>
                </div>
              )}
              <div className="flex flex-col gap-2 border-t border-slate-800 pt-4 sm:flex-row sm:justify-end sm:gap-3">
                <button type="button" onClick={() => setDialogOpen(false)} className="rounded-lg border border-slate-700 px-4 py-2.5 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300">Cancelar</button>
                <button type="submit" disabled={isSaving} className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300 disabled:cursor-wait disabled:opacity-60">
                  {isSaving && <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />}
                  {isSaving ? 'Guardando...' : 'Guardar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deletingRow && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" role="presentation">
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-soft sm:p-6" role="alertdialog" aria-modal="true" aria-labelledby="delete-dialog-title" aria-describedby={deleteError ? 'delete-dialog-description delete-dialog-error' : 'delete-dialog-description'}>
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-300">
              <Trash2 size={18} aria-hidden="true" />
            </div>
            <h2 id="delete-dialog-title" className="text-lg font-semibold text-white">Confirmar eliminación</h2>
            <p id="delete-dialog-description" className="mt-2 text-sm leading-6 text-slate-300">
              {softDelete
                ? 'El contacto dejará de aparecer en la lista habitual. Se conservarán sus datos y llamadas; un administrador podrá restaurarlo.'
                : `¿Eliminar este registro de ${resourceLabel}? Esta acción no se puede deshacer.`}
            </p>
            {deleteError && (
              <div id="delete-dialog-error" role="alert" className="mt-4 flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-sm text-rose-200">
                <AlertCircle size={17} className="mt-0.5 shrink-0" aria-hidden="true" />
                <p>{deleteError}</p>
              </div>
            )}
            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setDeletingRow(null)}
                disabled={isDeleting}
                className="rounded-lg border border-slate-700 px-4 py-2.5 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-800 disabled:cursor-wait disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={isDeleting}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-rose-500 disabled:cursor-wait disabled:opacity-60"
              >
                {isDeleting && <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />}
                {isDeleting ? 'Eliminando...' : 'Eliminar registro'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
