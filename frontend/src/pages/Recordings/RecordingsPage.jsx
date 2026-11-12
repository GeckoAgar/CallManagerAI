import { CrudManager } from '../../components/common/CrudManager';

const columns = [
  { key: 'id', label: 'ID' },
  { key: 'file_name', label: 'Archivo' },
  { key: 'phone_number', label: 'Número de llamada' },
  { key: 'duration_seconds', label: 'Duración (s)' },
  { key: 'url', label: 'URL' },
  { key: 'transcription', label: 'Transcripción' },
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
      description="Este módulo administra los metadatos y URL de grabaciones; la carga y almacenamiento de archivos de audio todavía no está implementada."
    />
  );
}
