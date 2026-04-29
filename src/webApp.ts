import type {
  AppOperationResponse,
  AppState,
  ClientInput,
  ClientRecord,
  FollowUpHistoryItem,
  RuntimeInfo,
  SettingsInput,
  SettingsState,
} from './types'

const STORAGE_KEY = 'hessa-followup-web'
const MAX_CONTACTS = 4
const DEFAULT_SCHEDULE_TIMES = ['09:00', '11:00', '14:00', '16:00']
const statusPriority = {
  active: 0,
  finished: 1,
  canceled: 2,
} as const

type Database = {
  version: number
  settings: SettingsState
  clients: ClientRecord[]
}

function createDefaultTemplates() {
  return Array.from({ length: MAX_CONTACTS }, (_, index) => {
    const contactNumber = index + 1

    return {
      id: `contact-${contactNumber}`,
      title: `Touchpoint ${contactNumber}`,
      subject: `Follow-up ${contactNumber} of {{maxContacts}} for {{name}}`,
      body: [
        'Hi {{name}},',
        '',
        `I wanted to follow up on touchpoint ${contactNumber} of {{maxContacts}}.`,
        'We are still available to answer questions and help you move forward.',
        '',
        'If you would like to continue the conversation, just reply and we will take it from there.',
        '',
        'Best,',
        '{{fromName}}',
      ].join('\n'),
    }
  })
}

function createLegacyDefaultTemplates() {
  return Array.from({ length: MAX_CONTACTS }, (_, index) => {
    const contactNumber = index + 1

    return {
      subject: `Seguimiento ${contactNumber} de {{maxContacts}} para {{name}}`,
      body: [
        'Hola {{name}},',
        '',
        `Te escribimos para dar continuidad a nuestro contacto ${contactNumber} de {{maxContacts}}.`,
        'Seguimos atentos a tu interes y a cualquier duda que tengas.',
        '',
        'Si quieres continuar, responde este correo y te ayudamos de inmediato.',
        '',
        'Saludos,',
        '{{fromName}}',
      ].join('\n'),
    }
  })
}

const defaultDatabase: Database = Object.freeze({
  version: 1,
  settings: {
    sender: {
      fromEmail: '',
      fromName: 'Hessa Enterprises',
    },
    templates: createDefaultTemplates(),
    automation: {
      intervalDays: 2,
      autoOpenDraftOnCreate: true,
    },
  },
  clients: [],
})

function createId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function cloneDefaultDatabase() {
  return JSON.parse(JSON.stringify(defaultDatabase)) as Database
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function clampTargetContacts(value: unknown) {
  if (!Number.isInteger(value)) {
    return MAX_CONTACTS
  }

  const numericValue = value as number
  return Math.min(MAX_CONTACTS, Math.max(1, numericValue))
}

function normalizeScheduleTime(value: unknown, fallback = '09:00') {
  if (typeof value !== 'string') {
    return fallback
  }

  const normalized = value.trim()
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(normalized) ? normalized : fallback
}

function normalizeTemplates(rawTemplates: unknown) {
  const defaults = createDefaultTemplates()
  const legacyDefaults = createLegacyDefaultTemplates()

  if (!Array.isArray(rawTemplates) || rawTemplates.length === 0) {
    return defaults
  }

  return defaults.map((template, index) => {
    const incomingTemplate = rawTemplates[index]
    const legacyTemplate = legacyDefaults[index]
    const subject =
      incomingTemplate &&
      typeof incomingTemplate === 'object' &&
      'subject' in incomingTemplate &&
      typeof incomingTemplate.subject === 'string' &&
      incomingTemplate.subject.trim()
        ? incomingTemplate.subject === legacyTemplate.subject
          ? template.subject
          : incomingTemplate.subject
        : template.subject
    const body =
      incomingTemplate &&
      typeof incomingTemplate === 'object' &&
      'body' in incomingTemplate &&
      typeof incomingTemplate.body === 'string' &&
      incomingTemplate.body.trim()
        ? incomingTemplate.body === legacyTemplate.body
          ? template.body
          : incomingTemplate.body
        : template.body

    return {
      id: template.id,
      title: template.title,
      subject,
      body,
    }
  })
}

function normalizeHistory(rawHistory: unknown) {
  if (!Array.isArray(rawHistory)) {
    return []
  }

  return rawHistory.map((historyItem): FollowUpHistoryItem => {
    const normalized =
      historyItem && typeof historyItem === 'object' ? historyItem : Object.create(null)

    return {
      id:
        'id' in normalized && typeof normalized.id === 'string' && normalized.id
          ? normalized.id
          : createId(),
      contactNumber:
        'contactNumber' in normalized &&
        Number.isInteger(normalized.contactNumber) &&
        normalized.contactNumber > 0
          ? normalized.contactNumber
          : 1,
      status:
        'status' in normalized && normalized.status === 'failed' ? 'failed' : 'prepared',
      scheduledFor:
        'scheduledFor' in normalized && typeof normalized.scheduledFor === 'string'
          ? normalized.scheduledFor
          : new Date().toISOString(),
      happenedAt:
        'happenedAt' in normalized && typeof normalized.happenedAt === 'string'
          ? normalized.happenedAt
          : new Date().toISOString(),
      subject:
        'subject' in normalized && typeof normalized.subject === 'string'
          ? normalized.subject
          : '',
      preview:
        'preview' in normalized && typeof normalized.preview === 'string'
          ? normalized.preview
          : '',
      error:
        'error' in normalized && typeof normalized.error === 'string'
          ? normalized.error
          : null,
    }
  })
}

function normalizeClient(rawClient: unknown): ClientRecord {
  const normalized =
    rawClient && typeof rawClient === 'object' ? rawClient : Object.create(null)
  const targetContacts =
    'targetContacts' in normalized
      ? clampTargetContacts(normalized.targetContacts)
      : MAX_CONTACTS
  const sentContacts =
    'sentContacts' in normalized &&
    Number.isInteger(normalized.sentContacts) &&
    normalized.sentContacts >= 0
      ? Math.min(normalized.sentContacts, targetContacts)
      : 0
  const scheduleSource =
    'contactScheduleTimes' in normalized && Array.isArray(normalized.contactScheduleTimes)
      ? normalized.contactScheduleTimes
      : DEFAULT_SCHEDULE_TIMES
  const contactScheduleTimes = Array.from({ length: targetContacts }, (_, index) =>
    normalizeScheduleTime(scheduleSource[index], DEFAULT_SCHEDULE_TIMES[index]),
  )

  let status: ClientRecord['status'] = 'active'

  if ('status' in normalized && normalized.status === 'finished') {
    status = 'finished'
  } else if ('status' in normalized && normalized.status === 'canceled') {
    status = sentContacts >= targetContacts ? 'finished' : 'canceled'
  }

  return {
    id: ('id' in normalized && typeof normalized.id === 'string' && normalized.id) || createId(),
    name: ('name' in normalized && typeof normalized.name === 'string' && normalized.name) || '',
    email:
      ('email' in normalized && typeof normalized.email === 'string' && normalized.email) || '',
    company:
      ('company' in normalized && typeof normalized.company === 'string' && normalized.company) ||
      '',
    notes: ('notes' in normalized && typeof normalized.notes === 'string' && normalized.notes) || '',
    status,
    createdAt:
      ('createdAt' in normalized &&
        typeof normalized.createdAt === 'string' &&
        normalized.createdAt) ||
      new Date().toISOString(),
    updatedAt:
      ('updatedAt' in normalized &&
        typeof normalized.updatedAt === 'string' &&
        normalized.updatedAt) ||
      new Date().toISOString(),
    canceledAt:
      ('canceledAt' in normalized && typeof normalized.canceledAt === 'string'
        ? normalized.canceledAt
        : null) || null,
    finishedAt:
      ('finishedAt' in normalized && typeof normalized.finishedAt === 'string'
        ? normalized.finishedAt
        : null) || null,
    nextContactAt:
      status === 'active' &&
      'nextContactAt' in normalized &&
      typeof normalized.nextContactAt === 'string'
        ? normalized.nextContactAt
        : null,
    lastContactAt:
      ('lastContactAt' in normalized && typeof normalized.lastContactAt === 'string'
        ? normalized.lastContactAt
        : null) || null,
    lastError:
      ('lastError' in normalized && typeof normalized.lastError === 'string'
        ? normalized.lastError
        : null) || null,
    sentContacts,
    targetContacts,
    contactScheduleTimes,
    history: normalizeHistory('history' in normalized ? normalized.history : []),
  }
}

function normalizeDatabase(rawData: unknown): Database {
  const database = cloneDefaultDatabase()
  const normalized = rawData && typeof rawData === 'object' ? rawData : Object.create(null)
  const rawSettings =
    'settings' in normalized && normalized.settings && typeof normalized.settings === 'object'
      ? normalized.settings
      : Object.create(null)
  const rawSender =
    'sender' in rawSettings && rawSettings.sender && typeof rawSettings.sender === 'object'
      ? rawSettings.sender
      : Object.create(null)
  const rawAutomation =
    'automation' in rawSettings &&
    rawSettings.automation &&
    typeof rawSettings.automation === 'object'
      ? rawSettings.automation
      : Object.create(null)

  database.version =
    'version' in normalized && Number.isInteger(normalized.version) && normalized.version > 0
      ? normalized.version
      : 1

  database.settings = {
    sender: {
      fromEmail:
        ('fromEmail' in rawSender && typeof rawSender.fromEmail === 'string'
          ? rawSender.fromEmail
          : database.settings.sender.fromEmail) || '',
      fromName:
        ('fromName' in rawSender && typeof rawSender.fromName === 'string'
          ? rawSender.fromName
          : database.settings.sender.fromName) || 'Hessa Enterprises',
    },
    templates: normalizeTemplates('templates' in rawSettings ? rawSettings.templates : []),
    automation: {
      intervalDays:
        'intervalDays' in rawAutomation &&
        Number.isInteger(rawAutomation.intervalDays) &&
        rawAutomation.intervalDays > 0
          ? rawAutomation.intervalDays
          : database.settings.automation.intervalDays,
      autoOpenDraftOnCreate:
        'autoOpenDraftOnCreate' in rawAutomation &&
        typeof rawAutomation.autoOpenDraftOnCreate === 'boolean'
          ? rawAutomation.autoOpenDraftOnCreate
          : database.settings.automation.autoOpenDraftOnCreate,
    },
  }

  database.clients =
    'clients' in normalized && Array.isArray(normalized.clients)
      ? normalized.clients.map(normalizeClient)
      : []

  return database
}

function loadDatabase() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)

    if (!stored) {
      return cloneDefaultDatabase()
    }

    return normalizeDatabase(JSON.parse(stored))
  } catch {
    return cloneDefaultDatabase()
  }
}

function saveDatabase(database: Database) {
  const normalized = normalizeDatabase(database)
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
  return normalized
}

function sortClients(clients: ClientRecord[]) {
  return [...clients].sort((left, right) => {
    const leftStatus = statusPriority[left.status] ?? 99
    const rightStatus = statusPriority[right.status] ?? 99

    if (leftStatus !== rightStatus) {
      return leftStatus - rightStatus
    }

    if (left.status === 'active' && right.status === 'active') {
      const leftTime = left.nextContactAt
        ? new Date(left.nextContactAt).getTime()
        : Number.MAX_SAFE_INTEGER
      const rightTime = right.nextContactAt
        ? new Date(right.nextContactAt).getTime()
        : Number.MAX_SAFE_INTEGER

      if (leftTime !== rightTime) {
        return leftTime - rightTime
      }
    }

    const leftUpdated = new Date(left.updatedAt).getTime()
    const rightUpdated = new Date(right.updatedAt).getTime()
    return rightUpdated - leftUpdated
  })
}

function summarizeClients(clients: ClientRecord[]) {
  const now = Date.now()

  return clients.reduce(
    (stats, client) => {
      stats.total += 1

      if (client.status === 'active') {
        stats.active += 1
      }

      if (client.status === 'finished') {
        stats.finished += 1
      }

      if (client.status === 'canceled') {
        stats.canceled += 1
      }

      if (client.status === 'active' && client.nextContactAt) {
        const nextContactTime = new Date(client.nextContactAt).getTime()

        if (!Number.isNaN(nextContactTime) && nextContactTime <= now) {
          stats.dueNow += 1
        }
      }

      if (client.lastError) {
        stats.withErrors += 1
      }

      return stats
    },
    {
      active: 0,
      canceled: 0,
      dueNow: 0,
      finished: 0,
      total: 0,
      withErrors: 0,
    },
  )
}

function buildDateAtTime(referenceIso: string, timeValue: string, daysToAdd = 0) {
  const [hours, minutes] = normalizeScheduleTime(timeValue).split(':').map(Number)
  const scheduledDate = new Date(referenceIso)
  scheduledDate.setDate(scheduledDate.getDate() + daysToAdd)
  scheduledDate.setHours(hours, minutes, 0, 0)
  return scheduledDate
}

function scheduleSameDayOrImmediate(referenceIso: string, timeValue: string) {
  const scheduledDate = buildDateAtTime(referenceIso, timeValue)
  const referenceDate = new Date(referenceIso)
  return scheduledDate.getTime() < referenceDate.getTime()
    ? referenceDate.toISOString()
    : scheduledDate.toISOString()
}

function scheduleFollowUp(referenceIso: string, timeValue: string, intervalDays: number) {
  return buildDateAtTime(referenceIso, timeValue, intervalDays).toISOString()
}

function getScheduleTime(client: ClientRecord, contactNumber: number) {
  return normalizeScheduleTime(
    client.contactScheduleTimes[contactNumber - 1],
    DEFAULT_SCHEDULE_TIMES[contactNumber - 1] ?? '09:00',
  )
}

function getNextScheduledAt(
  client: ClientRecord,
  referenceIso: string,
  contactNumber: number,
  intervalDays: number,
  mode: 'follow-up' | 'initial' | 'resume' = 'follow-up',
) {
  const timeValue = getScheduleTime(client, contactNumber)

  if (mode === 'initial' || mode === 'resume') {
    return scheduleSameDayOrImmediate(referenceIso, timeValue)
  }

  return scheduleFollowUp(referenceIso, timeValue, intervalDays)
}

function toDateLabel(isoDate: string) {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(isoDate))
}

function toTimeLabel(isoDate: string) {
  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(isoDate))
}

function buildTemplateContext(
  client: ClientRecord,
  settings: SettingsState,
  contactNumber: number,
  scheduledFor: string,
) {
  return {
    attemptsCompleted: String(client.sentContacts),
    company: client.company || '',
    companyOrName: client.company || client.name,
    contactNumber: String(contactNumber),
    createdDate: toDateLabel(client.createdAt),
    email: client.email,
    fromEmail: settings.sender.fromEmail,
    fromName: settings.sender.fromName || 'Hessa Enterprises',
    maxContacts: String(client.targetContacts),
    name: client.name,
    nextContactDate: scheduledFor ? toDateLabel(scheduledFor) : '',
    notes: client.notes || '',
    scheduledDate: scheduledFor ? toDateLabel(scheduledFor) : '',
    scheduledTime: scheduledFor ? toTimeLabel(scheduledFor) : '',
  }
}

function fillTemplate(template: string, context: Record<string, string>) {
  return template.replace(/{{\s*([a-zA-Z0-9]+)\s*}}/g, (_, key) => context[key] ?? '')
}

function getTemplate(settings: SettingsState, contactNumber: number) {
  return settings.templates[contactNumber - 1] ?? settings.templates.at(-1)
}

function buildEmailPayload(
  client: ClientRecord,
  settings: SettingsState,
  contactNumber: number,
  scheduledFor: string,
) {
  const template = getTemplate(settings, contactNumber)
  const context = buildTemplateContext(client, settings, contactNumber, scheduledFor)
  const subject = fillTemplate(template.subject, context)
  const body = fillTemplate(template.body, context)

  return {
    subject,
    body,
    preview: body.split('\n').find((line) => line.trim())?.trim() ?? '',
  }
}

function createMailtoLink(recipient: string, subject: string, body: string) {
  const query = new URLSearchParams({
    subject,
    body,
  })

  return `mailto:${encodeURIComponent(recipient)}?${query.toString()}`
}

function openMailDraft(recipient: string, subject: string, body: string) {
  window.location.href = createMailtoLink(recipient, subject, body)
}

function getRuntimeInfo(): RuntimeInfo {
  const userAgent = navigator.userAgent
  let browser = 'Current browser'

  if (userAgent.includes('Edg/')) {
    browser = 'Microsoft Edge'
  } else if (userAgent.includes('Chrome/')) {
    browser = 'Google Chrome'
  } else if (userAgent.includes('Firefox/')) {
    browser = 'Mozilla Firefox'
  } else if (userAgent.includes('Safari/')) {
    browser = 'Safari'
  }

  return {
    browser,
    platform: 'web',
    storage: 'localStorage',
  }
}

function getAppStateFromDatabase(database: Database): AppState {
  return {
    runtimeInfo: getRuntimeInfo(),
    settings: database.settings,
    stats: summarizeClients(database.clients),
    clients: sortClients(database.clients),
  }
}

function persistDatabase(database: Database) {
  database.clients = sortClients(database.clients)
  return saveDatabase(database)
}

function mergeSettings(currentSettings: SettingsState, incomingSettings: SettingsInput): SettingsState {
  return {
    sender: {
      fromEmail: incomingSettings.sender.fromEmail.trim(),
      fromName: incomingSettings.sender.fromName.trim() || 'Hessa Enterprises',
    },
    templates: normalizeTemplates(incomingSettings.templates).map((template, index) => ({
      id: template.id,
      title: template.title,
      subject: incomingSettings.templates[index]?.subject?.trim() || currentSettings.templates[index].subject,
      body: incomingSettings.templates[index]?.body || currentSettings.templates[index].body,
    })),
    automation: {
      intervalDays: Math.max(1, incomingSettings.automation.intervalDays || 2),
      autoOpenDraftOnCreate: incomingSettings.automation.autoOpenDraftOnCreate,
    },
  }
}

function selectClientsForProcessing(clients: ClientRecord[], options: { clientId?: string; force?: boolean } = {}) {
  const now = Date.now()

  return sortClients(
    clients.filter((client) => {
      if (client.status !== 'active') {
        return false
      }

      if (client.sentContacts >= client.targetContacts) {
        return false
      }

      if (options.clientId && client.id !== options.clientId) {
        return false
      }

      if (!client.nextContactAt) {
        return Boolean(options.force)
      }

      if (options.force) {
        return true
      }

      return new Date(client.nextContactAt).getTime() <= now
    }),
  )
}

function advanceClientWithDraft(database: Database, client: ClientRecord) {
  const contactNumber = client.sentContacts + 1
  const scheduledFor = client.nextContactAt ?? new Date().toISOString()
  const payload = buildEmailPayload(client, database.settings, contactNumber, scheduledFor)

  openMailDraft(client.email, payload.subject, payload.body)

  const preparedAt = new Date().toISOString()
  client.sentContacts = contactNumber
  client.lastContactAt = preparedAt
  client.lastError = null
  client.updatedAt = preparedAt
  client.history.unshift({
    id: createId(),
    contactNumber,
    status: 'prepared',
    scheduledFor,
    happenedAt: preparedAt,
    subject: payload.subject,
    preview: payload.preview,
    error: null,
  })

  if (client.sentContacts >= client.targetContacts) {
    client.status = 'finished'
    client.finishedAt = preparedAt
    client.nextContactAt = null
  } else {
    client.nextContactAt = getNextScheduledAt(
      client,
      preparedAt,
      contactNumber + 1,
      database.settings.automation.intervalDays,
    )
  }

  return payload
}

function buildOperationResponse(database: Database, message: string): AppOperationResponse {
  return {
    ...getAppStateFromDatabase(database),
    result: {
      failed: 0,
      message,
      processed: 1,
      sent: 1,
    },
  }
}

export const webApp = {
  async getAppState() {
    return getAppStateFromDatabase(loadDatabase())
  },

  async saveSettings(incomingSettings: SettingsInput) {
    const database = loadDatabase()
    database.settings = mergeSettings(database.settings, incomingSettings)
    const persisted = persistDatabase(database)

    return {
      ...getAppStateFromDatabase(persisted),
      result: {
        failed: 0,
        message: 'Workspace settings saved successfully.',
        processed: 0,
        sent: 0,
      },
    }
  },

  async createClient(clientInput: ClientInput) {
    const name = clientInput.name.trim()
    const email = clientInput.email.trim().toLowerCase()
    const company = clientInput.company.trim()
    const notes = clientInput.notes.trim()
    const targetContacts = clampTargetContacts(clientInput.targetContacts)

    if (!name) {
      throw new Error('Client name is required.')
    }

    if (!isValidEmail(email)) {
      throw new Error('Please enter a valid client email address.')
    }

    const contactScheduleTimes = Array.from({ length: targetContacts }, (_, index) =>
      normalizeScheduleTime(clientInput.contactScheduleTimes[index], DEFAULT_SCHEDULE_TIMES[index]),
    )

    const database = loadDatabase()
    const createdAt = new Date().toISOString()
    const client: ClientRecord = {
      id: createId(),
      name,
      email,
      company,
      notes,
      status: 'active',
      createdAt,
      updatedAt: createdAt,
      canceledAt: null,
      finishedAt: null,
      nextContactAt: null,
      lastContactAt: null,
      lastError: null,
      sentContacts: 0,
      targetContacts,
      contactScheduleTimes,
      history: [],
    }

    client.nextContactAt = getNextScheduledAt(
      client,
      createdAt,
      1,
      database.settings.automation.intervalDays,
      'initial',
    )

    database.clients.unshift(client)
    persistDatabase(database)

    const shouldAutoOpen =
      database.settings.automation.autoOpenDraftOnCreate &&
      client.nextContactAt !== null &&
      new Date(client.nextContactAt).getTime() <= Date.now()

    if (shouldAutoOpen) {
      return this.sendClientFollowUp(client.id)
    }

    return {
      ...getAppStateFromDatabase(loadDatabase()),
      result: {
        failed: 0,
        message: `Client added. First draft scheduled for ${toDateLabel(client.nextContactAt)}.`,
        processed: 0,
        sent: 0,
      },
    }
  },

  async processDueFollowUps() {
    const database = loadDatabase()
    const candidates = selectClientsForProcessing(database.clients)

    if (candidates.length === 0) {
      return {
        ...getAppStateFromDatabase(database),
        result: {
          failed: 0,
          message: 'There are no scheduled follow-ups ready to open.',
          processed: 0,
          sent: 0,
        },
      }
    }

    const client = database.clients.find((item) => item.id === candidates[0].id)

    if (!client) {
      throw new Error('The next client in the queue could not be found.')
    }

    advanceClientWithDraft(database, client)
    const persisted = persistDatabase(database)
    const remainingDue = selectClientsForProcessing(persisted.clients).length
    const suffix =
      remainingDue > 0
        ? ` ${remainingDue} more scheduled follow-ups are still due.`
        : ''

    return buildOperationResponse(
      persisted,
      `Opened the next draft for ${client.name}.${suffix}`,
    )
  },

  async sendClientFollowUp(clientId: string) {
    if (!clientId) {
      throw new Error('A client must be selected before opening a draft.')
    }

    const database = loadDatabase()
    const client = database.clients.find((item) => item.id === clientId)

    if (!client) {
      throw new Error('The selected client could not be found.')
    }

    if (client.status !== 'active') {
      throw new Error('Only active clients can open follow-up drafts.')
    }

    if (client.sentContacts >= client.targetContacts) {
      throw new Error('This client has already completed the full sequence.')
    }

    advanceClientWithDraft(database, client)
    const persisted = persistDatabase(database)

    return buildOperationResponse(
      persisted,
      `Opened touchpoint ${client.sentContacts} for ${client.name}.`,
    )
  },

  async updateClientStatus(clientId: string, nextStatus: ClientRecord['status']) {
    const database = loadDatabase()
    const client = database.clients.find((item) => item.id === clientId)

    if (!client) {
      throw new Error('The selected client could not be found.')
    }

    const now = new Date().toISOString()

    if (nextStatus === 'active') {
      if (client.status === 'finished' || client.sentContacts >= client.targetContacts) {
        throw new Error('This client has already completed the sequence and can now be removed.')
      }

      client.status = 'active'
      client.canceledAt = null
      client.lastError = null
      client.updatedAt = now
      client.nextContactAt = getNextScheduledAt(
        client,
        now,
        client.sentContacts + 1,
        database.settings.automation.intervalDays,
        'resume',
      )
    } else {
      client.status = 'canceled'
      client.canceledAt = now
      client.updatedAt = now
      client.nextContactAt = null
    }

    const persisted = persistDatabase(database)

    return {
      ...getAppStateFromDatabase(persisted),
      result: {
        failed: 0,
        message:
          nextStatus === 'active'
            ? 'Client resumed and rescheduled.'
            : 'Client paused successfully.',
        processed: 0,
        sent: 0,
      },
    }
  },

  async deleteClient(clientId: string) {
    if (!clientId) {
      throw new Error('A client must be selected before deletion.')
    }

    const database = loadDatabase()
    const clientIndex = database.clients.findIndex((item) => item.id === clientId)

    if (clientIndex === -1) {
      throw new Error('The selected client could not be found.')
    }

    database.clients.splice(clientIndex, 1)
    const persisted = persistDatabase(database)

    return {
      ...getAppStateFromDatabase(persisted),
      result: {
        failed: 0,
        message: 'Client deleted successfully.',
        processed: 0,
        sent: 0,
      },
    }
  },
}
