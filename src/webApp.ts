import type {
  AuthActionResult,
  AppOperationResponse,
  AppState,
  AuthSession,
  AuthUser,
  ClientInput,
  ClientRecord,
  FollowUpHistoryItem,
  LoginInput,
  PasswordResetInput,
  PasswordUpdateInput,
  ProposalInput,
  ProposalRecord,
  RegisterInput,
  RuntimeInfo,
  SettingsInput,
  SettingsState,
} from './types'
import type { User } from '@supabase/supabase-js'
import { getSupabaseClient, supabaseFunctionBaseUrl } from './supabaseClient'

const LEGACY_STORAGE_KEY = 'hessa-followup-web'
const WORKSPACE_STORAGE_PREFIX = 'hessa-followup-web:workspace:'
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
  proposals: ProposalRecord[]
}

type EmailDeliveryOptions = {
  preferGmail?: boolean
}

type EmailDeliveryResult = {
  detail: string
  method: 'draft' | 'gmail'
}

type GmailSendFunctionResponse = {
  error?: string
  fromEmail?: string
  message?: string
  messageId?: string
  reason?: string
  sent: boolean
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
  proposals: [],
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

function toStoredEmail(email: string) {
  return email.trim().toLowerCase()
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

function normalizeProposalStatus(value: unknown): ProposalRecord['status'] {
  if (value === 'active' || value === 'finished' || value === 'canceled') {
    return value
  }

  if (value === 'approved') {
    return 'finished'
  }

  if (value === 'declined') {
    return 'canceled'
  }

  return 'active'
}

function normalizeProposal(rawProposal: unknown): ProposalRecord {
  const normalized =
    rawProposal && typeof rawProposal === 'object' ? rawProposal : Object.create(null)
  const targetFollowUps =
    'targetFollowUps' in normalized
      ? clampTargetContacts(normalized.targetFollowUps)
      : MAX_CONTACTS
  const sentFollowUps =
    'sentFollowUps' in normalized &&
    Number.isInteger(normalized.sentFollowUps) &&
    normalized.sentFollowUps >= 0
      ? Math.min(normalized.sentFollowUps, targetFollowUps)
      : 0
  const scheduleSource =
    'followUpScheduleTimes' in normalized && Array.isArray(normalized.followUpScheduleTimes)
      ? normalized.followUpScheduleTimes
      : DEFAULT_SCHEDULE_TIMES
  const followUpScheduleTimes = Array.from({ length: targetFollowUps }, (_, index) =>
    normalizeScheduleTime(scheduleSource[index], DEFAULT_SCHEDULE_TIMES[index]),
  )
  let status = normalizeProposalStatus('status' in normalized ? normalized.status : 'active')
  if (sentFollowUps >= targetFollowUps && status !== 'canceled') {
    status = 'finished'
  }
  const now = new Date().toISOString()

  return {
    id: ('id' in normalized && typeof normalized.id === 'string' && normalized.id) || createId(),
    clientName:
      ('clientName' in normalized &&
        typeof normalized.clientName === 'string' &&
        normalized.clientName) ||
      '',
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
      now,
    updatedAt:
      ('updatedAt' in normalized &&
        typeof normalized.updatedAt === 'string' &&
        normalized.updatedAt) ||
      now,
    canceledAt:
      ('canceledAt' in normalized && typeof normalized.canceledAt === 'string'
        ? normalized.canceledAt
        : null) || null,
    finishedAt:
      ('finishedAt' in normalized && typeof normalized.finishedAt === 'string'
        ? normalized.finishedAt
        : null) || null,
    nextFollowUpAt:
      status === 'active' &&
      sentFollowUps < targetFollowUps &&
      'nextFollowUpAt' in normalized &&
      typeof normalized.nextFollowUpAt === 'string'
        ? normalized.nextFollowUpAt
        : null,
    lastFollowUpAt:
      ('lastFollowUpAt' in normalized && typeof normalized.lastFollowUpAt === 'string'
        ? normalized.lastFollowUpAt
        : null) || null,
    lastError:
      ('lastError' in normalized && typeof normalized.lastError === 'string'
        ? normalized.lastError
        : null) || null,
    sentFollowUps,
    targetFollowUps,
    followUpScheduleTimes,
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

  database.proposals =
    'proposals' in normalized && Array.isArray(normalized.proposals)
      ? normalized.proposals.map(normalizeProposal)
      : []

  return database
}

function getRedirectUrl(mode?: 'reset-password') {
  const url = new URL(window.location.href)
  url.search = ''
  url.hash = ''

  if (mode) {
    url.searchParams.set('auth', mode)
  }

  return url.toString()
}

function getUserDisplayName(user: User) {
  const metadata = user.user_metadata
  const name =
    typeof metadata.name === 'string'
      ? metadata.name
      : typeof metadata.full_name === 'string'
        ? metadata.full_name
        : ''

  return name.trim() || user.email?.split('@')[0] || 'Hessa user'
}

function toPublicUser(user: User): AuthUser {
  return {
    id: user.id,
    name: getUserDisplayName(user),
    email: user.email ?? '',
    createdAt: user.created_at,
  }
}

function toAuthSession(user: User | null | undefined): AuthSession | null {
  return user ? { user: toPublicUser(user) } : null
}

function getWorkspaceStorageKey(userId: string) {
  return `${WORKSPACE_STORAGE_PREFIX}${userId}`
}

function loadDatabaseByKey(storageKey: string) {
  try {
    const stored = window.localStorage.getItem(storageKey)

    if (!stored) {
      return cloneDefaultDatabase()
    }

    return normalizeDatabase(JSON.parse(stored))
  } catch {
    return cloneDefaultDatabase()
  }
}

function saveDatabaseByKey(storageKey: string, database: Database) {
  const normalized = normalizeDatabase(database)
  window.localStorage.setItem(storageKey, JSON.stringify(normalized))
  return normalized
}

function loadDatabaseForUser(userId: string) {
  return loadDatabaseByKey(getWorkspaceStorageKey(userId))
}

function saveDatabaseForUser(userId: string, database: Database) {
  return saveDatabaseByKey(getWorkspaceStorageKey(userId), database)
}

async function requireSession() {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase.auth.getUser()

  if (error) {
    throw new Error(error.message)
  }

  const session = toAuthSession(data.user)

  if (!session) {
    throw new Error('Please sign in to continue.')
  }

  return {
    session,
  }
}

function migrateLegacyWorkspaceToUser(userId: string) {
  const legacyStored = window.localStorage.getItem(LEGACY_STORAGE_KEY)
  const targetKey = getWorkspaceStorageKey(userId)

  if (!legacyStored || window.localStorage.getItem(targetKey)) {
    return
  }

  try {
    const legacyDatabase = normalizeDatabase(JSON.parse(legacyStored))
    window.localStorage.setItem(targetKey, JSON.stringify(legacyDatabase))
    window.localStorage.removeItem(LEGACY_STORAGE_KEY)
  } catch {
    window.localStorage.removeItem(LEGACY_STORAGE_KEY)
  }
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

function sortProposals(proposals: ProposalRecord[]) {
  return [...proposals].sort((left, right) => {
    const leftStatus = statusPriority[left.status] ?? 99
    const rightStatus = statusPriority[right.status] ?? 99

    if (leftStatus !== rightStatus) {
      return leftStatus - rightStatus
    }

    if (left.status === 'active' && right.status === 'active') {
      const nextDifference = compareIsoDates(left.nextFollowUpAt, right.nextFollowUpAt)

      if (nextDifference !== 0) {
        return nextDifference
      }
    }

    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
  })
}

function compareIsoDates(firstDate: string | null, secondDate: string | null) {
  const first = firstDate ? new Date(firstDate).getTime() : Number.POSITIVE_INFINITY
  const second = secondDate ? new Date(secondDate).getTime() : Number.POSITIVE_INFINITY
  return first - second
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

function getProposalScheduleTime(proposal: ProposalRecord, followUpNumber: number) {
  return normalizeScheduleTime(
    proposal.followUpScheduleTimes[followUpNumber - 1],
    DEFAULT_SCHEDULE_TIMES[followUpNumber - 1] ?? '09:00',
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

function getNextProposalScheduledAt(
  proposal: ProposalRecord,
  referenceIso: string,
  followUpNumber: number,
  intervalDays: number,
  mode: 'follow-up' | 'initial' | 'resume' = 'follow-up',
) {
  const timeValue = getProposalScheduleTime(proposal, followUpNumber)

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

function buildProposalEmailPayload(
  proposal: ProposalRecord,
  settings: SettingsState,
  followUpNumber: number,
) {
  const fromName = settings.sender.fromName || 'Hessa Enterprises'
  const subject = `Following up on the proposal we sent`
  const body = [
    `Hi ${proposal.clientName},`,
    '',
    'I wanted to follow up on the proposal we sent.',
    'Do you have any questions, or would you like to move forward with the next step?',
    '',
    'If it is helpful, reply here and we will take it from there.',
    '',
    'Best,',
    fromName,
  ].join('\n')

  return {
    subject:
      followUpNumber > 1
        ? `${subject} - follow-up ${followUpNumber}`
        : subject,
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

async function sendWithConnectedGmail(
  recipient: string,
  subject: string,
  body: string,
  metadata: {
    clientName: string
    contactNumber: number
    scheduledFor: string
  },
): Promise<EmailDeliveryResult> {
  const supabase = getSupabaseClient()
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
  const accessToken = sessionData.session?.access_token

  if (sessionError || !accessToken) {
    throw new Error(sessionError?.message ?? 'A Supabase session is required to send with Gmail.')
  }

  const response = await fetch(`${supabaseFunctionBaseUrl}/gmail-send-followup`, {
    body: JSON.stringify({
      body,
      clientName: metadata.clientName,
      contactNumber: metadata.contactNumber,
      scheduledFor: metadata.scheduledFor,
      subject,
      to: recipient,
    }),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  })
  const data = (await response.json().catch(() => null)) as GmailSendFunctionResponse | null

  if (!response.ok) {
    throw new Error(
      data?.message ||
        data?.reason ||
        (typeof data?.error === 'string' ? data.error : null) ||
        `Gmail send failed with status ${response.status}.`,
    )
  }

  if (!data?.sent) {
    throw new Error(data?.message || data?.reason || 'Gmail did not send the follow-up.')
  }

  return {
    detail: data.fromEmail ? `Sent through Gmail from ${data.fromEmail}.` : 'Sent through Gmail.',
    method: 'gmail',
  }
}

async function deliverFollowUpEmail(
  recipient: string,
  subject: string,
  body: string,
  metadata: {
    clientName: string
    contactNumber: number
    preferGmail?: boolean
    scheduledFor: string
  },
): Promise<EmailDeliveryResult> {
  if (metadata.preferGmail) {
    return sendWithConnectedGmail(recipient, subject, body, metadata)
  }

  openMailDraft(recipient, subject, body)

  return {
    detail: 'Opened as an email draft in the default mail app.',
    method: 'draft',
  }
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

function getAppStateFromDatabase(database: Database, currentUser: AuthUser): AppState {
  return {
    currentUser,
    runtimeInfo: getRuntimeInfo(),
    settings: database.settings,
    stats: summarizeClients(database.clients),
    clients: sortClients(database.clients),
    proposals: sortProposals(database.proposals),
  }
}

function persistDatabase(userId: string, database: Database) {
  database.clients = sortClients(database.clients)
  database.proposals = sortProposals(database.proposals)
  return saveDatabaseForUser(userId, database)
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
      subject:
        incomingSettings.templates[index]?.subject?.trim() ||
        currentSettings.templates[index].subject,
      body: incomingSettings.templates[index]?.body || currentSettings.templates[index].body,
    })),
    automation: {
      intervalDays: Math.max(1, incomingSettings.automation.intervalDays || 2),
      autoOpenDraftOnCreate: incomingSettings.automation.autoOpenDraftOnCreate,
    },
  }
}

function selectClientsForProcessing(
  clients: ClientRecord[],
  options: { clientId?: string; force?: boolean } = {},
) {
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

function selectProposalsForProcessing(
  proposals: ProposalRecord[],
  options: { force?: boolean; proposalId?: string } = {},
) {
  const now = Date.now()

  return sortProposals(
    proposals.filter((proposal) => {
      if (proposal.status !== 'active') {
        return false
      }

      if (proposal.sentFollowUps >= proposal.targetFollowUps) {
        return false
      }

      if (options.proposalId && proposal.id !== options.proposalId) {
        return false
      }

      if (!proposal.nextFollowUpAt) {
        return Boolean(options.force)
      }

      if (options.force) {
        return true
      }

      return new Date(proposal.nextFollowUpAt).getTime() <= now
    }),
  )
}

async function advanceClientWithDraft(
  database: Database,
  client: ClientRecord,
  options: EmailDeliveryOptions = {},
) {
  const contactNumber = client.sentContacts + 1
  const scheduledFor = client.nextContactAt ?? new Date().toISOString()
  const payload = buildEmailPayload(client, database.settings, contactNumber, scheduledFor)
  const delivery = await deliverFollowUpEmail(client.email, payload.subject, payload.body, {
    clientName: client.name,
    contactNumber,
    preferGmail: options.preferGmail,
    scheduledFor,
  })

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
    preview: delivery.method === 'gmail' ? delivery.detail : payload.preview,
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

  return delivery
}

async function advanceProposalWithDraft(
  database: Database,
  proposal: ProposalRecord,
  options: EmailDeliveryOptions = {},
) {
  const followUpNumber = proposal.sentFollowUps + 1
  const scheduledFor = proposal.nextFollowUpAt ?? new Date().toISOString()
  const payload = buildProposalEmailPayload(
    proposal,
    database.settings,
    followUpNumber,
  )
  const delivery = await deliverFollowUpEmail(proposal.email, payload.subject, payload.body, {
    clientName: proposal.clientName,
    contactNumber: followUpNumber,
    preferGmail: options.preferGmail,
    scheduledFor,
  })

  const preparedAt = new Date().toISOString()
  proposal.sentFollowUps = followUpNumber
  proposal.lastFollowUpAt = preparedAt
  proposal.lastError = null
  proposal.updatedAt = preparedAt
  proposal.history.unshift({
    id: createId(),
    contactNumber: followUpNumber,
    status: 'prepared',
    scheduledFor,
    happenedAt: preparedAt,
    subject: payload.subject,
    preview: delivery.method === 'gmail' ? delivery.detail : payload.preview,
    error: null,
  })

  if (proposal.sentFollowUps >= proposal.targetFollowUps) {
    proposal.status = 'finished'
    proposal.finishedAt = preparedAt
    proposal.nextFollowUpAt = null
  } else {
    proposal.nextFollowUpAt = getNextProposalScheduledAt(
      proposal,
      preparedAt,
      followUpNumber + 1,
      database.settings.automation.intervalDays,
    )
  }

  return delivery
}

function buildOperationResponse(
  database: Database,
  currentUser: AuthUser,
  message: string,
  processed = 1,
  sent = 1,
): AppOperationResponse {
  return {
    ...getAppStateFromDatabase(database, currentUser),
    result: {
      failed: 0,
      message,
      processed,
      sent,
    },
  }
}

export const webApp = {
  async getSession() {
    const supabase = getSupabaseClient()
    const { data, error } = await supabase.auth.getSession()

    if (error) {
      throw new Error(error.message)
    }

    return toAuthSession(data.session?.user)
  },

  async register(registerInput: RegisterInput): Promise<AuthActionResult> {
    const name = registerInput.name.trim()
    const email = toStoredEmail(registerInput.email)
    const password = registerInput.password

    if (!name) {
      throw new Error('Name is required.')
    }

    if (!isValidEmail(email)) {
      throw new Error('Please enter a valid email address.')
    }

    if (password.trim().length < 8) {
      throw new Error('Password must be at least 8 characters long.')
    }

    const supabase = getSupabaseClient()
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: name,
          name,
        },
        emailRedirectTo: getRedirectUrl(),
      },
    })

    if (error) {
      throw new Error(error.message)
    }

    const nextSession = toAuthSession(data.session?.user)

    if (nextSession) {
      migrateLegacyWorkspaceToUser(nextSession.user.id)
    }

    return {
      message: nextSession
        ? 'Account created successfully.'
        : 'Account created. Check your email to confirm your address before signing in.',
      session: nextSession,
    }
  },

  async login(loginInput: LoginInput): Promise<AuthActionResult> {
    const email = toStoredEmail(loginInput.email)
    const password = loginInput.password

    if (!isValidEmail(email)) {
      throw new Error('Please enter a valid email address.')
    }

    if (!password) {
      throw new Error('Password is required.')
    }

    const supabase = getSupabaseClient()
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      throw new Error(error.message)
    }

    const nextSession = toAuthSession(data.user)

    if (nextSession) {
      migrateLegacyWorkspaceToUser(nextSession.user.id)
    }

    return {
      message: 'Signed in successfully.',
      session: nextSession,
    }
  },

  async loginWithGoogle() {
    const supabase = getSupabaseClient()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: getRedirectUrl(),
      },
    })

    if (error) {
      throw new Error(error.message)
    }
  },

  async requestPasswordReset(resetInput: PasswordResetInput) {
    const email = toStoredEmail(resetInput.email)

    if (!isValidEmail(email)) {
      throw new Error('Please enter a valid email address.')
    }

    const supabase = getSupabaseClient()
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: getRedirectUrl('reset-password'),
    })

    if (error) {
      throw new Error(error.message)
    }
  },

  async updatePassword(updateInput: PasswordUpdateInput): Promise<AuthActionResult> {
    const password = updateInput.password

    if (password.trim().length < 8) {
      throw new Error('Password must be at least 8 characters long.')
    }

    const supabase = getSupabaseClient()
    const { data, error } = await supabase.auth.updateUser({
      password,
    })

    if (error) {
      throw new Error(error.message)
    }

    return {
      message: 'Password updated successfully.',
      session: toAuthSession(data.user),
    }
  },

  async logout() {
    const supabase = getSupabaseClient()
    const { error } = await supabase.auth.signOut()

    if (error) {
      throw new Error(error.message)
    }
  },

  async getAppState() {
    const { session } = await requireSession()
    return getAppStateFromDatabase(loadDatabaseForUser(session.user.id), session.user)
  },

  async saveSettings(incomingSettings: SettingsInput) {
    const { session } = await requireSession()
    const database = loadDatabaseForUser(session.user.id)
    database.settings = mergeSettings(database.settings, incomingSettings)
    const persisted = persistDatabase(session.user.id, database)

    return {
      ...getAppStateFromDatabase(persisted, session.user),
      result: {
        failed: 0,
        message: 'Workspace settings saved successfully.',
        processed: 0,
        sent: 0,
      },
    }
  },

  async createClient(clientInput: ClientInput, options: EmailDeliveryOptions = {}) {
    const { session } = await requireSession()
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

    const database = loadDatabaseForUser(session.user.id)
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
    persistDatabase(session.user.id, database)

    const shouldAutoOpen =
      database.settings.automation.autoOpenDraftOnCreate &&
      client.nextContactAt !== null &&
      new Date(client.nextContactAt).getTime() <= Date.now()

    if (shouldAutoOpen) {
      return this.sendClientFollowUp(client.id, options)
    }

    return {
      ...getAppStateFromDatabase(loadDatabaseForUser(session.user.id), session.user),
      result: {
        failed: 0,
        message: `Client added. First draft scheduled for ${toDateLabel(client.nextContactAt)}.`,
        processed: 0,
        sent: 0,
      },
    }
  },

  async createProposal(proposalInput: ProposalInput, options: EmailDeliveryOptions = {}) {
    const { session } = await requireSession()
    const clientName = proposalInput.clientName.trim()
    const email = proposalInput.email.trim().toLowerCase()
    const company = proposalInput.company.trim()
    const notes = proposalInput.notes.trim()
    const targetFollowUps = clampTargetContacts(proposalInput.targetFollowUps)

    if (!clientName) {
      throw new Error('Client name is required for the proposal.')
    }

    if (!isValidEmail(email)) {
      throw new Error('Please enter a valid proposal contact email.')
    }

    const followUpScheduleTimes = Array.from({ length: targetFollowUps }, (_, index) =>
      normalizeScheduleTime(
        proposalInput.followUpScheduleTimes[index],
        DEFAULT_SCHEDULE_TIMES[index],
      ),
    )

    const database = loadDatabaseForUser(session.user.id)
    const createdAt = new Date().toISOString()
    const proposal: ProposalRecord = {
      id: createId(),
      clientName,
      email,
      company,
      notes,
      status: 'active',
      createdAt,
      updatedAt: createdAt,
      canceledAt: null,
      finishedAt: null,
      nextFollowUpAt: null,
      lastFollowUpAt: null,
      lastError: null,
      sentFollowUps: 0,
      targetFollowUps,
      followUpScheduleTimes,
      history: [],
    }

    const firstFollowUpAt = getNextProposalScheduledAt(
      proposal,
      createdAt,
      1,
      database.settings.automation.intervalDays,
      'initial',
    )
    proposal.nextFollowUpAt = firstFollowUpAt

    database.proposals.unshift(proposal)
    persistDatabase(session.user.id, database)

    const shouldAutoOpen =
      database.settings.automation.autoOpenDraftOnCreate &&
      proposal.nextFollowUpAt !== null &&
      new Date(proposal.nextFollowUpAt).getTime() <= Date.now()

    if (shouldAutoOpen) {
      return this.sendProposalFollowUp(proposal.id, options)
    }

    return {
      ...getAppStateFromDatabase(loadDatabaseForUser(session.user.id), session.user),
      result: {
        failed: 0,
        message: `Proposal follow-up added. First email scheduled for ${toDateLabel(firstFollowUpAt)}.`,
        processed: 0,
        sent: 0,
      },
    }
  },

  async processDueFollowUps(options: EmailDeliveryOptions = {}) {
    const { session } = await requireSession()
    const database = loadDatabaseForUser(session.user.id)
    const candidates = selectClientsForProcessing(database.clients)

    if (candidates.length === 0) {
      return {
        ...getAppStateFromDatabase(database, session.user),
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

    const delivery = await advanceClientWithDraft(database, client, options)
    const persisted = persistDatabase(session.user.id, database)
    const remainingDue = selectClientsForProcessing(persisted.clients).length
    const suffix =
      remainingDue > 0
        ? ` ${remainingDue} more scheduled follow-ups are still due.`
        : ''

    return buildOperationResponse(
      persisted,
      session.user,
      `${delivery.method === 'gmail' ? 'Sent' : 'Opened'} the next follow-up for ${client.name}.${suffix}`,
    )
  },

  async processDueProposalFollowUps(options: EmailDeliveryOptions = {}) {
    const { session } = await requireSession()
    const database = loadDatabaseForUser(session.user.id)
    const candidates = selectProposalsForProcessing(database.proposals)

    if (candidates.length === 0) {
      return {
        ...getAppStateFromDatabase(database, session.user),
        result: {
          failed: 0,
          message: 'There are no proposal follow-ups ready to send.',
          processed: 0,
          sent: 0,
        },
      }
    }

    const proposal = database.proposals.find((item) => item.id === candidates[0].id)

    if (!proposal) {
      throw new Error('The next proposal in the queue could not be found.')
    }

    const delivery = await advanceProposalWithDraft(database, proposal, options)
    const persisted = persistDatabase(session.user.id, database)
    const remainingDue = selectProposalsForProcessing(persisted.proposals).length
    const suffix =
      remainingDue > 0 ? ` ${remainingDue} more proposal follow-ups are still due.` : ''

    return buildOperationResponse(
      persisted,
      session.user,
      `${delivery.method === 'gmail' ? 'Sent' : 'Opened'} the next proposal follow-up for ${proposal.clientName}.${suffix}`,
    )
  },

  async sendClientFollowUp(clientId: string, options: EmailDeliveryOptions = {}) {
    if (!clientId) {
      throw new Error('A client must be selected before opening a draft.')
    }

    const { session } = await requireSession()
    const database = loadDatabaseForUser(session.user.id)
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

    const delivery = await advanceClientWithDraft(database, client, options)
    const persisted = persistDatabase(session.user.id, database)

    return buildOperationResponse(
      persisted,
      session.user,
      `${delivery.method === 'gmail' ? 'Sent' : 'Opened'} touchpoint ${client.sentContacts} for ${client.name}.`,
    )
  },

  async sendProposalFollowUp(proposalId: string, options: EmailDeliveryOptions = {}) {
    if (!proposalId) {
      throw new Error('A proposal must be selected before opening a draft.')
    }

    const { session } = await requireSession()
    const database = loadDatabaseForUser(session.user.id)
    const proposal = database.proposals.find((item) => item.id === proposalId)

    if (!proposal) {
      throw new Error('The selected proposal could not be found.')
    }

    if (proposal.status !== 'active') {
      throw new Error('Only active proposal follow-ups can open drafts.')
    }

    if (proposal.sentFollowUps >= proposal.targetFollowUps) {
      throw new Error('This proposal has already completed the full follow-up sequence.')
    }

    const delivery = await advanceProposalWithDraft(database, proposal, options)
    const persisted = persistDatabase(session.user.id, database)

    return buildOperationResponse(
      persisted,
      session.user,
      `${delivery.method === 'gmail' ? 'Sent' : 'Opened'} proposal follow-up ${proposal.sentFollowUps} for ${proposal.clientName}.`,
    )
  },

  async updateClientStatus(clientId: string, nextStatus: ClientRecord['status']) {
    const { session } = await requireSession()
    const database = loadDatabaseForUser(session.user.id)
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

    const persisted = persistDatabase(session.user.id, database)

    return {
      ...getAppStateFromDatabase(persisted, session.user),
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

  async updateProposalStatus(proposalId: string, nextStatus: ProposalRecord['status']) {
    const { session } = await requireSession()
    const database = loadDatabaseForUser(session.user.id)
    const proposal = database.proposals.find((item) => item.id === proposalId)

    if (!proposal) {
      throw new Error('The selected proposal could not be found.')
    }

    const normalizedStatus = normalizeProposalStatus(nextStatus)
    const now = new Date().toISOString()

    if (normalizedStatus === 'active') {
      if (proposal.status === 'finished' || proposal.sentFollowUps >= proposal.targetFollowUps) {
        throw new Error('This proposal follow-up sequence is complete and can now be removed.')
      }

      proposal.status = 'active'
      proposal.canceledAt = null
      proposal.lastError = null
      proposal.updatedAt = now
      proposal.nextFollowUpAt = getNextProposalScheduledAt(
        proposal,
        now,
        proposal.sentFollowUps + 1,
        database.settings.automation.intervalDays,
        'resume',
      )
    } else {
      proposal.status = 'canceled'
      proposal.canceledAt = now
      proposal.updatedAt = now
      proposal.nextFollowUpAt = null
    }

    const persisted = persistDatabase(session.user.id, database)

    return {
      ...getAppStateFromDatabase(persisted, session.user),
      result: {
        failed: 0,
        message:
          normalizedStatus === 'active'
            ? 'Proposal follow-up resumed and rescheduled.'
            : 'Proposal follow-up paused successfully.',
        processed: 0,
        sent: 0,
      },
    }
  },

  async deleteClient(clientId: string) {
    if (!clientId) {
      throw new Error('A client must be selected before deletion.')
    }

    const { session } = await requireSession()
    const database = loadDatabaseForUser(session.user.id)
    const clientIndex = database.clients.findIndex((item) => item.id === clientId)

    if (clientIndex === -1) {
      throw new Error('The selected client could not be found.')
    }

    database.clients.splice(clientIndex, 1)
    const persisted = persistDatabase(session.user.id, database)

    return {
      ...getAppStateFromDatabase(persisted, session.user),
      result: {
        failed: 0,
        message: 'Client deleted successfully.',
        processed: 0,
        sent: 0,
      },
    }
  },

  async deleteProposal(proposalId: string) {
    if (!proposalId) {
      throw new Error('A proposal must be selected before deletion.')
    }

    const { session } = await requireSession()
    const database = loadDatabaseForUser(session.user.id)
    const proposalIndex = database.proposals.findIndex((item) => item.id === proposalId)

    if (proposalIndex === -1) {
      throw new Error('The selected proposal could not be found.')
    }

    database.proposals.splice(proposalIndex, 1)
    const persisted = persistDatabase(session.user.id, database)

    return {
      ...getAppStateFromDatabase(persisted, session.user),
      result: {
        failed: 0,
        message: 'Proposal deleted successfully.',
        processed: 0,
        sent: 0,
      },
    }
  },
}
