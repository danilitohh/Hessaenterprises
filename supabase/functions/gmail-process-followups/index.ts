import { decryptToken } from '../_shared/crypto.ts'
import { createRawEmailMessage, refreshGoogleAccessToken, sendGmailMessage } from '../_shared/google.ts'
import { handleOptions, jsonResponse } from '../_shared/http.ts'
import { createAdminClient } from '../_shared/supabase.ts'

const DEFAULT_INTERVAL_DAYS = 2
const DEFAULT_SCHEDULE_TIMES = ['09:00', '11:00', '14:00', '16:00']
const DEFAULT_TIME_ZONE = Deno.env.get('DEFAULT_TIME_ZONE')?.trim() || 'America/Bogota'
const FRESH_LOCK_MS = 15 * 60 * 1000
const MAX_CANDIDATE_FETCH = 500
const WORKSPACE_SYNC_SOURCE = 'workspace-local'

type SupabaseAdminClient = ReturnType<typeof createAdminClient>
type FollowUpKind = 'appointment' | 'proposal'
type TableName = 'clients' | 'proposals'
type JsonRecord = Record<string, unknown>

type RawWorkspaceRow = JsonRecord & {
  account_id?: string
  company?: string | null
  created_at?: string
  created_by?: string | null
  email?: string | null
  id?: string
  metadata?: unknown
  name?: string
  next_follow_up_at?: string | null
  notes?: string | null
  status?: string
  title?: string
  updated_at?: string
}

type Candidate = {
  accountId: string
  clientName: string
  company: string
  createdAt: string
  id: string
  intervalDays: number
  kind: FollowUpKind
  metadata: JsonRecord
  notes: string
  recipient: string
  rowUpdatedAt: string
  scheduleTimes: string[]
  scheduledFor: string
  sentCount: number
  table: TableName
  targetCount: number
  timeZone: string
  userId: string
}

type GmailConnection = {
  account_id: string | null
  email: string
  encrypted_refresh_token: string
  id: string
  user_id: string
}

type TemplateRow = {
  account_id: string
  body: string
  step_number: number
  subject: string
  template_type: FollowUpKind
  title: string
}

type EmailPayload = {
  body: string
  preview: string
  subject: string
}

type ProcessStats = {
  failed: number
  processed: number
  sent: number
  skipped: number
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {}
}

function getString(record: JsonRecord, key: string) {
  const value = record[key]
  return typeof value === 'string' ? value.trim() : ''
}

function getNumber(record: JsonRecord, key: string, fallback: number) {
  const value = record[key]
  const numericValue = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numericValue) ? Math.trunc(numericValue) : fallback
}

function getStringArray(record: JsonRecord, key: string) {
  const value = record[key]
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function getHistory(record: JsonRecord) {
  const value = record.history
  return Array.isArray(value) ? value : []
}

function getCronSecret() {
  const secret = Deno.env.get('CRON_SECRET')?.trim()

  if (!secret) {
    throw new Error('Missing CRON_SECRET.')
  }

  return secret
}

function getDefaultScheduleTime(index: number) {
  return DEFAULT_SCHEDULE_TIMES[index % DEFAULT_SCHEDULE_TIMES.length] || '09:00'
}

function normalizeScheduleTime(value: unknown, fallback = '09:00') {
  if (typeof value !== 'string') {
    return fallback
  }

  const normalized = value.trim()
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(normalized) ? normalized : fallback
}

function normalizeTimeZone(value: unknown) {
  const candidate = typeof value === 'string' && value.trim() ? value.trim() : DEFAULT_TIME_ZONE

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(new Date())
    return candidate
  } catch {
    return 'UTC'
  }
}

function getTimeZoneParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    month: '2-digit',
    second: '2-digit',
    timeZone,
    year: 'numeric',
  })
  const parts = formatter.formatToParts(date).reduce((current, part) => {
    if (part.type !== 'literal') {
      current[part.type] = Number(part.value)
    }

    return current
  }, {} as Record<string, number>)

  return {
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    month: parts.month,
    second: parts.second,
    year: parts.year,
  }
}

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = getTimeZoneParts(date, timeZone)
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  )

  return localAsUtc - date.getTime()
}

function zonedTimeToUtc(
  timeZone: string,
  parts: { day: number; hour: number; minute: number; month: number; year: number },
) {
  const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0)
  let utcTime = localAsUtc

  for (let index = 0; index < 3; index += 1) {
    utcTime = localAsUtc - getTimeZoneOffsetMs(new Date(utcTime), timeZone)
  }

  return new Date(utcTime)
}

function addLocalDays(
  parts: { day: number; month: number; year: number },
  daysToAdd: number,
) {
  const nextDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + daysToAdd))

  return {
    day: nextDate.getUTCDate(),
    month: nextDate.getUTCMonth() + 1,
    year: nextDate.getUTCFullYear(),
  }
}

function scheduleFollowUp(referenceIso: string, timeValue: string, intervalDays: number, timeZone: string) {
  const referenceDate = new Date(referenceIso)
  const referenceParts = getTimeZoneParts(referenceDate, timeZone)
  const nextDate = addLocalDays(referenceParts, intervalDays)
  const [hour, minute] = normalizeScheduleTime(timeValue).split(':').map(Number)

  return zonedTimeToUtc(timeZone, {
    ...nextDate,
    hour,
    minute,
  }).toISOString()
}

function toDateLabel(isoDate: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(isoDate))
}

function toTimeLabel(isoDate: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(new Date(isoDate))
}

function fillTemplate(template: string, context: Record<string, string>) {
  return template.replace(/{{\s*([a-zA-Z0-9]+)\s*}}/g, (_, key) => context[key] ?? '')
}

function createDefaultTemplate(contactNumber: number): TemplateRow {
  return {
    account_id: '',
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
    step_number: contactNumber,
    subject: `Follow-up ${contactNumber} of {{maxContacts}} for {{name}}`,
    template_type: 'appointment',
    title: `Touchpoint ${contactNumber}`,
  }
}

function createDefaultProposalTemplate(contactNumber: number): TemplateRow {
  return {
    account_id: '',
    body: [
      'Hi {{name}},',
      '',
      'I wanted to follow up on the proposal we sent.',
      'Do you have any questions, or would you like to move forward with the next step?',
      '',
      'If it is helpful, reply here and we will take it from there.',
      '',
      'Best,',
      '{{fromName}}',
    ].join('\n'),
    step_number: contactNumber,
    subject:
      contactNumber > 1
        ? `Following up on the proposal we sent - follow-up ${contactNumber}`
        : 'Following up on the proposal we sent',
    template_type: 'proposal',
    title: `Proposal touchpoint ${contactNumber}`,
  }
}

function getTemplateKey(accountId: string, kind: FollowUpKind, stepNumber: number) {
  return `${accountId}:${kind}:${stepNumber}`
}

function getTemplate(
  templates: Map<string, TemplateRow>,
  candidate: Candidate,
  stepNumber: number,
) {
  return (
    templates.get(getTemplateKey(candidate.accountId, candidate.kind, stepNumber)) ??
    (candidate.kind === 'appointment'
      ? createDefaultTemplate(stepNumber)
      : createDefaultProposalTemplate(stepNumber))
  )
}

function buildEmailPayload(
  candidate: Candidate,
  templates: Map<string, TemplateRow>,
  fromEmail: string,
) {
  const contactNumber = candidate.sentCount + 1
  const template = getTemplate(templates, candidate, contactNumber)
  const fromName = getString(candidate.metadata, 'sender_from_name') || 'Hessa Enterprises'
  const context = {
    attemptsCompleted: String(candidate.sentCount),
    company: candidate.company,
    companyOrName: candidate.company || candidate.clientName,
    contactNumber: String(contactNumber),
    createdDate: toDateLabel(candidate.createdAt, candidate.timeZone),
    email: candidate.recipient,
    fromEmail,
    fromName,
    maxContacts: String(candidate.targetCount),
    name: candidate.clientName,
    nextContactDate: toDateLabel(candidate.scheduledFor, candidate.timeZone),
    notes: candidate.notes,
    scheduledDate: toDateLabel(candidate.scheduledFor, candidate.timeZone),
    scheduledTime: toTimeLabel(candidate.scheduledFor, candidate.timeZone),
  }
  const body = fillTemplate(template.body, context)

  return {
    body,
    preview: body.split('\n').find((line) => line.trim())?.trim() ?? '',
    subject: fillTemplate(template.subject, context),
  }
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function hasFreshLock(metadata: JsonRecord, now: Date) {
  const lock = asRecord(metadata.automation_lock)
  const lockedAt = getString(lock, 'locked_at')
  const lockedAtTime = lockedAt ? new Date(lockedAt).getTime() : Number.NaN

  return Number.isFinite(lockedAtTime) && now.getTime() - lockedAtTime < FRESH_LOCK_MS
}

function normalizeClientCandidate(row: RawWorkspaceRow): Candidate | null {
  const metadata = asRecord(row.metadata)
  const id = typeof row.id === 'string' ? row.id : ''
  const accountId = typeof row.account_id === 'string' ? row.account_id : ''
  const userId = typeof row.created_by === 'string' ? row.created_by : ''
  const recipient = typeof row.email === 'string' ? row.email.trim().toLowerCase() : ''
  const scheduledFor = getString(metadata, 'next_contact_at')
  const sentCount = getNumber(metadata, 'sent_contacts', 0)
  const targetCount = Math.max(1, getNumber(metadata, 'target_contacts', 1))

  if (
    !id ||
    !accountId ||
    !userId ||
    row.status !== 'active' ||
    !isValidEmail(recipient) ||
    !scheduledFor ||
    sentCount >= targetCount
  ) {
    return null
  }

  return {
    accountId,
    clientName: typeof row.name === 'string' ? row.name : 'Client',
    company: typeof row.company === 'string' ? row.company : '',
    createdAt: typeof row.created_at === 'string' ? row.created_at : new Date().toISOString(),
    id,
    intervalDays: Math.max(1, getNumber(metadata, 'interval_days', DEFAULT_INTERVAL_DAYS)),
    kind: 'appointment',
    metadata,
    notes: typeof row.notes === 'string' ? row.notes : '',
    recipient,
    rowUpdatedAt: typeof row.updated_at === 'string' ? row.updated_at : '',
    scheduleTimes: getStringArray(metadata, 'contact_schedule_times'),
    scheduledFor,
    sentCount,
    table: 'clients',
    targetCount,
    timeZone: normalizeTimeZone(metadata.time_zone),
    userId,
  }
}

function normalizeProposalCandidate(row: RawWorkspaceRow): Candidate | null {
  const metadata = asRecord(row.metadata)
  const id = typeof row.id === 'string' ? row.id : ''
  const accountId = typeof row.account_id === 'string' ? row.account_id : ''
  const userId = typeof row.created_by === 'string' ? row.created_by : ''
  const recipient = getString(metadata, 'email').toLowerCase()
  const scheduledFor =
    typeof row.next_follow_up_at === 'string' ? row.next_follow_up_at : getString(metadata, 'next_follow_up_at')
  const sentCount = getNumber(metadata, 'sent_follow_ups', 0)
  const targetCount = Math.max(1, getNumber(metadata, 'target_follow_ups', 1))

  if (
    !id ||
    !accountId ||
    !userId ||
    row.status !== 'active' ||
    !isValidEmail(recipient) ||
    !scheduledFor ||
    sentCount >= targetCount
  ) {
    return null
  }

  return {
    accountId,
    clientName: getString(metadata, 'client_name') || row.title || 'Client',
    company: getString(metadata, 'company'),
    createdAt: typeof row.created_at === 'string' ? row.created_at : new Date().toISOString(),
    id,
    intervalDays: Math.max(1, getNumber(metadata, 'interval_days', DEFAULT_INTERVAL_DAYS)),
    kind: 'proposal',
    metadata,
    notes: getString(metadata, 'notes'),
    recipient,
    rowUpdatedAt: typeof row.updated_at === 'string' ? row.updated_at : '',
    scheduleTimes: getStringArray(metadata, 'follow_up_schedule_times'),
    scheduledFor,
    sentCount,
    table: 'proposals',
    targetCount,
    timeZone: normalizeTimeZone(metadata.time_zone),
    userId,
  }
}

function isDue(candidate: Candidate, now: Date) {
  const scheduledAt = new Date(candidate.scheduledFor).getTime()

  return (
    Number.isFinite(scheduledAt) &&
    scheduledAt <= now.getTime() &&
    !hasFreshLock(candidate.metadata, now)
  )
}

function sortByScheduledAt(a: Candidate, b: Candidate) {
  return new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime()
}

async function selectClientRows(supabase: SupabaseAdminClient, nowIso: string) {
  const query = supabase
    .from('clients')
    .select('id,account_id,created_by,name,email,company,notes,status,metadata,created_at,updated_at')
    .eq('status', 'active')
    .lte('metadata->>next_contact_at', nowIso)
    .limit(MAX_CANDIDATE_FETCH)
  const { data, error } = await query

  if (error) {
    throw new Error(error.message)
  }

  return (data ?? []) as RawWorkspaceRow[]
}

async function selectProposalRows(supabase: SupabaseAdminClient, nowIso: string) {
  const { data, error } = await supabase
    .from('proposals')
    .select('id,account_id,created_by,title,status,next_follow_up_at,metadata,created_at,updated_at')
    .eq('status', 'active')
    .lte('next_follow_up_at', nowIso)
    .limit(MAX_CANDIDATE_FETCH)

  if (error) {
    throw new Error(error.message)
  }

  return (data ?? []) as RawWorkspaceRow[]
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)))
}

async function loadTemplates(supabase: SupabaseAdminClient, accountIds: string[]) {
  const templates = new Map<string, TemplateRow>()

  if (accountIds.length === 0) {
    return templates
  }

  const { data, error } = await supabase
    .from('email_templates')
    .select('account_id,template_type,step_number,title,subject,body,is_active')
    .in('account_id', accountIds)
    .eq('is_active', true)

  if (error) {
    if (error.code === '42P01') {
      return templates
    }

    throw new Error(error.message)
  }

  for (const row of (data ?? []) as Array<TemplateRow & { is_active?: boolean }>) {
    if (row.template_type !== 'appointment' && row.template_type !== 'proposal') {
      continue
    }

    templates.set(getTemplateKey(row.account_id, row.template_type, row.step_number), row)
  }

  return templates
}

async function loadGmailConnections(supabase: SupabaseAdminClient, userIds: string[]) {
  const connections = new Map<string, GmailConnection>()

  if (userIds.length === 0) {
    return connections
  }

  const { data, error } = await supabase
    .from('gmail_connections')
    .select('id,user_id,account_id,email,encrypted_refresh_token,connected_at')
    .in('user_id', userIds)
    .is('revoked_at', null)
    .order('connected_at', { ascending: false })

  if (error) {
    throw new Error(error.message)
  }

  for (const connection of (data ?? []) as GmailConnection[]) {
    if (!connections.has(connection.user_id)) {
      connections.set(connection.user_id, connection)
    }
  }

  return connections
}

async function claimCandidate(
  supabase: SupabaseAdminClient,
  candidate: Candidate,
  runId: string,
  claimedAt: string,
) {
  const nextMetadata = {
    ...candidate.metadata,
    automation_lock: {
      locked_at: claimedAt,
      run_id: runId,
    },
    last_automation_attempt_at: claimedAt,
    source: getString(candidate.metadata, 'source') || WORKSPACE_SYNC_SOURCE,
  }
  const { data, error } = await supabase
    .from(candidate.table)
    .update({
      metadata: nextMetadata,
      updated_at: claimedAt,
    })
    .eq('id', candidate.id)
    .eq('updated_at', candidate.rowUpdatedAt)
    .select('id')
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return Boolean(data)
}

function getNextScheduleTime(candidate: Candidate, stepNumber: number) {
  return normalizeScheduleTime(
    candidate.scheduleTimes[stepNumber - 1],
    getDefaultScheduleTime(stepNumber - 1),
  )
}

function withoutAutomationLock(metadata: JsonRecord) {
  const nextMetadata = { ...metadata }
  delete nextMetadata.automation_lock
  return nextMetadata
}

function createHistoryItem(
  candidate: Candidate,
  contactNumber: number,
  scheduledFor: string,
  happenedAt: string,
  payload: EmailPayload,
  status: 'failed' | 'prepared',
  error: string | null,
) {
  return {
    accountId: candidate.accountId,
    contactNumber,
    error,
    happenedAt,
    id: crypto.randomUUID(),
    preview: status === 'prepared' ? payload.preview : error ?? payload.preview,
    scheduledFor,
    status,
    subject: payload.subject,
  }
}

async function insertAuditRows(
  supabase: SupabaseAdminClient,
  candidate: Candidate,
  connection: GmailConnection | null,
  payload: EmailPayload,
  status: 'failed' | 'sent',
  gmailMessageId: string | null,
  error: string | null,
) {
  const logRow = {
    account_id: candidate.accountId,
    client_name: candidate.clientName,
    contact_number: candidate.sentCount + 1,
    error,
    gmail_connection_id: connection?.id ?? null,
    gmail_message_id: gmailMessageId,
    recipient: candidate.recipient,
    scheduled_for: candidate.scheduledFor,
    status,
    subject: payload.subject,
    user_id: candidate.userId,
  }
  const emailEventRow = {
    account_id: candidate.accountId,
    client_id: candidate.kind === 'appointment' ? candidate.id : null,
    error,
    proposal_id: candidate.kind === 'proposal' ? candidate.id : null,
    provider: 'gmail',
    provider_message_id: gmailMessageId,
    recipient: candidate.recipient,
    status,
    subject: payload.subject,
    user_id: candidate.userId,
  }
  const [logResult, eventResult] = await Promise.all([
    supabase.from('gmail_send_logs').insert(logRow),
    supabase.from('email_events').insert(emailEventRow),
  ])

  if (logResult.error) {
    console.error('Unable to insert gmail_send_logs row', logResult.error.message)
  }

  if (eventResult.error && eventResult.error.code !== '42P01') {
    console.error('Unable to insert email_events row', eventResult.error.message)
  }
}

async function markCandidateSent(
  supabase: SupabaseAdminClient,
  candidate: Candidate,
  payload: EmailPayload,
  sentAt: string,
) {
  const contactNumber = candidate.sentCount + 1
  const isFinished = contactNumber >= candidate.targetCount
  const nextScheduleTime = getNextScheduleTime(candidate, contactNumber + 1)
  const nextScheduledAt = isFinished
    ? null
    : scheduleFollowUp(sentAt, nextScheduleTime, candidate.intervalDays, candidate.timeZone)
  const historyItem = createHistoryItem(
    candidate,
    contactNumber,
    candidate.scheduledFor,
    sentAt,
    payload,
    'prepared',
    null,
  )
  const metadata = withoutAutomationLock({
    ...candidate.metadata,
    finished_at: isFinished ? sentAt : null,
    history: [historyItem, ...getHistory(candidate.metadata)],
    last_automation_attempt_at: sentAt,
    last_error: null,
    source: getString(candidate.metadata, 'source') || WORKSPACE_SYNC_SOURCE,
  })

  if (candidate.kind === 'appointment') {
    metadata.last_contact_at = sentAt
    metadata.next_contact_at = nextScheduledAt
    metadata.sent_contacts = contactNumber
  } else {
    metadata.last_follow_up_at = sentAt
    metadata.sent_follow_ups = contactNumber
  }

  const patch =
    candidate.kind === 'appointment'
      ? {
          metadata,
          status: isFinished ? 'finished' : 'active',
          updated_at: sentAt,
        }
      : {
          metadata,
          next_follow_up_at: nextScheduledAt,
          sent_at: sentAt,
          status: isFinished ? 'finished' : 'active',
          updated_at: sentAt,
        }
  const { error } = await supabase.from(candidate.table).update(patch).eq('id', candidate.id)

  if (error) {
    throw new Error(error.message)
  }
}

async function markCandidateFailed(
  supabase: SupabaseAdminClient,
  candidate: Candidate,
  payload: EmailPayload,
  failedAt: string,
  message: string,
) {
  const contactNumber = candidate.sentCount + 1
  const historyItem = createHistoryItem(
    candidate,
    contactNumber,
    candidate.scheduledFor,
    failedAt,
    payload,
    'failed',
    message,
  )
  const metadata = withoutAutomationLock({
    ...candidate.metadata,
    automation_failures: getNumber(candidate.metadata, 'automation_failures', 0) + 1,
    history: [historyItem, ...getHistory(candidate.metadata)],
    last_automation_attempt_at: failedAt,
    last_error: message,
    source: getString(candidate.metadata, 'source') || WORKSPACE_SYNC_SOURCE,
  })
  const { error } = await supabase
    .from(candidate.table)
    .update({
      metadata,
      updated_at: failedAt,
    })
    .eq('id', candidate.id)

  if (error) {
    throw new Error(error.message)
  }
}

async function sendCandidateEmail(
  candidate: Candidate,
  connection: GmailConnection,
  payload: EmailPayload,
) {
  const refreshToken = await decryptToken(connection.encrypted_refresh_token)
  const token = await refreshGoogleAccessToken(refreshToken)
  const raw = createRawEmailMessage({
    body: payload.body,
    from: connection.email,
    subject: payload.subject,
    to: candidate.recipient,
  })

  return sendGmailMessage(token.access_token, raw)
}

async function processCandidate(
  supabase: SupabaseAdminClient,
  candidate: Candidate,
  templates: Map<string, TemplateRow>,
  connections: Map<string, GmailConnection>,
  runId: string,
) {
  const claimedAt = new Date().toISOString()
  const claimed = await claimCandidate(supabase, candidate, runId, claimedAt)

  if (!claimed) {
    return 'skipped' as const
  }

  const connection = connections.get(candidate.userId) ?? null
  const payload = buildEmailPayload(
    candidate,
    templates,
    connection?.email ?? getString(candidate.metadata, 'sender_from_email'),
  )

  try {
    if (!connection) {
      throw new Error('Gmail is not connected for the user who owns this follow-up.')
    }

    const sentMessage = await sendCandidateEmail(candidate, connection, payload)
    const sentAt = new Date().toISOString()
    await markCandidateSent(supabase, candidate, payload, sentAt)
    await insertAuditRows(supabase, candidate, connection, payload, 'sent', sentMessage.id, null)
    return 'sent' as const
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to send Gmail follow-up.'
    const failedAt = new Date().toISOString()
    await markCandidateFailed(supabase, candidate, payload, failedAt, message)
    await insertAuditRows(supabase, candidate, connection, payload, 'failed', null, message)
    return 'failed' as const
  }
}

async function processDueFollowUps(supabase: SupabaseAdminClient, maxPerRun: number) {
  const now = new Date()
  const nowIso = now.toISOString()
  const [clientRows, proposalRows] = await Promise.all([
    selectClientRows(supabase, nowIso),
    selectProposalRows(supabase, nowIso),
  ])
  const candidates = [
    ...clientRows.map(normalizeClientCandidate),
    ...proposalRows.map(normalizeProposalCandidate),
  ]
    .filter((candidate): candidate is Candidate => Boolean(candidate))
    .filter((candidate) => isDue(candidate, now))
    .sort(sortByScheduledAt)
    .slice(0, maxPerRun)
  const accountIds = uniqueValues(candidates.map((candidate) => candidate.accountId))
  const userIds = uniqueValues(candidates.map((candidate) => candidate.userId))
  const [templates, connections] = await Promise.all([
    loadTemplates(supabase, accountIds),
    loadGmailConnections(supabase, userIds),
  ])
  const stats: ProcessStats = {
    failed: 0,
    processed: 0,
    sent: 0,
    skipped: 0,
  }
  const runId = crypto.randomUUID()

  for (const candidate of candidates) {
    const result = await processCandidate(supabase, candidate, templates, connections, runId)

    if (result === 'skipped') {
      stats.skipped += 1
      continue
    }

    stats.processed += 1

    if (result === 'sent') {
      stats.sent += 1
    } else {
      stats.failed += 1
    }
  }

  return {
    candidates: candidates.length,
    ...stats,
  }
}

function parseMaxPerRun(value: unknown) {
  const numericValue = typeof value === 'number' ? value : Number(value)

  if (!Number.isFinite(numericValue)) {
    return 25
  }

  return Math.min(100, Math.max(1, Math.trunc(numericValue)))
}

Deno.serve(async (req) => {
  const optionsResponse = handleOptions(req)

  if (optionsResponse) {
    return optionsResponse
  }

  try {
    const cronSecret = getCronSecret()
    const authHeader = req.headers.get('Authorization')

    if (authHeader !== `Bearer ${cronSecret}`) {
      return jsonResponse({ error: 'Unauthorized' }, { status: 401 })
    }

    if (req.method !== 'GET' && req.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, { status: 405 })
    }

    const body =
      req.method === 'POST' ? await req.json().catch(() => ({} as JsonRecord)) : ({} as JsonRecord)
    const supabase = createAdminClient()
    const result = await processDueFollowUps(supabase, parseMaxPerRun(body.maxPerRun))

    return jsonResponse({
      ok: true,
      ...result,
    })
  } catch (error) {
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : 'Unable to process Gmail follow-ups.',
        ok: false,
      },
      { status: 500 },
    )
  }
})
