# CallManagerAI

Aplicación web para la gestión de comunicaciones y llamadas. El proyecto utiliza React y Vite en el frontend, Node.js y Express en la API, MySQL como base de datos y Twilio Voice para el softphone.

## Información académica

- **Autores:** Benjamin Ocaranza Iramain y Gerardo Agustin Moretta
- **Comisión:** 7
- **Facultad:** Universidad Tecnológica Nacional (UTN)

## Funcionalidades

- Registro e inicio de sesión con contraseñas protegidas mediante bcrypt y autenticación con JWT.
- Recuperación de sesión y consulta del usuario autenticado.
- Control de acceso y permisos por rol (`ADMIN` y `USER`) verificados en el backend.
- CRUD de usuarios, roles, contactos y llamadas.
- Gestión de grabaciones como metadatos asociados a llamadas; la carga y almacenamiento de audio no están implementados.
- Softphone de navegador integrado con Twilio Voice: llamadas salientes y entrantes, estado de agente, atender, rechazar, silenciar, colgar e historial.
- Paneles de reportes y supervisión.

Las llamadas reales requieren una cuenta de Twilio configurada y una URL HTTPS pública para recibir sus webhooks. En el entorno de desarrollo se comprobó una llamada saliente real; configura y prueba las llamadas entrantes por separado.

## Requisitos

- Node.js y npm.
- MySQL Server.
- MySQL Workbench para ejecutar o revisar los scripts SQL.
- Cuenta de Twilio con Voice habilitado para usar el softphone.
- ngrok u otro túnel HTTPS para que Twilio pueda acceder al backend durante el desarrollo local.

## Configuración de la base de datos

1. Inicia MySQL Server y abre tu conexión en MySQL Workbench.
2. Ejecuta `backend/database/schema.sql` para crear las tablas de una instalación nueva. El esquema utiliza `CREATE ... IF NOT EXISTS` y `INSERT IGNORE`; no borra tablas ni filas existentes.
3. Opcionalmente, ejecuta `backend/database/seeds.sql` para insertar contactos de ejemplo.
4. Si ya tienes una base creada con una versión anterior, no vuelvas a crearla ni la elimines. Revisa las migraciones indicadas abajo y ejecútalas una sola vez si todavía no están aplicadas.

### Migraciones para una base existente

Ejecuta cada migración pendiente en Workbench, seleccionando la base `callmanagerai`:

- `backend/database/migrations/002_contact_owner.sql`: agrega el propietario de contactos. Los registros anteriores se conservan con propietario `NULL`; un administrador puede asignarlos.
- `backend/database/migrations/003_softphone.sql`: agrega el identificador de llamadas de Twilio y la tabla de presencia de agentes. No elimina llamadas ni usuarios.

Las migraciones no deben volver a ejecutarse si sus cambios ya están presentes en la base.

## Variables de entorno

Desde la raíz del proyecto, crea `.env` a partir de la plantilla:

```powershell
Copy-Item .env.example .env
```

Configura en `.env` las credenciales de MySQL (`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`) y una clave JWT aleatoria de al menos 32 caracteres. Puedes generarla con:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

No uses los valores de ejemplo en un entorno real. **No subas ni compartas `.env`**: contiene credenciales de la base y secretos de Twilio. `.gitignore` excluye este archivo del repositorio.

## Configurar Twilio para el softphone

En `.env`, completa las variables del servidor:

```env
TWILIO_ACCOUNT_SID=
TWILIO_API_KEY_SID=
TWILIO_API_KEY_SECRET=
TWILIO_TWIML_APP_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
TWILIO_WEBHOOK_BASE_URL=
```

- Crea una API Key **Standard** y una TwiML App desde Twilio Console.
- `TWILIO_PHONE_NUMBER` es el número Twilio habilitado para voz, en formato internacional E.164, por ejemplo `+549...`.
- `TWILIO_WEBHOOK_BASE_URL` es solamente el origen HTTPS público, sin ruta ni barra final, por ejemplo `https://tu-dominio.ngrok-free.dev`.
- Mantén privados `TWILIO_API_KEY_SECRET` y `TWILIO_AUTH_TOKEN`; solo se utilizan en el backend.

Para desarrollo local:

1. Inicia la aplicación como se describe en **Instalación y ejecución**.
2. Abre otra terminal y ejecuta `ngrok http 4000`. Mantén esa terminal abierta.
3. Copia el dominio HTTPS que ngrok muestra como `Forwarding` y úsalo en `TWILIO_WEBHOOK_BASE_URL`.
4. En la TwiML App de Twilio y en la configuración de voz del número, configura la Voice URL `https://<dominio-publico>/api/softphone/webhooks/voice` con método **HTTP POST**.
5. Si cambias `.env`, reinicia el backend para que cargue los nuevos valores.

La firma de los webhooks se valida con el Auth Token de Twilio. El navegador debe permitir el micrófono; `localhost` y el dominio HTTPS son contextos seguros. Las cuentas Twilio de prueba pueden limitar las llamadas salientes a números verificados.

En CallManagerAI, inicia sesión, abre **Softphone**, concede acceso al micrófono y selecciona **Conectarme y quedar disponible**.

## Instalación y ejecución

Desde la raíz del proyecto:

```powershell
npm install
npm --prefix backend install
npm --prefix frontend install
npm run dev
```

`npm run dev` inicia la API y Vite. El backend usa el puerto `4000`; Vite normalmente usa `5173`, pero elegirá el siguiente puerto libre si ese ya está ocupado. Abre la dirección **Local** que Vite imprima en la terminal. Mantén abierta la terminal mientras uses la aplicación.

La API verifica la conexión a MySQL al iniciarse. Si MySQL no está activo o la configuración falta, revisa el servicio y `.env`.

Para crear el primer administrador de forma local:

```powershell
npm --prefix backend run create-admin
```

El comando solicita la contraseña sin mostrarla y no modifica una cuenta existente. El registro público siempre asigna el rol `USER`.

## API y permisos

### Autenticación

- `POST /api/auth/register` — registro público como `USER`.
- `POST /api/auth/login` — autenticación y emisión de JWT.
- `GET /api/auth/me` — datos del usuario autenticado.
- `GET /api/users` — listado completo exclusivo para `ADMIN`.
- `GET /api/users/:id` — `ADMIN` puede consultar cualquier perfil; `USER`, únicamente el propio.

### Módulos

- `/api/users` — listado, creación, edición y eliminación solo para `ADMIN`.
- `/api/roles` — CRUD solo para `ADMIN`; los roles reservados `ADMIN` y `USER` no se pueden renombrar ni eliminar.
- `/api/contacts` — CRUD; `USER` solo ve y modifica sus contactos.
- `/api/calls` — CRUD; `USER` solo accede a llamadas asignadas a su cuenta.
- `/api/recordings` — CRUD de metadatos; `USER` solo accede a grabaciones de sus llamadas.
- `/api/softphone` — token temporal de Twilio Voice, estado de agente, webhooks y llamadas.

La API valida los JWT y consulta el estado y rol actuales del usuario en la base. Las operaciones sensibles y los permisos se verifican en el servidor, no solamente en la interfaz.

## Esquema y datos

- Esquema para instalaciones nuevas: `backend/database/schema.sql`.
- Datos de ejemplo: `backend/database/seeds.sql`.
- Migraciones para bases existentes: `backend/database/migrations/`.
