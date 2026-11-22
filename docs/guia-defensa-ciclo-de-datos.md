# Guía de defensa: ciclo de vida de los datos en CallManagerAI

Esta guía explica **qué hace la versión actual del código**, desde que se inicia la aplicación hasta que se consultan o eliminan los datos. Está pensada para estudiar y responder preguntas en una defensa. No supone que una funcionalidad esté implementada solo porque aparezca en el nombre del proyecto o en la interfaz.

Para instalación y configuración detalladas, consultar el [README](../README.md). El [diagrama entidad-relación](./diagrama-er.md) complementa la sección de base de datos.

## 1. Explicación breve para empezar la defensa

> CallManagerAI es una aplicación web para gestionar operaciones de comunicación. El usuario interactúa con una interfaz hecha en React. Esa interfaz envía solicitudes HTTP a una API de Node.js y Express, que valida los datos y permisos y consulta o modifica una base MySQL. Para la telefonía real se integra Twilio Voice: el navegador usa su SDK y Twilio se comunica con el backend mediante webhooks. Los estados de las llamadas se guardan en la base y alimentan el historial, los reportes y la supervisión.

**Aclaración importante:** el nombre incluye «AI», pero en el código revisado no hay un modelo de inteligencia artificial integrado que analice llamadas o genere transcripciones. La calificación y la transcripción son datos que pueden cargarse; no se calculan automáticamente.

## 2. Mapa general: quién hace qué

```text
                         Solicitudes HTTP/JSON
Usuario -> Navegador / React --------------------> API / Express
             |      ^                                  |   ^
             |      |                                  |   |
             |      +-------- Respuesta JSON ----------+   |
             |                                             |
             |                            Consultas SQL     |
             |                                  v          |
             |                               MySQL         |
             |
             +-- SDK de voz <----> Twilio <----> Red telefónica
                                     |
                                     +-- Webhooks HTTP --> API / Express
                                        <-- instrucciones TwiML (XML)
```

Son dos recorridos relacionados, pero distintos:

1. **Datos de gestión:** navegador → API → MySQL → API → navegador.
2. **Telefonía:** navegador y red telefónica interactúan con Twilio; Twilio consulta al backend y le notifica eventos. El backend guarda los estados y metadatos de la llamada en MySQL. El audio no se guarda en la base de este proyecto.

### Tecnologías y su función

| Tecnología | Función concreta en este proyecto |
|---|---|
| React | Construye las pantallas y mantiene el estado temporal de sus componentes. |
| Vite | Sirve el frontend en desarrollo y genera su build para producción. |
| React Router | Relaciona rutas como `/contacts` con pantallas y aplica barreras de navegación. |
| Axios | Envía solicitudes a la API; un interceptor adjunta el token de sesión. |
| Zustand | Gestiona la sesión y preferencias de interfaz, persistidas en `localStorage`. |
| Tailwind CSS y Lucide | Estilos de la interfaz e íconos. |
| Recharts | Presenta gráficos a partir de datos devueltos por la API. |
| Node.js y Express | Ejecutan el servidor y definen rutas, middlewares y respuestas. |
| MySQL y `mysql2` | Almacenan los registros relacionados; el backend usa un pool de conexiones y consultas parametrizadas. |
| bcryptjs | Genera y verifica hashes de contraseñas; no guarda la contraseña en texto plano en la base. |
| JSON Web Token (JWT) | Identifica la sesión del usuario mediante un token firmado y con vencimiento. |
| Twilio Voice y su SDK | Gestionan la comunicación telefónica; el backend emite un token de voz y responde a webhooks. |
| ngrok, opcional | Expone el backend local mediante una URL HTTPS pública para que Twilio pueda enviarle webhooks. |

Archivos de referencia: [dependencias del frontend](../frontend/package.json), [dependencias del backend](../backend/package.json) y [comandos principales](../package.json).

## 3. Qué ocurre al iniciar el sistema

1. Se prepara MySQL ejecutando el [esquema](../backend/database/schema.sql) en una instalación nueva. Este crea las tablas y los roles iniciales `ADMIN` y `USER`. Las migraciones se usan para actualizar bases anteriores, no como sustituto de una copia de seguridad.
2. El backend carga las variables del archivo local `.env`, valida que exista un secreto JWT apropiado y prueba la conexión con MySQL. Si la conexión falla, no inicia la API. Ver [configuración de entorno](../backend/src/config/env.js), [conexión](../backend/src/config/db.js) y [arranque](../backend/src/server.js).
3. Express configura CORS, Helmet, registro de solicitudes con Morgan, lectura de JSON y formularios, y las rutas de la API. El endpoint `/api/health` responde con estado y fecha; **no hace una prueba de MySQL en cada consulta**. Ver [app.js](../backend/src/app.js).
4. Vite entrega la aplicación React al navegador. [main.jsx](../frontend/src/main.jsx) inicia React y [App.jsx](../frontend/src/App.jsx) define las rutas.
5. Si existe un token guardado en el navegador, la aplicación consulta `/api/auth/me`. Si la solicitud falla, limpia la sesión local; mientras tanto muestra «Verificando sesión».

**Dónde están los datos en esta etapa:** la configuración sensible está en el servidor; las tablas y sus registros están en MySQL; la aplicación y el estado temporal están en el navegador. `.env` no debe publicarse ni compartirse.

## 4. El viaje típico de una solicitud

Ejemplo: una persona crea un contacto.

1. En la pantalla **Contactos**, completa un formulario. La página define sus campos y utiliza el componente reutilizable [CrudManager.jsx](../frontend/src/components/common/CrudManager.jsx).
2. El componente prepara un objeto con los datos y usa Axios para enviar `POST /api/contacts`. El interceptor de [api.js](../frontend/src/services/api.js) agrega `Authorization: Bearer <token>` si hay sesión.
3. Express recibe la solicitud, convierte el JSON en `req.body` y la deriva a [contactRoutes.js](../backend/src/routes/contactRoutes.js).
4. El middleware [auth.js](../backend/src/middlewares/auth.js) verifica la firma y vencimiento del JWT, consulta al usuario en MySQL y comprueba su estado y versión de token. El rol actual se obtiene de la base.
5. La ruta valida los campos y decide el propietario: para un usuario no administrador usa su propio ID; un administrador puede seleccionar uno o dejarlo vacío.
6. La API ejecuta un `INSERT` parametrizado en `contacts`, consulta el registro recién creado y devuelve una respuesta JSON.
7. El frontend cierra el formulario, vuelve a solicitar el listado y muestra el resultado. Si algo falla, muestra un mensaje en vez de presentar la operación como exitosa.

Las pantallas de usuarios, roles, llamadas y grabaciones también reutilizan `CrudManager`. **CRUD** significa crear, leer, actualizar y eliminar. La validación del navegador ayuda a la experiencia, pero la autorización real se hace en el backend.

### Listados, búsqueda y paginación

El componente envía `page`, `limit` y, si corresponde, `search`. El servidor filtra por permisos, cuenta resultados y usa `LIMIT` y `OFFSET`. La respuesta paginada contiene `data`, `total`, `page`, `limit` y `totalPages`; se admiten tamaños 10, 25 o 50. La búsqueda espera 350 ms después de escribir antes de actualizar la consulta. Sin parámetros de paginación ni búsqueda, las rutas conservan sus respuestas completas para otros consumidores, como los selectores de formularios. Ver [pagination.js](../backend/src/utils/pagination.js).

## 5. Ciclo de vida de la cuenta y la sesión

### Registro

1. [RegisterPage.jsx](../frontend/src/pages/Auth/RegisterPage.jsx) envía nombre, correo y contraseña a `POST /api/auth/register`.
2. [authValidators.js](../backend/src/validators/authValidators.js) valida los datos: nombre de al menos dos caracteres, correo válido y contraseña de al menos seis.
3. [authService.js](../backend/src/utils/authService.js) normaliza el correo, verifica que no exista, busca el rol `USER` y genera un hash bcrypt con costo 10.
4. Guarda el usuario activo con su hash y rol en `users`. El servidor devuelve datos del usuario y un JWT, y el navegador guarda la sesión y navega al inicio.

El registro público **no permite elegir ADMIN**. El primer administrador se crea mediante el script interactivo descrito en el README, que exige al menos 12 caracteres de contraseña. El mínimo del registro público y de la gestión administrativa de usuarios es de seis; no hay que confundirlo con el requisito del script inicial.

### Inicio de sesión y autenticación posterior

1. [LoginPage.jsx](../frontend/src/pages/Auth/LoginPage.jsx) envía correo y contraseña a `POST /api/auth/login`.
2. El backend busca el correo normalizado, verifica que la cuenta esté activa y compara la contraseña con el hash usando bcrypt.
3. Si corresponde, firma un JWT con ID, correo y versión del token. La duración predeterminada es ocho horas, configurable con `JWT_EXPIRES_IN`.
4. [authStore.js](../frontend/src/store/authStore.js) conserva usuario y token en `localStorage`. En cada solicitud protegida, Axios envía el token.
5. El servidor no se limita a confiar en la información del navegador: verifica el JWT y vuelve a consultar el usuario, el estado, el rol y `token_version` en MySQL. Por eso un cambio de rol o estado se aplica al evaluar nuevas solicitudes.

Un JWT está **firmado, no cifrado**: no debe contener secretos. `localStorage` es accesible para JavaScript del mismo origen, por lo que un ataque XSS podría exponer el token. Usar HTTPS en un despliegue real es necesario para proteger las comunicaciones; la configuración local de ejemplo usa HTTP.

### Cierre de sesión

El botón del [layout](../frontend/src/components/layout/AppLayout.jsx) envía `POST /api/auth/logout`. En una transacción, el servidor incrementa `users.token_version` y marca la presencia del agente como `offline`; después el navegador borra su sesión local. Los JWT anteriores de ese usuario dejan de coincidir con la nueva versión, incluso los emitidos en otras sesiones. Un cambio de contraseña realizado desde la gestión de usuarios también incrementa esa versión. Si falla la solicitud de cierre, la interfaz informa el error.

## 6. Base de datos: qué se guarda y cómo se relaciona

El esquema está en [schema.sql](../backend/database/schema.sql). Una **clave primaria** identifica una fila; una **clave foránea** relaciona filas entre tablas. `NULL` significa que un dato o relación puede no estar asignado.

| Tabla | Qué guarda | Relaciones principales |
|---|---|---|
| `roles` | Nombre y descripción del rol. | Un rol puede estar asignado a varios usuarios. |
| `users` | Nombre, correo único, hash de contraseña, estado, versión de token y rol. | `role_id` apunta a `roles`. |
| `contacts` | Nombre, empresa, teléfono, correo, estado, propietario opcional y fecha de baja lógica `deleted_at`. | `owner_id` apunta a `users`. |
| `calls` | Número, dirección, estado, duración, calificación, identificador del proveedor y sesión del dispositivo. | `agent_id` apunta a `users`; `contact_id` puede apuntar a `contacts`. |
| `agent_presence` | Estado, sesión de dispositivo y última actualización de presencia. | `user_id` es a la vez clave primaria y referencia a `users`. |
| `recordings` | Metadatos: llamada, nombre de archivo, URL, duración y texto de transcripción. | `call_id` apunta a `calls`. No contiene el archivo de audio. |
| `surveillance_queue` | Entrada de supervisión, agente, llamada y estado. | Apunta a `users` y `calls`; el índice único evita dos entradas para la misma llamada. |

```text
roles 1 ─── N users 1 ─── N contacts
                  │
                  ├── 1 agent_presence
                  └── N calls N ─── 1 contacts (opcional)
                          │
                          ├── N recordings
                          └── hasta 1 entrada en surveillance_queue
```

No toda llamada tiene contacto asociado: en el flujo Twilio se guarda el número y no se busca automáticamente un contacto. Las tablas tienen fechas de creación, salvo que presencia usa `updated_at` para su vigencia.

### Integridad y eliminación

Las relaciones evitan dejar referencias inexistentes. Por ejemplo, si una llamada tiene metadatos de grabación asociados, MySQL puede rechazar su eliminación. La ruta de llamadas intenta retirar su entrada de supervisión y borrar la llamada dentro de una transacción: si la eliminación falla por una relación, se revierte también la retirada de la cola. El middleware de errores devuelve `409` para duplicados o registros referenciados. No se implementa una política automática de retención o eliminación programada.

La eliminación de un contacto es **lógica**: se registra `deleted_at`, deja de aparecer en las listas normales y no se puede asociar a nuevas llamadas. Sus datos y relaciones históricas permanecen en MySQL. Un ADMIN puede consultarlo en «Contactos eliminados» y restaurarlo; recupera su estado anterior (`active` o `inactive`). Esto no anonimiza ni borra datos personales.

Una **transacción** agrupa operaciones: `COMMIT` confirma todo y `ROLLBACK` revierte los cambios ante un fallo. Los bloqueos `FOR UPDATE` se usan en operaciones sensibles para coordinar accesos concurrentes.

## 7. Permisos y gestión de datos

| Acción | ADMIN | USER |
|---|---|---|
| Usuarios | Lista y administra usuarios. | Consulta su propio perfil. |
| Roles | Administra roles; no puede renombrar ni eliminar `ADMIN` o `USER`. | No accede a la administración de roles. |
| Contactos | Gestiona todos, asigna propietario y restaura contactos eliminados. | Gestiona y elimina lógicamente solo contactos cuyo `owner_id` es su ID. |
| Llamadas | Gestiona llamadas de todos y puede asignar agente. | Gestiona las asignadas a su cuenta; no puede reasignarlas. |
| Grabaciones | Gestiona los metadatos de todas las llamadas. | Accede a los metadatos asociados a sus llamadas. |
| Dashboard y reportes | Ve estadísticas globales. | Ve estadísticas de sus llamadas. |
| Supervisión | Accede a agentes y cola. | No accede a este módulo. |

Los filtros se aplican en las rutas y consultas del backend, no solo ocultando botones. Los contactos sin propietario quedan accesibles para ADMIN, no para un USER por el filtro de propiedad. No se puede borrar la propia cuenta de administrador ni cambiar el propio rol o desactivarse desde la operación administrativa; además, se protege la existencia de al menos un administrador activo.

Se pueden crear nombres de roles adicionales, pero **eso no configura automáticamente permisos nuevos**: las rutas que exigen roles comparan explícitamente con `ADMIN` y/o `USER`. No hay un sistema de permisos configurables por rol.

### Ejemplo de llamada cargada manualmente

En **Llamadas**, el formulario permite guardar número, contacto opcional, dirección, estado, duración y calificación. Esto crea o modifica una fila mediante `/api/calls`; **no inicia una llamada telefónica**. Una llamada marcada `active` y asignada a un `USER` activo puede ingresar a la cola de supervisión, incluso si el registro fue cargado manualmente. El score se carga como número entre 0 y 100; no es una evaluación de IA.

Código relacionado: [usuarios](../backend/src/routes/userRoutes.js), [roles](../backend/src/routes/roleRoutes.js), [contactos](../backend/src/routes/contactRoutes.js), [llamadas](../backend/src/routes/callRoutes.js) y [grabaciones](../backend/src/routes/recordingRoutes.js).

## 8. Ciclo completo de una llamada con Twilio

### Preparación: dispositivo y presencia

1. El usuario abre [SoftphonePage.jsx](../frontend/src/pages/Softphone/SoftphonePage.jsx). El navegador genera un UUID para esa sesión del dispositivo y pide a `GET /api/softphone/token` un token de Twilio.
2. El backend requiere el JWT de la aplicación y una configuración Twilio completa. Genera un token de voz temporal, de una hora, con identidad derivada del ID de usuario y del UUID. Este token es distinto del JWT de sesión de CallManagerAI.
3. Al elegir **Conectarme y quedar disponible**, el SDK registra el dispositivo con Twilio. Luego el frontend registra la misma sesión en `agent_presence` mediante la API. El backend evita que otro dispositivo vigente del mismo usuario se registre simultáneamente.
4. Mientras está disponible u ocupado, el navegador envía un **heartbeat** cada 30 segundos. Si la última actualización supera 90 segundos o falta la sesión de dispositivo, el estado se considera `offline`. Un heartbeat vencido no revive por sí solo la presencia: se necesita un registro válido.
5. El SDK renueva el token próximo a vencer. También hay intentos de reconexión ante ciertos fallos; errores de autenticación o conflictos de sesión pueden detener el registro.

Al salir de la pantalla se destruye el dispositivo y se intenta marcarlo desconectado. Si el navegador se cierra o pierde conexión antes de avisar, la vigencia del heartbeat evita que permanezca considerado disponible indefinidamente.

### Llamada saliente

```text
Agente -> Softphone -> SDK Twilio -> Twilio
                                      |
                           POST webhook /voice
                                      v
                             API -> MySQL
                                      |
                           TwiML: llamar al número
                                      v
                        Twilio -> teléfono de destino
                                      |
                           Webhooks de estado -> API -> MySQL
```

1. El agente ingresa un número internacional E.164, por ejemplo `+5491123456789`, y debe tener el dispositivo registrado y disponible. El navegador pide al SDK iniciar la conexión con el número y la sesión del dispositivo.
2. Twilio llama al webhook público `POST /api/softphone/webhooks/voice`. El servidor valida `X-Twilio-Signature` usando el Auth Token y la URL pública configurada.
3. El backend comprueba la identidad del cliente, el número y que la sesión esté registrada, disponible y vigente. Inserta una llamada `outbound` con estado `queued`, agente, número y `CallSid` del proveedor.
4. Devuelve **TwiML**, instrucciones XML para que Twilio llame al número de destino usando el número configurado. No es el backend quien marca directamente el teléfono.
5. Twilio envía eventos a `/api/softphone/webhooks/dial-status`. El backend identifica la llamada, actualiza estado y, cuando corresponde, duración, y sincroniza la cola de supervisión.
6. Al finalizar o fallar, el registro permanece en `calls` como historial. El frontend actualiza la lista y gestiona la presencia de acuerdo con el estado del dispositivo.

### Llamada entrante

1. Una persona llama al número de Twilio configurado. Twilio envía el webhook de voz al backend.
2. El backend valida firma, número de destino, número de origen y `CallSid`. Inserta la llamada entrante inicialmente como `queued`.
3. En una transacción busca un agente `USER` activo con presencia `available`, dispositivo vigente y heartbeat reciente. Ordena por actualización de presencia y luego por ID; bloquea la fila, reserva al agente como `busy` y asigna la llamada y la sesión del dispositivo.
4. Si no encuentra agente disponible, registra la llamada como `failed` y responde a Twilio con un mensaje y una instrucción para cortar. No hay una cola telefónica de espera prolongada en ese caso.
5. Si hay agente, la respuesta TwiML indica a Twilio que llame a la identidad de ese dispositivo, con un timeout de 25 segundos. El SDK informa la llamada entrante y el agente puede atenderla o rechazarla.
6. Los callbacks actualizan `calls`; cuando corresponde, la presencia ocupada vuelve a disponible solo si la sesión sigue siendo la misma y está vigente.

El índice único sobre `provider_call_sid` y la inserción junto con la reserva en una transacción evitan crear una segunda asignación al repetir el mismo webhook. En conflictos de bloqueo, la reserva puede reintentarse hasta tres veces. Estos mecanismos no significan que todas las posibles entregas de callbacks estén garantizadas ni que una llamada entrante haya sido probada en cada entorno. El README documenta una prueba saliente real; las entrantes deben configurarse y probarse por separado.

### Estados y controles

| Dato | Valores | Significado |
|---|---|---|
| `calls.direction` | `inbound`, `outbound` | Llamada entrante o saliente. |
| `calls.status` | `queued`, `active`, `completed`, `failed` | Iniciada/en espera, activa, completada o no completada. |
| `agent_presence.status` | `offline`, `available`, `busy` | Desconectado, disponible u ocupado; la vigencia depende también del heartbeat. |

Atender, rechazar, silenciar y colgar actúan sobre la llamada del SDK en el navegador. Silenciar no elimina datos de la base. El historial reciente consulta `/api/calls`, muestra hasta ocho registros y se actualiza cada 15 segundos mientras el softphone está inicializado.

Código central: [softphoneRoutes.js](../backend/src/routes/softphoneRoutes.js). La configuración y el túnel se explican en el [README](../README.md#configurar-twilio-para-el-softphone). Si Twilio no está configurado, el token y los webhooks responden con error de servicio no disponible; el resto de la gestión no depende de iniciar una llamada.

## 9. Supervisión: del estado de llamada a la cola

La cola de supervisión **no es la cola telefónica de personas esperando ser atendidas**. Es una lista de registros para organizar la supervisión administrativa de llamadas activas.

1. Cuando una llamada pasa a `active`, la lógica [surveillanceQueue.js](../backend/src/utils/surveillanceQueue.js) comprueba que esté asignada a un `USER` activo y crea o sincroniza una entrada `waiting`.
2. Un ADMIN consulta resumen, agentes y cola con los endpoints de [supervisionRoutes.js](../backend/src/routes/supervisionRoutes.js). La pantalla se actualiza aproximadamente cada 30 segundos.
3. El administrador puede pasar `waiting` a `monitoring`, o escalar desde `waiting` o `monitoring` a `escalated`. También puede retirar la entrada. El servidor verifica la llamada activa, el agente y la transición.
4. Cuando la llamada deja de estar activa o deja de estar asignada a un agente válido, la sincronización retira la entrada. Si se elimina manualmente la entrada, no se elimina la llamada.

«Monitorear» y «escalar» aquí **cambian un estado de gestión**: no conectan al supervisor al audio, no graban la conversación ni envían una notificación automática.

## 10. Grabaciones, transcripciones y datos derivados

### Grabaciones

La pantalla [RecordingsPage.jsx](../frontend/src/pages/Recordings/RecordingsPage.jsx) permite registrar y modificar metadatos vinculados a una llamada: nombre, URL opcional, duración y transcripción opcional. El backend comprueba el acceso a la llamada y valida la URL cuando se proporciona.

**No hay carga de archivos, almacenamiento de audio, grabación automática desde Twilio ni transcripción automática implementados en este módulo.** Una URL guardada es un dato suministrado al sistema; por sí sola no prueba que exista un archivo o que se pueda reproducir.

### Dashboard y reportes

- [DashboardPage.jsx](../frontend/src/pages/Dashboard/DashboardPage.jsx) consulta `/api/dashboard/summary`.
- [ReportsPage.jsx](../frontend/src/pages/Reports/ReportsPage.jsx) consulta en paralelo `/api/reports/summary`, `/calls-by-day` y `/by-agent`.
- El backend cuenta y agrupa filas de `calls` mediante SQL. El resumen total considera todas las llamadas accesibles; la serie diaria cubre hoy y los seis días anteriores según la fecha de MySQL, con ceros para días sin llamadas.
- El promedio de duración considera llamadas `completed` con duración no nula y no negativa; si no existen, devuelve cero. Las gráficas se construyen en React con Recharts.
- Los datos cargados manualmente y los de demostración también pueden influir en los indicadores: un gráfico no demuestra por sí solo que todas las llamadas hayan sido reales.

Fuentes: [dashboardRoutes.js](../backend/src/routes/dashboardRoutes.js) y [reportRoutes.js](../backend/src/routes/reportRoutes.js).

## 11. Dónde vive cada dato y cuándo cambia

| Dato | Ubicación | Cuándo se crea, cambia o deja de usarse |
|---|---|---|
| Contraseña ingresada | Formulario y solicitud hacia la API. | El backend genera o compara el hash; la base conserva el hash, no la contraseña original. |
| Hash de contraseña | `users.password_hash` en MySQL. | Registro o gestión administrativa; cambia al actualizar la contraseña. |
| JWT de aplicación y usuario | `localStorage` del navegador y estado de Zustand. | Se guardan al iniciar sesión o registrarse; se limpian al cerrar sesión correctamente o si falla la restauración. El JWT también vence o se invalida por versión. |
| Preferencia de tamaño de texto | `localStorage`, separada de la sesión. | Cambia desde Configuración; no modifica permisos ni datos en MySQL. |
| Token Twilio y dispositivo | Memoria del navegador mientras se usa el softphone; el servidor genera el token. | El token tiene duración limitada y el SDK lo renueva; no es el token de inicio de sesión. |
| Contactos, llamadas y metadatos | MySQL. | Se crean y editan por API o por los flujos descritos. Los contactos dados de baja conservan sus datos y pueden restaurarse; otras eliminaciones dependen de sus relaciones. |
| Presencia y sesión de dispositivo | `agent_presence` en MySQL, más estado temporal en el navegador. | Registro, heartbeat, llamada y desconexión modifican o determinan su vigencia. |
| Audio de la llamada | Circula mediante el servicio de telefonía y el dispositivo del usuario. | El proyecto no lo almacena como archivo ni en MySQL. La gestión del proveedor depende de su configuración y políticas. |
| Estadísticas | Respuestas calculadas desde MySQL y estado temporal de React. | Se recalculan al consultar los endpoints; no son tablas de métricas independientes. |

La pantalla [SettingsPage.jsx](../frontend/src/pages/Settings/SettingsPage.jsx) muestra perfil y preferencia local. No ofrece un flujo de cambio de contraseña propio ni opciones configurables para las notificaciones. Los avisos Toast informan resultados inmediatos de los CRUD y acciones de sesión.

El [buscador global](../frontend/src/components/layout/GlobalSearch.jsx) espera 350 ms desde la escritura y consulta, en paralelo, las rutas paginadas existentes. ADMIN busca en los cinco módulos; USER solo consulta contactos, llamadas y grabaciones autorizados. Cada ruta aplica sus propios filtros. El resultado abre la sección con el texto de búsqueda y el identificador para destacar la fila. No se busca directamente por identificador: se utilizan los campos admitidos por cada listado.

La [campana](../frontend/src/components/layout/NotificationCenter.jsx) consulta la [API de notificaciones](../backend/src/routes/notificationRoutes.js), que usa el usuario autenticado para filtrar todas las lecturas y cambios. [La migración 008](../backend/database/migrations/008_notifications.sql) crea la tabla personal. El panel muestra las últimas 50 y permite cargar anteriores, cuenta las no leídas y permite marcarlas y eliminarlas. El [middleware de eventos](../backend/src/middlewares/notificationEvents.js) registra solo operaciones exitosas seleccionadas, no todos los Toast. Guarda el aviso después de responder y registra los fallos en el servidor: no hay garantía transaccional ni auditoría completa. La operación original no se revierte si falla el registro del aviso.

## 12. Seguridad, errores y límites que conviene reconocer

- **Autenticación vs. autorización:** autenticación comprueba quién es el usuario; autorización decide si puede realizar una acción o acceder a un registro.
- **Protección de contraseñas:** bcrypt guarda hashes; no es cifrado reversible. El JWT utiliza un secreto del servidor y una duración limitada.
- **Consultas SQL parametrizadas:** los valores se pasan mediante `?`, en lugar de concatenar directamente los datos del usuario en la consulta.
- **Webhooks:** se reciben sin JWT de usuario porque los envía Twilio; se autentican mediante la firma del proveedor. La URL pública configurada debe coincidir con la usada para validar la firma.
- **CORS y Helmet:** CORS configura qué origen del navegador puede acceder a la API; Helmet agrega cabeceras de seguridad. CORS no reemplaza la autenticación ni impide por sí solo solicitudes desde clientes no navegador.
- **Errores HTTP:** `400` indica datos inválidos; `401`, token ausente, inválido o sesión invalidada; `403`, acceso prohibido o cuenta no activa; `404`, recurso no encontrado o no accesible en algunas rutas; `409`, conflicto; `500`, error interno; `503`, telefonía no configurada.
- **Datos personales:** correos, teléfonos, historial y posibles transcripciones requieren cuidado. El proyecto no demuestra por sí mismo cumplimiento legal, cifrado de base de datos, políticas de retención ni gestión de consentimiento.
- **Límites de producción:** el registro público admite contraseñas de seis caracteres y el JWT se guarda en `localStorage`. Estas son decisiones actuales, no garantías de seguridad total. Conviene evaluar políticas de contraseña más fuertes, protección contra intentos repetidos y otras medidas antes de producción.

## 13. Recorrido de demostración sugerido

1. **Antes de la defensa:** comprobar MySQL, backend y frontend; preparar cuentas de prueba y datos ficticios. Para telefonía, verificar Twilio, HTTPS público, permisos de micrófono y el costo o restricciones de la cuenta.
2. **Como USER:** iniciar sesión, crear un contacto y explicar el recorrido formulario → Axios → JWT → validación → `contacts` → respuesta. Mostrar que el usuario ve sus propios datos.
3. **Llamadas:** crear un registro manual y explicar que eso no realiza una llamada. Si hay telefonía configurada, probar por separado una llamada controlada desde Softphone y seguir sus estados.
4. **Como ADMIN:** mostrar usuarios, roles y supervisión. Explicar que la cola de supervisión no transmite audio.
5. **Dashboard y reportes:** relacionar los indicadores con las filas de `calls` y aclarar si hay datos demo o manuales.
6. **Cerrar sesión:** explicar la invalidación por `token_version` y la desconexión de presencia.

El script de demostración se describe en el [README](../README.md#carga-de-datos-para-demostración): primero permite revisar el plan y requiere `--apply` para escribir. No crea audio ni realiza llamadas reales. Usar únicamente datos ficticios y no mostrar credenciales durante la defensa.

## 14. Preguntas frecuentes para practicar

**¿Por qué separar frontend y backend?**  
El frontend presenta información y captura acciones; el backend centraliza las reglas, verifica identidad y permisos, accede a la base y mantiene secretos fuera del navegador.

**¿Por qué consultar el usuario en la base si ya existe un JWT?**  
Para comprobar el estado, el rol y la versión actuales en cada solicitud protegida, en lugar de depender solo de información emitida antes.

**¿Qué pasa si dos agentes pueden recibir una llamada?**  
El backend selecciona uno disponible y vigente y usa una transacción con bloqueo para reservarlo. El identificador único de Twilio evita duplicar la asignación ante una repetición del webhook.

**¿Qué pasa si el agente pierde la conexión?**  
La interfaz intenta marcarlo desconectado y puede intentar reconectarse. Si deja de enviar heartbeats, la presencia se considera offline tras 90 segundos aunque no haya podido avisar.

**¿Dónde se guarda la conversación?**  
La aplicación guarda metadatos de llamadas; no guarda ni graba el audio en este proyecto. La tabla `recordings` almacena referencias y texto, no archivos.

**¿De dónde sale la transcripción o la calificación?**  
De datos ingresados o cargados en el sistema. El código actual no implementa IA ni transcripción automática.

**¿Se puede eliminar una llamada con grabaciones relacionadas?**  
La clave foránea puede impedirlo. La API informa un conflicto y la transacción revierte los cambios asociados.

**¿Qué ocurre si un usuario intenta ver datos de otro?**  
Las rutas filtran por propietario o agente, o devuelven un error de acceso; cambiar la interfaz o enviar un ID manualmente no debería saltar esas comprobaciones.

**¿Qué diferencia hay entre los dos tokens?**  
El JWT de la aplicación autentica solicitudes a la API. El token temporal de Twilio autoriza el dispositivo de voz para utilizar el servicio telefónico.

**¿Qué ocurre si MySQL no está disponible?**  
Al iniciar, la API prueba la conexión y aborta si falla. Si la base falla después, las operaciones que la necesitan devuelven error; el endpoint de salud por sí solo no comprueba su disponibilidad actual.

**¿Qué haría falta para evolucionarlo?**  
Según el objetivo del producto: integración real de grabación y almacenamiento, transcripción o análisis automático, políticas de privacidad y retención, controles de seguridad adicionales y pruebas de telefonía entrante en un entorno real. Son mejoras posibles, no funcionalidades ya implementadas.

## 15. Índice rápido del código

| Tema | Archivo principal |
|---|---|
| Arranque, conexión y API | [server.js](../backend/src/server.js), [db.js](../backend/src/config/db.js), [app.js](../backend/src/app.js) |
| Rutas de la interfaz y sesión | [App.jsx](../frontend/src/App.jsx), [authStore.js](../frontend/src/store/authStore.js), [api.js](../frontend/src/services/api.js) |
| Registro y permisos | [authRoutes.js](../backend/src/routes/authRoutes.js), [authService.js](../backend/src/utils/authService.js), [auth.js](../backend/src/middlewares/auth.js) |
| Formularios y listados | [CrudManager.jsx](../frontend/src/components/common/CrudManager.jsx), [pagination.js](../backend/src/utils/pagination.js) |
| Telefonía y presencia | [SoftphonePage.jsx](../frontend/src/pages/Softphone/SoftphonePage.jsx), [softphoneRoutes.js](../backend/src/routes/softphoneRoutes.js) |
| Supervisión | [SupervisionPage.jsx](../frontend/src/pages/Supervision/SupervisionPage.jsx), [surveillanceQueue.js](../backend/src/utils/surveillanceQueue.js) |
| Modelo y evolución de base | [schema.sql](../backend/database/schema.sql), [migraciones](../backend/database/migrations/), [seeds.sql](../backend/database/seeds.sql) |
