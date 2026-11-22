import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import { getActionErrorMessage } from '../../services/actionError';
import { useAuthStore } from '../../store/authStore';

const modules = [
  { resource: '/contacts', label: 'Contactos', describe: (row) => [row.name, row.phone || row.email].filter(Boolean).join(' · ') },
  { resource: '/users', label: 'Usuarios', admin: true, describe: (row) => [row.name, row.email].filter(Boolean).join(' · ') },
  { resource: '/roles', label: 'Roles', admin: true, describe: (row) => row.name },
  { resource: '/calls', label: 'Llamadas', describe: (row) => [`#${row.id}`, row.contact_name, row.phone_number].filter(Boolean).join(' · ') },
  { resource: '/recordings', label: 'Grabaciones', describe: (row) => [`#${row.id}`, row.file_name, row.phone_number].filter(Boolean).join(' · ') },
];

export function GlobalSearch() {
  const navigate = useNavigate();
  const roleName = useAuthStore((state) => state.user?.roleName);
  const containerRef = useRef(null);
  const resultsRef = useRef(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const term = query.trim();
  const results = groups.flatMap((group) => group.items);

  useEffect(() => {
    if (open && activeIndex >= 0) {
      resultsRef.current?.querySelector(`#global-search-result-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex, open]);

  useEffect(() => {
    function closeOutside(event) {
      if (!containerRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, []);

  useEffect(() => {
    setGroups([]);
    setError('');
    setActiveIndex(-1);
    if (!open || term.length < 2) {
      setLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    let active = true;
    setLoading(true);
    const timeout = window.setTimeout(async () => {
      try {
        const allowed = modules.filter((module) => !module.admin || roleName === 'ADMIN');
        const responses = await Promise.all(allowed.map((module) => api.get(module.resource, {
          params: { page: 1, limit: 10, search: term },
          signal: controller.signal,
        })));
        const nextGroups = allowed.map((module, index) => {
          const data = responses[index].data;
          if (!Array.isArray(data.data)) throw new Error('Respuesta de búsqueda inválida.');
          return {
            label: module.label,
            items: data.data.map((row) => ({
              id: row.id,
              resource: module.resource,
              label: module.describe(row),
              module: module.label,
            })),
          };
        }).filter((group) => group.items.length);
        if (active) setGroups(nextGroups);
      } catch (requestError) {
        if (active) setError(getActionErrorMessage(requestError));
      } finally {
        if (active) setLoading(false);
      }
    }, 350);

    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [term, open, roleName]);

  function selectResult(result) {
    const params = new URLSearchParams({ search: term, highlight: String(result.id) });
    setOpen(false);
    navigate(`${result.resource}?${params}`);
  }

  function handleKeyDown(event) {
    if (event.key === 'Escape') {
      setOpen(false);
    } else if (event.key === 'ArrowDown' && results.length) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => (index + 1) % results.length);
    } else if (event.key === 'ArrowUp' && results.length) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => (index <= 0 ? results.length - 1 : index - 1));
    } else if (event.key === 'Enter' && open && results.length) {
      event.preventDefault();
      selectResult(results[Math.max(0, activeIndex)]);
    }
  }

  let resultIndex = -1;
  return (
    <div ref={containerRef} className="relative min-w-0 flex-1 sm:w-full sm:max-w-md">
      <div className="flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 focus-within:border-slate-400 focus-within:ring-1 focus-within:ring-slate-400">
        <Search size={18} className="shrink-0 text-slate-400" aria-hidden="true" />
        <input
          aria-label="Buscar en el sistema"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls="global-search-results"
          aria-activedescendant={open && activeIndex >= 0 ? `global-search-result-${activeIndex}` : undefined}
          autoComplete="off"
          maxLength={100}
          value={query}
          onChange={(event) => { setGroups([]); setActiveIndex(-1); setQuery(event.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          className="global-search-input w-full min-w-0 bg-transparent text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none"
          placeholder="Buscar en el sistema..."
        />
      </div>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 max-h-96 w-full overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 p-2 shadow-soft">
          <div role="status" aria-live="polite" className="px-2 py-1 text-xs text-slate-400">
            {term.length < 2 ? 'Escribe al menos 2 caracteres.' : loading ? 'Buscando...' : error || (results.length ? `${results.length} resultados` : 'Sin coincidencias.')}
          </div>
          <ul ref={resultsRef} id="global-search-results" role="listbox" aria-label="Resultados de búsqueda">
            {!loading && !error && groups.map((group) => (
              <li key={group.label} role="presentation">
                <p className="px-2 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-brand-300">{group.label}</p>
                <ul role="group" aria-label={group.label}>
                  {group.items.map((result) => {
                    resultIndex += 1;
                    const index = resultIndex;
                    return (
                      <li
                        key={`${result.resource}-${result.id}`}
                        id={`global-search-result-${index}`}
                        role="option"
                        aria-selected={activeIndex === index}
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => selectResult(result)}
                        className={`cursor-pointer rounded-md px-2 py-2 text-sm text-slate-100 ${activeIndex === index ? 'bg-slate-700' : 'hover:bg-slate-800'}`}
                      >
                        {result.label}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
