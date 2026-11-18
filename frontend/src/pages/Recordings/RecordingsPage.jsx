import { CrudManager } from '../../components/common/CrudManager';

const columns = [
  { key: 'id', label: 'ID' },
  { key: 'file_name', label: 'Archivo', type: 'primary' },
  { key: 'phone_number', label: 'Número de llamada', type: 'monospace' },
  { key: 'duration_seconds', label: 'Duración (s)', type: 'number' },
  { key: 'url', label: 'URL', type: 'truncate' },
  { key: 'transcription', label: 'Transcripción', type: 'truncate' },
];

const fields = [
  { name: 'call_id', label: 'Llamada', type: 'select', required: true, optionsEndpoint: '/calls', optionsCollection: 'calls', labelKey: 'phone_number' },
  { name: 'file_name', label: 'Nombre del archivo', required: true, maxLength: 200 },
  { name: 'url', label: 'URL de archivo', type: 'url', optional: true, maxLength: 255 },
  { name: 'duration_seconds', label: 'Duración (segundos)', type: 'number', min: 0, step: 1, defaultValue: 0 },
  { name: 'transcription', label: 'Transcripción', type: 'textarea', optional: true, maxLength: 65535 },
];

export function RecordingsPage() {
  return (
    <CrudManager
      title="Grabaciones"
      resource="/recordings"
      collection="recordings"
      columns={columns}
      fields={fields}
      searchPlaceholder="Buscar por archivo o transcripción..."
      description="Este módulo administra los metadatos y URL de grabaciones; la carga y almacenamiento de archivos de audio todavía no está implementada."
    />
  );
}
