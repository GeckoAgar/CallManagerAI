const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');

const marker = 'DEMO-CM-A1';
const lockName = 'callmanagerai_demo_seed_a1';
const applyChanges = process.argv.includes('--apply');
const allowedArguments = new Set(['--apply']);

const userFixtures = [
  { name: 'Amalia Pereyra', email: 'demo.agent01@example.test', status: 'active' },
  { name: 'Bruno Salvatierra', email: 'demo.agent02@example.test', status: 'active' },
  { name: 'Camila Ferreyra', email: 'demo.agent03@example.test', status: 'active' },
  { name: 'Diego Ledesma', email: 'demo.agent04@example.test', status: 'active' },
  { name: 'Emilia Cabrera', email: 'demo.agent05@example.test', status: 'active' },
  { name: 'Federico Arce', email: 'demo.agent06@example.test', status: 'active' },
  { name: 'Ines Duarte', email: 'demo.agent07@example.test', status: 'inactive' },
  { name: 'Joaquin Benitez', email: 'demo.agent08@example.test', status: 'blocked' },
];

const activeAgentCallCounts = [28, 24, 21, 19, 16, 12];
const contactGroupSizes = [10, 8, 7, 6, 5, 4];
const contactGroupSteps = [3, 3, 2, 5, 2, 3];
const recordingCount = 30;

const contactNames = [
  ['Ana', 'Acosta'], ['Bautista', 'Aguirre'], ['Carla', 'Alonso'], ['Dario', 'Alvarez'],
  ['Elena', 'Benitez'], ['Felipe', 'Bravo'], ['Gala', 'Cabrera'], ['Hernan', 'Campos'],
  ['Ines', 'Cardozo'], ['Julián', 'Castro'], ['Karen', 'Cejas'], ['Leandro', 'Correa'],
  ['Malena', 'Cruz'], ['Nicolas', 'Diaz'], ['Olivia', 'Dominguez'], ['Pablo', 'Escobar'],
  ['Renata', 'Farias'], ['Santiago', 'Fernandez'], ['Tania', 'Flores'], ['Ulises', 'Franco'],
  ['Violeta', 'Gimenez'], ['Walter', 'Godoy'], ['Ximena', 'Gomez'], ['Yamil', 'Gonzalez'],
  ['Zoe', 'Herrera'], ['Agustin', 'Ibarra'], ['Bianca', 'Juarez'], ['Ciro', 'Luna'],
  ['Delfina', 'Maidana'], ['Esteban', 'Mendez'], ['Florencia', 'Miranda'], ['Gonzalo', 'Molina'],
  ['Helena', 'Morales'], ['Ivan', 'Navarro'], ['Julieta', 'Nunez'], ['Kevin', 'Ojeda'],
  ['Lara', 'Ortega'], ['Marcos', 'Paz'], ['Noelia', 'Pereyra'], ['Oscar', 'Quiroga'],
];

const companies = [
  'Comercial del Plata',
  'Servicios Horizonte',
  'Distribuidora Cuyo',
  'Grupo Litoral',
  'Recuperos del Sur',
];

function makeContacts() {
  const contacts = [];
  let firstContactIndex = 0;

  for (let agentIndex = 0; agentIndex < contactGroupSizes.length; agentIndex += 1) {
    for (let groupIndex = 0; groupIndex < contactGroupSizes[agentIndex]; groupIndex += 1) {
      const index = firstContactIndex + groupIndex;
      const [firstName, lastName] = contactNames[index];
      contacts.push({
        name: `${firstName} ${lastName}`,
        email: `demo.contact${String(index + 1).padStart(3, '0')}@example.test`,
        phone: `+549110000${String(index + 101).padStart(4, '0')}`,
        company: companies[index % companies.length],
        status: index % 10 === 9 ? 'inactive' : 'active',
        ownerEmail: userFixtures[agentIndex].email,
        ownerIndex: agentIndex,
        groupIndex,
      });
    }
    firstContactIndex += contactGroupSizes[agentIndex];
  }

  return contacts;
}

const contactFixtures = makeContacts();

function dateParts(dateString) {
  const [year, month, day] = dateString.split('-').map(Number);
  return { year, month, day };
}

function dateStringFromUTC(date) {
  return date.toISOString().slice(0, 10);
}

function formatDateTime(date, hours, minutes, seconds = 0) {
  return `${date} ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function addSeconds(value, seconds) {
  const date = new Date(`${value.replace(' ', 'T')}Z`);
  date.setUTCSeconds(date.getUTCSeconds() + seconds);
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

function getBusinessDates(anchorDate) {
  const { year, month, day } = dateParts(anchorDate);
  const anchor = new Date(Date.UTC(year, month - 1, day, 12));
  const dates = [];

  for (let offset = 29; offset >= 0; offset -= 1) {
    const date = new Date(anchor);
    date.setUTCDate(date.getUTCDate() - offset);
    const weekday = date.getUTCDay();
    if (weekday !== 0 && weekday !== 6) dates.push(dateStringFromUTC(date));
  }
  return dates;
}

function anchorFromCallMarkers(rows, today) {
  const anchors = new Set();
  for (const row of rows) {
    const match = row.provider_call_sid.match(/^DEMO-CM-A1-(\d{8})-CALL-\d{3}$/);
    if (!match) throw new Error('Hay un marcador de llamada de demostración con formato inesperado; no se modificó la base.');
    anchors.add(match[1]);
  }
  if (anchors.size > 1) throw new Error('Hay cargas de demostración con distintas fechas ancla; no se modificó la base.');
  if (!anchors.size) return today.replace(/-/g, '');
  return [...anchors][0];
}

function anchorDateString(anchor) {
  return `${anchor.slice(0, 4)}-${anchor.slice(4, 6)}-${anchor.slice(6, 8)}`;
}

function callMarker(anchor, sequence) {
  return `${marker}-${anchor}-CALL-${String(sequence).padStart(3, '0')}`;
}

function buildCalls(anchor) {
  const dates = getBusinessDates(anchorDateString(anchor));
  if (dates.length === 0) throw new Error('No se encontraron días hábiles para generar llamadas.');
  const calls = [];
  let sequence = 0;
  let activeSequence = 0;

  for (let agentIndex = 0; agentIndex < activeAgentCallCounts.length; agentIndex += 1) {
    const count = activeAgentCallCounts[agentIndex];
    const contactGroup = contactFixtures.filter((contact) => contact.ownerIndex === agentIndex);
    const statusCounts = [
      { status: 'completed', count: [18, 16, 14, 12, 10, 7][agentIndex] },
      { status: 'failed', count: [4, 4, 3, 4, 3, 2][agentIndex] },
      { status: 'queued', count: [3, 2, 2, 2, 2, 1][agentIndex] },
      { status: 'active', count: [3, 2, 2, 1, 1, 2][agentIndex] },
    ];
    const statuses = [];
    for (let offset = 0; offset < Math.max(...statusCounts.map((entry) => entry.count)); offset += 1) {
      for (const entry of statusCounts) {
        if (offset < entry.count) statuses.push(entry.status);
      }
    }
    if (statuses.length !== count) throw new Error('La distribución interna de llamadas no coincide.');

    for (let localIndex = 0; localIndex < count; localIndex += 1) {
      sequence += 1;
      const status = statuses[localIndex];
      const contact = contactGroup[(localIndex * contactGroupSteps[agentIndex]) % contactGroup.length];
      const dayIndex = (sequence * 13 + agentIndex * 7) % dates.length;
      const morning = (sequence * 7 + agentIndex * 5) % 20 < 11;
      const morningSlots = [[9, 0], [9, 25], [9, 50], [10, 15], [10, 45], [11, 10], [11, 35], [11, 55], [12, 15]];
      const afternoonSlots = [[13, 0], [13, 25], [13, 50], [14, 20], [14, 50], [15, 20], [15, 50], [16, 20]];
      const slots = morning ? morningSlots : afternoonSlots;
      const [hours, minutes] = slots[(sequence * 5 + agentIndex * 3) % slots.length];
      const duration = status === 'completed'
        ? 55 + ((sequence * 97 + agentIndex * 41) % 446)
        : status === 'failed'
          ? (sequence * 29 + agentIndex * 17) % 46
          : 0;
      const score = status === 'completed'
        ? 60 + ((sequence * 13 + agentIndex * 7) % 41)
        : 0;
      const direction = (sequence * 7 + agentIndex * 3) % 10 < 4 ? 'inbound' : 'outbound';

      const call = {
        sequence,
        marker: callMarker(anchor, sequence),
        contactEmail: contact.email,
        agentEmail: userFixtures[agentIndex].email,
        phoneNumber: contact.phone,
        direction,
        status,
        duration,
        score,
        createdAt: formatDateTime(dates[dayIndex], hours, minutes, (sequence * 17) % 60),
      };
      if (status === 'active') {
        call.queueStatus = activeSequence === 3 ? 'monitoring'
          : activeSequence === 7 ? 'escalated' : 'waiting';
        activeSequence += 1;
      }
      calls.push(call);
    }
  }

  return calls.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.sequence - right.sequence);
}

function assertApplyPassword(required) {
  const password = process.env.DEMO_AGENT_PASSWORD;
  if (required && (typeof password !== 'string' || password.length < 12)) {
    throw new Error('Define DEMO_AGENT_PASSWORD (mínimo 12 caracteres) para crear las cuentas de prueba.');
  }
  return password;
}

async function getDemoContext(connection) {
  const [[databaseClock]] = await connection.query(
    "SELECT DATE_FORMAT(CURRENT_DATE(), '%Y-%m-%d') AS today"
  );
  const [[userRole]] = await connection.query(
    "SELECT id FROM roles WHERE name = 'USER'"
  );
  if (!userRole) throw new Error('No existe el rol reservado USER; no se modificó la base.');

  const [[adminCount]] = await connection.query(
    `SELECT COUNT(*) AS count
     FROM users u JOIN roles r ON r.id = u.role_id
     WHERE r.name = 'ADMIN' AND u.status = 'active'`
  );
  if (Number(adminCount.count) < 1) throw new Error('No hay un administrador activo; no se modificó la base.');

  const userEmails = userFixtures.map((user) => user.email);
  const [users] = await connection.query(
    `SELECT u.id, u.email, r.name AS roleName, u.status
     FROM users u JOIN roles r ON r.id = u.role_id
     WHERE u.email IN (${userEmails.map(() => '?').join(', ')})`,
    userEmails
  );
  const usersByEmail = new Map(users.map((user) => [user.email, user]));
  for (const [email, user] of usersByEmail) {
    if (user.roleName !== 'USER') {
      throw new Error(`El correo reservado ${email} ya pertenece a un rol distinto de USER; no se modificó la base.`);
    }
  }

  const [markedCalls] = await connection.query(
    'SELECT provider_call_sid FROM calls WHERE provider_call_sid LIKE ?',
    [`${marker}-%`]
  );
  const anchor = anchorFromCallMarkers(markedCalls, databaseClock.today);
  const calls = buildCalls(anchor);
  return {
    today: databaseClock.today,
    anchor,
    userRoleId: userRole.id,
    adminCount: Number(adminCount.count),
    usersByEmail,
    calls,
  };
}

async function getDryRunCounts(connection, context) {
  const contactEmails = contactFixtures.map((contact) => contact.email);
  const [existingContacts] = await connection.query(
    `SELECT email FROM contacts WHERE email IN (${contactEmails.map(() => '?').join(', ')})`,
    contactEmails
  );
  const contactsByEmail = new Map();
  for (const contact of existingContacts) {
    contactsByEmail.set(contact.email, (contactsByEmail.get(contact.email) || 0) + 1);
  }
  if ([...contactsByEmail.values()].some((count) => count > 1)) {
    throw new Error('Hay correos de contacto de demostración duplicados; no se modificó la base.');
  }

  const callMarkers = context.calls.map((call) => call.marker);
  const [existingCalls] = await connection.query(
    `SELECT id, provider_call_sid, status
     FROM calls WHERE provider_call_sid IN (${callMarkers.map(() => '?').join(', ')})`,
    callMarkers
  );
  const existingCallsByMarker = new Map(existingCalls.map((call) => [call.provider_call_sid, call]));
  const expectedRecordingCalls = context.calls
    .filter((call) => call.status === 'completed')
    .slice(0, recordingCount);
  const recordingCallIds = expectedRecordingCalls
    .map((call) => existingCallsByMarker.get(call.marker)?.id)
    .filter((id) => id != null);
  let existingRecordings = [];
  if (recordingCallIds.length) {
    [existingRecordings] = await connection.query(
      `SELECT call_id FROM recordings WHERE call_id IN (${recordingCallIds.map(() => '?').join(', ')})`,
      recordingCallIds
    );
  }
  const callsWithRecordings = new Set(existingRecordings.map((recording) => String(recording.call_id)));

  const existingUserIds = [...context.usersByEmail.values()].map((user) => user.id);
  let existingPresence = [];
  if (existingUserIds.length) {
    [existingPresence] = await connection.query(
      `SELECT user_id FROM agent_presence WHERE user_id IN (${existingUserIds.map(() => '?').join(', ')})`,
      existingUserIds
    );
  }
  const markedCallIds = existingCalls.length
    ? await connection.query(
      `SELECT id FROM calls WHERE provider_call_sid IN (${callMarkers.map(() => '?').join(', ')}) AND status = 'active'`,
      callMarkers
    )
    : [[]];
  const activeCallIds = markedCallIds[0].map((row) => row.id);
  let existingQueue = [];
  if (activeCallIds.length) {
    [existingQueue] = await connection.query(
      `SELECT call_id FROM surveillance_queue WHERE call_id IN (${activeCallIds.map(() => '?').join(', ')})`,
      activeCallIds
    );
  }

  const planned = {
    roles: 0,
    users: userFixtures.length - context.usersByEmail.size,
    contacts: contactFixtures.length - existingContacts.length,
    calls: context.calls.length - existingCalls.length,
    recordings: expectedRecordingCalls.filter((call) => {
      const callId = existingCallsByMarker.get(call.marker)?.id;
      return callId == null || !callsWithRecordings.has(String(callId));
    }).length,
    agent_presence: Math.max(0, 6 - existingPresence.length),
    surveillance_queue: context.calls.filter((call) =>
      call.status === 'active' && !existingCallsByMarker.has(call.marker)
    ).length,
  };
  return {
    planned,
    existingMarkers: {
      users: context.usersByEmail.size,
      contacts: existingContacts.length,
      calls: existingCalls.length,
      recordings: existingRecordings.length,
      agent_presence: existingPresence.length,
      surveillance_queue: existingQueue.length,
    },
  };
}

async function insertUsers(connection, context, passwordHash, inserted) {
  const userIds = new Map();
  for (const fixture of userFixtures) {
    const existing = context.usersByEmail.get(fixture.email);
    if (existing) {
      userIds.set(fixture.email, existing.id);
      continue;
    }
    const [[createdAt]] = await connection.query(
      'SELECT DATE_FORMAT(DATE_SUB(?, INTERVAL 29 DAY), \'%Y-%m-%d 08:30:00\') AS createdAt',
      [context.today]
    );
    const [result] = await connection.query(
      `INSERT INTO users (name, email, password_hash, role_id, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [fixture.name, fixture.email, passwordHash, context.userRoleId, fixture.status, createdAt.createdAt]
    );
    userIds.set(fixture.email, result.insertId);
    inserted.users += 1;
  }
  return userIds;
}

async function insertContacts(connection, userIds, inserted) {
  const contactIds = new Map();
  for (const fixture of contactFixtures) {
    const [existingRows] = await connection.query(
      `SELECT id, name, company, phone, email, owner_id, status
       FROM contacts WHERE email = ?`,
      [fixture.email]
    );
    if (existingRows.length > 1) {
      throw new Error(`El correo reservado ${fixture.email} aparece más de una vez; no se modificó la base.`);
    }
    const ownerId = userIds.get(fixture.ownerEmail);
    if (!ownerId) throw new Error('No se pudo resolver el propietario de un contacto; no se modificó la base.');

    if (existingRows.length) {
      const existing = existingRows[0];
      if (existing.name !== fixture.name || existing.company !== fixture.company ||
          existing.phone !== fixture.phone || Number(existing.owner_id) !== Number(ownerId) ||
          existing.status !== fixture.status) {
        throw new Error(`El contacto reservado ${fixture.email} fue modificado; no se sobrescribió.`);
      }
      contactIds.set(fixture.email, existing.id);
      continue;
    }

    const [[createdAt]] = await connection.query(
      'SELECT DATE_FORMAT(DATE_SUB(CURRENT_DATE(), INTERVAL 29 DAY), \'%Y-%m-%d 08:30:00\') AS createdAt'
    );
    const [result] = await connection.query(
      `INSERT INTO contacts (owner_id, name, company, phone, email, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [ownerId, fixture.name, fixture.company, fixture.phone, fixture.email, fixture.status, createdAt.createdAt]
    );
    contactIds.set(fixture.email, result.insertId);
    inserted.contacts += 1;
  }
  return contactIds;
}

async function insertCalls(connection, context, userIds, contactIds, inserted) {
  const callIds = new Map();
  const newlyInserted = new Set();
  const existingMarkers = context.calls.map((call) => call.marker);
  const [existingRows] = await connection.query(
    `SELECT id, contact_id, agent_id, phone_number, provider_call_sid
     FROM calls WHERE provider_call_sid IN (${existingMarkers.map(() => '?').join(', ')})`,
    existingMarkers
  );
  const existingByMarker = new Map(existingRows.map((row) => [row.provider_call_sid, row]));

  const activeSeedAgents = [...new Set(context.calls.map((call) => call.agentEmail))];
  const agentStatuses = new Map([...context.usersByEmail.values()].map((user) => [user.email, user.status]));
  for (const email of activeSeedAgents) {
    if (context.usersByEmail.has(email) && agentStatuses.get(email) !== 'active') {
      const missingCalls = context.calls.some((call) => call.agentEmail === email && !existingByMarker.has(call.marker));
      if (missingCalls) throw new Error(`El agente de prueba ${email} ya no está activo; no se asignaron llamadas.`);
    }
  }

  for (const call of context.calls) {
    const contactId = contactIds.get(call.contactEmail);
    const agentId = userIds.get(call.agentEmail);
    if (!contactId || !agentId) throw new Error('No se pudieron resolver las relaciones de una llamada; no se modificó la base.');

    const existing = existingByMarker.get(call.marker);
    if (existing) {
      if (Number(existing.contact_id) !== Number(contactId) || Number(existing.agent_id) !== Number(agentId) ||
          existing.phone_number !== call.phoneNumber) {
        throw new Error(`La llamada marcada ${call.marker} tiene relaciones alteradas; no se sobrescribió.`);
      }
      callIds.set(call.sequence, existing.id);
      continue;
    }

    const [result] = await connection.query(
      `INSERT INTO calls
        (contact_id, agent_id, phone_number, direction, status, duration_seconds, score,
         provider_call_sid, agent_device_session_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      [
        contactId,
        agentId,
        call.phoneNumber,
        call.direction,
        call.status,
        call.duration,
        call.score,
        call.marker,
        call.createdAt,
      ]
    );
    callIds.set(call.sequence, result.insertId);
    newlyInserted.add(call.sequence);
    inserted.calls += 1;
  }
  return { callIds, newlyInserted };
}

async function insertRecordings(connection, context, callsBySequence, inserted) {
  const completedCalls = context.calls
    .filter((call) => call.status === 'completed')
    .slice(0, recordingCount);
  for (const [index, call] of completedCalls.entries()) {
    const callId = callsBySequence.get(call.sequence);
    const [[existing]] = await connection.query(
      'SELECT id FROM recordings WHERE call_id = ? LIMIT 1',
      [callId]
    );
    if (existing) continue;

    const fileName = `${call.marker}-REC-${String(index + 1).padStart(3, '0')}-NO-AUDIO-METADATA`;
    await connection.query(
      `INSERT INTO recordings (call_id, file_name, url, duration_seconds, transcription, created_at)
       VALUES (?, ?, NULL, 0, NULL, ?)`,
      [callId, fileName, addSeconds(call.createdAt, call.duration)]
    );
    inserted.recordings += 1;
  }
}

async function insertPresence(connection, userIds, inserted) {
  for (const fixture of userFixtures.filter((user) => user.status === 'active')) {
    const userId = userIds.get(fixture.email);
    const [[existing]] = await connection.query(
      'SELECT user_id FROM agent_presence WHERE user_id = ?',
      [userId]
    );
    if (existing) continue;
    await connection.query(
      `INSERT INTO agent_presence (user_id, status, device_session_id)
       VALUES (?, 'offline', NULL)`,
      [userId]
    );
    inserted.agent_presence += 1;
  }
}

async function insertQueue(connection, context, userIds, callsBySequence, newlyInserted, inserted) {
  for (const call of context.calls.filter((item) => item.status === 'active')) {
    if (!newlyInserted.has(call.sequence)) continue;
    await connection.query(
      `INSERT INTO surveillance_queue (agent_id, call_id, status, created_at)
       VALUES (?, ?, ?, ?)`,
      [userIds.get(call.agentEmail), callsBySequence.get(call.sequence), call.queueStatus, call.createdAt]
    );
    inserted.surveillance_queue += 1;
  }
}

async function main() {
  for (const argument of process.argv.slice(2)) {
    if (!allowedArguments.has(argument)) throw new Error(`Argumento desconocido: ${argument}`);
  }

  const connection = await pool.getConnection();
  let transactionStarted = false;
  let lockAcquired = false;
  try {
    const [[lock]] = await connection.query('SELECT GET_LOCK(?, 10) AS acquired', [lockName]);
    if (Number(lock.acquired) !== 1) throw new Error('No se pudo obtener el bloqueo de la carga de demostración.');
    lockAcquired = true;

    if (applyChanges) {
      await connection.beginTransaction();
      transactionStarted = true;
    }

    const context = await getDemoContext(connection);
    const counts = await getDryRunCounts(connection, context);

    if (!applyChanges) {
      console.log(JSON.stringify({
        mode: 'dry-run (sin escrituras)',
        anchorDate: anchorDateString(context.anchor),
        currentActiveAdminsPreserved: context.adminCount,
        existingDemoRecords: counts.existingMarkers,
        wouldInsert: counts.planned,
      }, null, 2));
      return;
    }

    const password = assertApplyPassword(counts.planned.users > 0);
    const passwordHash = counts.planned.users > 0 ? await bcrypt.hash(password, 10) : null;

    const inserted = {
      roles: 0,
      users: 0,
      contacts: 0,
      calls: 0,
      recordings: 0,
      agent_presence: 0,
      surveillance_queue: 0,
    };

    const userIds = await insertUsers(connection, context, passwordHash, inserted);
    const contactIds = await insertContacts(connection, userIds, inserted);
    const { callIds, newlyInserted } = await insertCalls(
      connection,
      context,
      userIds,
      contactIds,
      inserted
    );
    await insertRecordings(connection, context, callIds, inserted);
    await insertPresence(connection, userIds, inserted);
    await insertQueue(connection, context, userIds, callIds, newlyInserted, inserted);

    const [[finalAdminCount]] = await connection.query(
      `SELECT COUNT(*) AS count
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE r.name = 'ADMIN' AND u.status = 'active'`
    );
    if (Number(finalAdminCount.count) !== context.adminCount) {
      throw new Error('Cambió el número de administradores activos durante la carga; se cancelará la transacción.');
    }

    await connection.commit();
    transactionStarted = false;
    console.log(JSON.stringify({
      mode: 'applied',
      anchorDate: anchorDateString(context.anchor),
      inserted,
      activeAdminsPreserved: context.adminCount,
    }, null, 2));
  } catch (error) {
    if (transactionStarted) await connection.rollback();
    throw error;
  } finally {
    try {
      if (lockAcquired) await connection.query('SELECT RELEASE_LOCK(?)', [lockName]);
    } finally {
      connection.release();
      await pool.end();
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
