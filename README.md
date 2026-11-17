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
- CRUD de usuarios, roles, contactos, llamadas y grabaciones como metadatos asociados a llamadas; las grabaciones no se cargan ni almacenan como archivos de audio.
- Softphone de navegador integrado con Twilio Voice: llamadas salientes y entrantes, estado de agente, atender, rechazar, silenciar, colgar e historial.
- Paneles de reportes y supervisión.

Las llamadas reales requieren una cuenta de Twilio configurada y una URL HTTPS pública para recibir sus webhooks. En el entorno de desarrollo se comprobó una llamada saliente real y el teléfono de destino sonó. Esta prueba no demuestra por sí sola que las llamadas entrantes estén verificadas en un entorno real; configúralas y pruébalas por separado.

## Requisitos

- Node.js y npm.
- MySQL Server.
- MySQL Workbench para ejecutar o revisar los scripts SQL.
- Cuenta de Twilio con Voice habilitado para usar el softphone.
- ngrok u otro túnel HTTPS para que Twilio pueda acceder al backend durante el desarrollo local.

## Configuración de la base de datos

### A. Instalación nueva

1. Inicia MySQL Server y abre la conexión del servidor en MySQL Workbench.
2. Desde la raíz del proyecto, abre y ejecuta `backend/database/schema.sql`. El script crea la base `callmanagerai`, sus tablas, relaciones y roles iniciales; no hace falta crear la base por separado.
3. Opcionalmente, ejecuta `backend/database/seeds.sql` para insertar contactos de ejemplo.
4. Crea el archivo local `.env` a partir de `.env.example` y configura las variables requeridas. Consulta **Variables de entorno** para los detalles.
5. Desde la raíz del proyecto, instala las dependencias e inicia la aplicación:

   ```powershell
   npm install
   npm --prefix backend install
   npm --prefix frontend install
   npm run dev
   ```

   El último comando inicia la API y Vite. El backend debe poder conectarse a MySQL para arrancar correctamente.

### B. Actualización de una base de datos existente

1. Realiza y verifica una copia de seguridad antes de modificar la base.
2. En MySQL Workbench, selecciona la base `callmanagerai`. No la elimines ni ejecutes `schema.sql` como sustituto de una actualización: el esquema crea tablas que faltan, pero no actualiza la definición de las tablas existentes.
3. La carpeta de migraciones contiene las versiones 002 a 006; no hay un archivo 001. Revisa la estructura actual y ejecuta **solo las migraciones pendientes**, en este orden:

   1. `backend/database/migrations/002_contact_owner.sql` — agrega `contacts.owner_id` y su clave foránea a `users`. Los contactos existentes quedan con propietario `NULL`. Requiere que existan las tablas `contacts` y `users`.
   2. `backend/database/migrations/003_softphone.sql` — agrega `calls.provider_call_sid` con índice único y crea `agent_presence`. Requiere que existan `calls` y `users`. **No es idempotente**: no la ejecutes si la columna o el índice ya están creados; si hubo una ejecución parcial, inspecciona el estado antes de continuar.
   3. `backend/database/migrations/004_surveillance_queue_call_unique.sql` — agrega el índice único `uq_surveillance_queue_call_id` sobre `surveillance_queue.call_id`. Requiere que exista `surveillance_queue`. Si ya hay más de una entrada para una misma llamada, la creación del índice falla y no elimina registros; resuelve esos duplicados de forma controlada antes de reintentar.
   4. `backend/database/migrations/005_softphone_device_sessions.sql` — agrega `calls.agent_device_session_id` y `agent_presence.device_session_id`. Requiere que existan `calls` y `agent_presence`, por lo que debe ejecutarse después de la 003.
   5. `backend/database/migrations/006_auth_token_version.sql` — agrega `users.token_version`, con valor inicial `0`. Requiere que exista `users`.

   Las migraciones 002, 004, 005 y 006 comprueban la existencia de las columnas, la relación o el índice que administran antes de agregarlos. Aun así, verifica que la estructura existente tenga la definición esperada; las comprobaciones se basan en nombres de columnas e índices.
4. Si falta alguna tabla requerida, hay una ejecución parcial o el esquema difiere de lo esperado, detente y revisa la base antes de continuar. No ejecutes una migración ya aplicada: la 003 no tolera una repetición y las demás no sustituyen una inspección de la estructura.
5. Una vez aplicadas las migraciones pendientes, configura `.env` como se indica en **Variables de entorno** e instala/inicia la aplicación con los comandos del apartado **Instalación y ejecución**.

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

También puedes ajustar estas variables incluidas en `.env.example`:

- `PORT`: puerto de la API; el valor de ejemplo y el valor predeterminado del backend son `4000`.
- `JWT_EXPIRES_IN`: duración de los JWT; el valor de ejemplo y el predeterminado son `8h`.
- `FRONTEND_URL`: origen permitido para el frontend por CORS; el valor de ejemplo y el predeterminado son `http://localhost:5173`.

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

Ejecuta el comando desde una terminal interactiva. Solicita la contraseña sin mostrarla, requiere al menos 12 caracteres y no modifica una cuenta existente.

Para crear un usuario común, abre la ruta `/register` del frontend desde la dirección **Local** que muestra Vite y completa el formulario. El registro público asigna automáticamente el rol `USER`.

Usa ambas cuentas para comprobar las diferencias de permisos entre `ADMIN` y `USER`.

## Llevar el proyecto a otra PC

Estos pasos permiten instalar CallManagerAI en una computadora nueva y, opcionalmente, trasladar también los usuarios y demás datos de MySQL. No hace falta copiar `node_modules`; se instalarán de nuevo en el equipo destino.

### 1. Preparar la PC actual

1. Deja de usar la aplicación y detén el backend para evitar cambios en la base durante la exportación.
2. Abre MySQL Workbench y conéctate al servidor donde está la base `callmanagerai`.
3. Para trasladar los datos existentes, ve a **Server > Data Export**:
   - Selecciona el esquema `callmanagerai` y todas sus tablas.
   - Elige **Export to Self-Contained File** y guarda el archivo, por ejemplo, como `callmanagerai-backup.sql` en una ubicación segura.
   - Incluye estructura y datos y, si aparece la opción, **Include Create Schema**.
   - Pulsa **Start Export** y verifica que Workbench termine sin errores.
4. Copia el archivo de respaldo a la PC nueva mediante un medio privado y seguro. El respaldo puede contener datos personales; no lo publiques en GitHub ni lo compartas públicamente.

Si no necesitas conservar usuarios, llamadas u otros datos, puedes omitir la exportación y crear una base vacía en la PC nueva usando `backend/database/schema.sql`. Los datos de ejemplo de `backend/database/seeds.sql` son opcionales.

### 2. Instalar el proyecto en la PC nueva

1. Instala Node.js (versión LTS), MySQL Server, MySQL Workbench y Git. Para usar llamadas con Twilio en desarrollo, instala también ngrok.
2. Abre PowerShell en la carpeta donde quieras guardar el proyecto y clona el repositorio:

   ```powershell
   git clone https://github.com/GeckoAgar/CallManagerAI.git
   Set-Location CallManagerAI
   ```

3. Instala las dependencias desde la raíz del proyecto:

   ```powershell
   npm install
   npm --prefix backend install
   npm --prefix frontend install
   ```

4. Inicia MySQL Server y crea una conexión local en Workbench.
5. Si vas a restaurar la base, en Workbench selecciona **Server > Data Import**, elige **Import from Self-Contained File**, busca `callmanagerai-backup.sql` y pulsa **Start Import**. Si el respaldo no incluye la creación del esquema, crea primero `callmanagerai` en Workbench y selecciónalo como esquema de destino.
6. Si vas a empezar con una base vacía, abre y ejecuta `backend/database/schema.sql` en Workbench. No ejecutes `seeds.sql` salvo que quieras los contactos de ejemplo.

Si el respaldo corresponde al esquema actual de CallManagerAI, no vuelvas a ejecutar `schema.sql`, los seeds ni las migraciones: la base restaurada ya incluye esos cambios. Si proviene de una versión anterior, identifica primero qué migraciones ya están aplicadas y ejecuta únicamente las pendientes, en el orden indicado en **Actualización de una base de datos existente**. No ejecutes `schema.sql` sobre una base restaurada como sustituto de las migraciones. Conserva el archivo de respaldo hasta comprobar que la aplicación funciona en la nueva PC.

### 3. Configurar el entorno de la PC nueva

1. Desde la raíz del proyecto, crea el archivo local `.env`:

   ```powershell
   Copy-Item .env.example .env
   ```

2. Edita `.env` y configura las credenciales de MySQL de la PC nueva (`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`). El nombre de la base debe coincidir con la restaurada o creada.
3. Genera un `JWT_SECRET` nuevo con el comando indicado en **Variables de entorno**.
4. `.env` no se guarda en GitHub. Configúralo en la nueva PC; no publiques el archivo ni pegues sus secretos en chats o repositorios.
5. Para usar Twilio, configura en `.env` las credenciales de tu cuenta y el número habilitado para voz. Puedes reutilizar la misma cuenta si tienes acceso, pero conserva las credenciales de forma privada. Para una instalación sin llamadas, puedes dejar Twilio sin configurar.

### 4. Configurar ngrok y Twilio (opcional)

1. Inicia la aplicación desde la raíz del proyecto con `npm run dev` y deja esa terminal abierta.
2. Inicia sesión en ngrok en esa PC y configura tu authtoken siguiendo las instrucciones de tu cuenta. En otra terminal, ejecuta:

   ```powershell
   ngrok http 4000
   ```

3. Copia el nuevo dominio HTTPS de ngrok en `TWILIO_WEBHOOK_BASE_URL` (sin ruta y sin barra final). Reinicia el backend después de cambiar `.env`.
4. En Twilio Console, actualiza la Voice URL de la TwiML App y del número para usar el dominio nuevo:
   `https://<dominio-ngrok>/api/softphone/webhooks/voice`
   con método **HTTP POST**.
5. Mantén ngrok activo mientras uses llamadas. En el plan gratuito, el dominio puede cambiar al reiniciar el túnel; si cambia, actualiza `.env` y las URLs en Twilio.

### 5. Comprobar la instalación

Si no configuraste Twilio en el paso anterior, inicia la aplicación desde la raíz con `npm run dev`. Abre la dirección **Local** que indique Vite en la terminal. La API debe iniciar sin errores de conexión a MySQL. Prueba iniciar sesión con un usuario existente si restauraste la base. Si creaste una base vacía, crea el administrador inicial una sola vez:

```powershell
npm --prefix backend run create-admin
```

Comprueba también que puedes iniciar sesión y que las páginas cargan. Para llamadas, verifica que el softphone se conecte, concede permiso de micrófono y realiza una prueba controlada. Si algo falla, revisa los mensajes de las terminales, el estado de MySQL y las variables de `.env`.

## API y permisos

### Autenticación

- `POST /api/auth/register` — registro público como `USER`.
- `POST /api/auth/login` — autenticación y emisión de JWT.
- `GET /api/auth/me` — datos del usuario autenticado.
- `GET /api/users` — listado completo exclusivo para `ADMIN`.
- `GET /api/users/:id` — `ADMIN` puede consultar cualquier perfil; `USER`, únicamente el propio.

### Módulos

- `GET /api/dashboard/summary` — resumen de llamadas y actividad de los últimos siete días; `ADMIN` ve datos globales y `USER` solo sus llamadas. El promedio usa duraciones válidas de llamadas completadas.
- `/api/users` — listado, creación, edición y eliminación solo para `ADMIN`.
- `/api/roles` — CRUD solo para `ADMIN`; los roles reservados `ADMIN` y `USER` no se pueden renombrar ni eliminar.
- `/api/contacts` — CRUD; `USER` solo ve y modifica sus contactos.
- `/api/calls` — CRUD; `USER` solo accede a llamadas asignadas a su cuenta.
- `/api/recordings` — CRUD de metadatos; `USER` solo accede a grabaciones de sus llamadas.
- `/api/reports/summary`, `/api/reports/calls-by-day` y `/api/reports/by-agent` — métricas de llamadas; `ADMIN` ve datos globales y `USER` solo los propios. `GET /api/reports` conserva su respuesta de grabaciones.
- `/api/supervision/summary`, `/api/supervision/agents` y `/api/supervision/queue` — supervisión exclusiva para `ADMIN`; la cola permite iniciar monitoreo, escalar y retirar entradas.
- `/api/softphone` — token temporal de Twilio Voice, presencia, heartbeat, webhooks y llamadas.

La API valida los JWT y consulta el estado y rol actuales del usuario en la base. Las operaciones sensibles y los permisos se verifican en el servidor, no solamente en la interfaz.

## Presencia y cola de supervisión

El softphone envía un heartbeat cada 30 segundos. Si no se recibe uno durante más de 90 segundos, Supervisión calcula el estado efectivo como `offline`; un heartbeat vencido no puede reactivar una presencia desconectada. El cierre de sesión normal también marca la presencia `offline`.

El webhook reserva al agente y registra el `CallSid` en la misma transacción; una repetición del mismo webhook no crea otra asignación ni otro intento de llamada.

Las llamadas `active` asignadas a un agente `USER` activo se incorporan a la cola como `waiting`. Al completar, fallar o retirar la asignación del agente, la entrada se elimina. Un administrador puede pasar una entrada de `waiting` a `monitoring`, escalarla desde `waiting` o `monitoring`, y retirarla de la cola. Esta cola organiza la supervisión y no proporciona escucha ni grabación de audio.

## Esquema y datos

- Esquema para instalaciones nuevas: `backend/database/schema.sql`.
- Datos de ejemplo: `backend/database/seeds.sql`.
- Migraciones para bases existentes: `backend/database/migrations/`.
