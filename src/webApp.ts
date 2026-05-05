import type {
  AuthActionResult,
  AppOperationResponse,
  AppState,
  AuthSession,
  AuthUser,
  AccountPlan,
  AccountRecord,
  AccountStatus,
  AccountUserRecord,
  AdminPlatformState,
  ClientInput,
  ClientRecord,
  EmailTemplate,
  FollowUpHistoryItem,
  LoginInput,
  PasswordResetInput,
  PasswordUpdateInput,
  PlanPricingRecord,
  ProposalInput,
  ProposalRecord,
  RegisterInput,
  RuntimeInfo,
  SettingsInput,
  SettingsState,
  SubscriptionStatus,
  UserRole,
} from './types'
import type { User } from '@supabase/supabase-js'
import { getSupabaseClient, supabaseFunctionBaseUrl } from './supabaseClient'

const LEGACY_STORAGE_KEY = 'hessa-followup-web'
const PLATFORM_STORAGE_KEY = 'hessa-followup-web:platform'
const ACCOUNT_STORAGE_PREFIX = 'hessa-followup-web:account:'
const WORKSPACE_STORAGE_PREFIX = 'hessa-followup-web:workspace:'
const DEFAULT_SUPER_ADMIN_EMAILS = ['kevin.hessam@gmail.com', 'danilitohhh@gmail.com']
const DEFAULT_TRY_COUNT = 4
const MAX_SEQUENCE_TRIES = 100
const DEFAULT_SCHEDULE_TIMES = ['09:00', '11:00', '14:00', '16:00']
const BILLING_PLAN_OPTIONS: AccountPlan[] = ['free', 'basic', 'pro', 'business']
const statusPriority = {
  active: 0,
  finished: 1,
  canceled: 2,
} as const

type Database = {
  accountId: string
  version: number
  settings: SettingsState
  clients: ClientRecord[]
  proposals: ProposalRecord[]
}

type PlatformRegistry = {
  accounts: AccountRecord[]
  planPricing: PlanPricingRecord[]
  users: AccountUserRecord[]
  version: number
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

function createDefaultTemplate(contactNumber: number, accountId = ''): EmailTemplate {
  return {
    accountId,
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
}

function createDefaultTemplates(count = DEFAULT_TRY_COUNT, accountId = '') {
  return Array.from({ length: count }, (_, index) => createDefaultTemplate(index + 1, accountId))
}

function createDefaultProposalTemplate(contactNumber: number, accountId = ''): EmailTemplate {
  return {
    accountId,
    id: `proposal-contact-${contactNumber}`,
    title: `Proposal touchpoint ${contactNumber}`,
    subject:
      contactNumber > 1
        ? `Following up on the proposal we sent - follow-up ${contactNumber}`
        : 'Following up on the proposal we sent',
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
  }
}

function createDefaultProposalTemplates(count = DEFAULT_TRY_COUNT, accountId = '') {
  return Array.from({ length: count }, (_, index) =>
    createDefaultProposalTemplate(index + 1, accountId),
  )
}

function createLegacyDefaultTemplate(contactNumber: number) {
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
}

function createLegacyDefaultTemplates(count = DEFAULT_TRY_COUNT) {
  return Array.from({ length: count }, (_, index) => createLegacyDefaultTemplate(index + 1))
}

function createLegacyDefaultProposalTemplate(contactNumber: number) {
  const template = createDefaultProposalTemplate(contactNumber)

  return {
    subject: template.subject,
    body: template.body,
  }
}

function createLegacyDefaultProposalTemplates(count = DEFAULT_TRY_COUNT) {
  return Array.from({ length: count }, (_, index) =>
    createLegacyDefaultProposalTemplate(index + 1),
  )
}

const defaultDatabase: Database = Object.freeze({
  accountId: '',
  version: 1,
  settings: {
    accountId: '',
    sender: {
      fromEmail: '',
      fromName: 'Hessa Enterprises',
    },
    templates: createDefaultTemplates(),
    proposalTemplates: createDefaultProposalTemplates(),
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

function withDatabaseAccountId(database: Database, accountId: string) {
  database.accountId = accountId
  database.settings.accountId = accountId
  database.settings.templates = database.settings.templates.map((template) => ({
    ...template,
    accountId,
  }))
  database.settings.proposalTemplates = database.settings.proposalTemplates.map((template) => ({
    ...template,
    accountId,
  }))
  return database
}

function cloneDefaultDatabase(accountId = '') {
  return withDatabaseAccountId(JSON.parse(JSON.stringify(defaultDatabase)) as Database, accountId)
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function toStoredEmail(email: string) {
  return email.trim().toLowerCase()
}

function getDefaultScheduleTime(index: number) {
  return DEFAULT_SCHEDULE_TIMES[index % DEFAULT_SCHEDULE_TIMES.length] || '09:00'
}

function clampTargetContacts(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_TRY_COUNT
  }

  const numericValue = Math.trunc(value as number)
  return Math.min(MAX_SEQUENCE_TRIES, Math.max(1, numericValue))
}

function normalizeScheduleTime(value: unknown, fallback = '09:00') {
  if (typeof value !== 'string') {
    return fallback
  }

  const normalized = value.trim()
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(normalized) ? normalized : fallback
}

function normalizeTemplates(
  rawTemplates: unknown,
  defaults = createDefaultTemplates(),
  legacyDefaults = createLegacyDefaultTemplates(),
  createFallbackTemplate = createDefaultTemplate,
  createLegacyFallbackTemplate = createLegacyDefaultTemplate,
  accountId = '',
) {
  const incomingTemplates = Array.isArray(rawTemplates) ? rawTemplates : []
  const desiredCount = Math.max(defaults.length, incomingTemplates.length)
  const expandedDefaults = Array.from(
    { length: desiredCount },
    (_, index) => defaults[index] ?? createFallbackTemplate(index + 1),
  )
  const expandedLegacyDefaults = Array.from(
    { length: desiredCount },
    (_, index) => legacyDefaults[index] ?? createLegacyFallbackTemplate(index + 1),
  )

  return expandedDefaults.map((template, index) => {
    const incomingTemplate = incomingTemplates[index]
    const legacyTemplate = expandedLegacyDefaults[index]
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
      accountId,
      id: template.id,
      title: template.title,
      subject,
      body,
    }
  })
}

function ensureTemplateCount(
  templates: EmailTemplate[],
  targetCount: number,
  createTemplate: (contactNumber: number, accountId?: string) => EmailTemplate,
  accountId = '',
) {
  const normalizedTemplates = templates.map((template) => ({
    ...template,
    accountId,
  }))

  if (templates.length >= targetCount) {
    return normalizedTemplates
  }

  return [
    ...normalizedTemplates,
    ...Array.from({ length: targetCount - templates.length }, (_, index) =>
      createTemplate(templates.length + index + 1, accountId),
    ),
  ]
}

function normalizeHistory(rawHistory: unknown, accountId: string) {
  if (!Array.isArray(rawHistory)) {
    return []
  }

  return rawHistory.map((historyItem): FollowUpHistoryItem => {
    const normalized =
      historyItem && typeof historyItem === 'object' ? historyItem : Object.create(null)

    return {
      accountId,
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

function normalizeClient(rawClient: unknown, accountId: string): ClientRecord {
  const normalized =
    rawClient && typeof rawClient === 'object' ? rawClient : Object.create(null)
  const targetContacts =
    'targetContacts' in normalized
      ? clampTargetContacts(normalized.targetContacts)
      : DEFAULT_TRY_COUNT
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
    normalizeScheduleTime(scheduleSource[index], getDefaultScheduleTime(index)),
  )

  let status: ClientRecord['status'] = 'active'

  if ('status' in normalized && normalized.status === 'finished') {
    status = 'finished'
  } else if ('status' in normalized && normalized.status === 'canceled') {
    status = sentContacts >= targetContacts ? 'finished' : 'canceled'
  }

  return {
    accountId,
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
    history: normalizeHistory('history' in normalized ? normalized.history : [], accountId),
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

function normalizeProposal(rawProposal: unknown, accountId: string): ProposalRecord {
  const normalized =
    rawProposal && typeof rawProposal === 'object' ? rawProposal : Object.create(null)
  const targetFollowUps =
    'targetFollowUps' in normalized
      ? clampTargetContacts(normalized.targetFollowUps)
      : DEFAULT_TRY_COUNT
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
    normalizeScheduleTime(scheduleSource[index], getDefaultScheduleTime(index)),
  )
  let status = normalizeProposalStatus('status' in normalized ? normalized.status : 'active')
  if (sentFollowUps >= targetFollowUps && status !== 'canceled') {
    status = 'finished'
  }
  const now = new Date().toISOString()

  return {
    accountId,
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
    history: normalizeHistory('history' in normalized ? normalized.history : [], accountId),
  }
}

function normalizeDatabase(rawData: unknown, accountId = ''): Database {
  const database = cloneDefaultDatabase(accountId)
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
    accountId,
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
    templates: normalizeTemplates(
      'templates' in rawSettings ? rawSettings.templates : [],
      createDefaultTemplates(DEFAULT_TRY_COUNT, accountId),
      createLegacyDefaultTemplates(),
      createDefaultTemplate,
      createLegacyDefaultTemplate,
      accountId,
    ),
    proposalTemplates: normalizeTemplates(
      'proposalTemplates' in rawSettings ? rawSettings.proposalTemplates : [],
      createDefaultProposalTemplates(DEFAULT_TRY_COUNT, accountId),
      createLegacyDefaultProposalTemplates(),
      createDefaultProposalTemplate,
      createLegacyDefaultProposalTemplate,
      accountId,
    ),
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
      ? normalized.clients.map((client: unknown) => normalizeClient(client, accountId))
      : []

  database.proposals =
    'proposals' in normalized && Array.isArray(normalized.proposals)
      ? normalized.proposals.map((proposal: unknown) => normalizeProposal(proposal, accountId))
      : []

  const requiredAppointmentTemplates = Math.max(
    DEFAULT_TRY_COUNT,
    ...database.clients.map((client) => client.targetContacts),
  )
  const requiredProposalTemplates = Math.max(
    DEFAULT_TRY_COUNT,
    ...database.proposals.map((proposal) => proposal.targetFollowUps),
  )

  database.settings.templates = ensureTemplateCount(
    database.settings.templates,
    requiredAppointmentTemplates,
    createDefaultTemplate,
    accountId,
  )
  database.settings.proposalTemplates = ensureTemplateCount(
    database.settings.proposalTemplates,
    requiredProposalTemplates,
    createDefaultProposalTemplate,
    accountId,
  )

  return withDatabaseAccountId(database, accountId)
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

function getConfiguredSuperAdminEmails() {
  return DEFAULT_SUPER_ADMIN_EMAILS
}

function isSuperAdminEmail(email: string) {
  return getConfiguredSuperAdminEmails().includes(email.trim().toLowerCase())
}

function toPublicUser(
  user: User,
  membership?: Pick<AccountUserRecord, 'accountId' | 'role'>,
): AuthUser {
  return {
    accountId: membership?.accountId ?? '',
    id: user.id,
    name: getUserDisplayName(user),
    email: user.email ?? '',
    createdAt: user.created_at,
    role: membership?.role ?? (isSuperAdminEmail(user.email ?? '') ? 'super_admin' : 'owner'),
  }
}

function toTenantSession(user: User | null | undefined): AuthSession | null {
  if (!user) {
    return null
  }

  const { membership } = ensurePlatformMembership(user)
  return { user: toPublicUser(user, membership) }
}

function createAccountId(userId: string) {
  return `account-${userId}`
}

function createAccountName(user: AuthUser | User) {
  const name = 'name' in user ? user.name : getUserDisplayName(user)
  return `${name || 'Hessa'} Workspace`
}

function createDefaultAccount(user: AuthUser | User): AccountRecord {
  const userId = user.id
  const now = new Date().toISOString()

  return {
    id: createAccountId(userId),
    name: createAccountName(user),
    ownerUserId: userId,
    plan: 'free',
    subscriptionStatus: 'free',
    status: 'active',
    trialEndsAt: null,
    subscriptionStartedAt: null,
    subscriptionEndsAt: null,
    createdAt: now,
    updatedAt: now,
  }
}

function normalizePlan(value: unknown): AccountPlan {
  return value === 'basic' || value === 'pro' || value === 'business' ? value : 'free'
}

function createDefaultPlanPricing(plan: AccountPlan): PlanPricingRecord {
  return {
    plan,
    currency: 'USD',
    monthlyPriceCents: 0,
    annualPriceCents: 0,
    discountPercent: 0,
    isComingSoon: true,
    updatedAt: new Date().toISOString(),
  }
}

function normalizeCurrency(value: unknown) {
  const currency = typeof value === 'string' ? value.trim().toUpperCase() : ''
  return /^[A-Z]{3}$/.test(currency) ? currency : 'USD'
}

function normalizeMoneyCents(value: unknown) {
  const amount = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount) : 0
}

function normalizeDiscountPercent(value: unknown) {
  const discount = typeof value === 'number' ? value : Number(value)

  if (!Number.isFinite(discount)) {
    return 0
  }

  return Math.min(100, Math.max(0, Math.round(discount)))
}

function normalizePlanPricing(rawPricing: unknown): PlanPricingRecord {
  const normalized =
    rawPricing && typeof rawPricing === 'object' ? rawPricing : Object.create(null)
  const plan = normalizePlan('plan' in normalized ? normalized.plan : 'free')

  return {
    plan,
    currency: normalizeCurrency('currency' in normalized ? normalized.currency : 'USD'),
    monthlyPriceCents: normalizeMoneyCents(
      'monthlyPriceCents' in normalized
        ? normalized.monthlyPriceCents
        : 'monthly_price_cents' in normalized
          ? normalized.monthly_price_cents
          : 0,
    ),
    annualPriceCents: normalizeMoneyCents(
      'annualPriceCents' in normalized
        ? normalized.annualPriceCents
        : 'annual_price_cents' in normalized
          ? normalized.annual_price_cents
          : 0,
    ),
    discountPercent: normalizeDiscountPercent(
      'discountPercent' in normalized
        ? normalized.discountPercent
        : 'discount_percent' in normalized
          ? normalized.discount_percent
          : 0,
    ),
    isComingSoon:
      'isComingSoon' in normalized
        ? normalized.isComingSoon !== false
        : 'is_coming_soon' in normalized
          ? normalized.is_coming_soon !== false
          : true,
    updatedAt:
      ('updatedAt' in normalized && typeof normalized.updatedAt === 'string'
        ? normalized.updatedAt
        : 'updated_at' in normalized && typeof normalized.updated_at === 'string'
          ? normalized.updated_at
          : null) || new Date().toISOString(),
  }
}

function normalizePlanPricingList(rawPricing: unknown) {
  const incomingPricing = Array.isArray(rawPricing) ? rawPricing.map(normalizePlanPricing) : []

  return BILLING_PLAN_OPTIONS.map((plan) => {
    const existingPricing = incomingPricing.find((pricing) => pricing.plan === plan)
    return existingPricing ?? createDefaultPlanPricing(plan)
  })
}

function normalizeSubscriptionStatus(value: unknown): SubscriptionStatus {
  return value === 'trial' ||
    value === 'active' ||
    value === 'past_due' ||
    value === 'cancelled' ||
    value === 'suspended'
    ? value
    : 'free'
}

function normalizeAccountStatus(value: unknown): AccountStatus {
  return value === 'suspended' ? 'suspended' : 'active'
}

function normalizeRole(value: unknown, fallback: UserRole = 'owner'): UserRole {
  return value === 'super_admin' ||
    value === 'owner' ||
    value === 'admin' ||
    value === 'staff' ||
    value === 'viewer'
    ? value
    : fallback
}

function normalizeAccount(rawAccount: unknown): AccountRecord {
  const normalized =
    rawAccount && typeof rawAccount === 'object' ? rawAccount : Object.create(null)
  const now = new Date().toISOString()
  const id =
    'id' in normalized && typeof normalized.id === 'string' && normalized.id
      ? normalized.id
      : createId()

  return {
    id,
    name:
      ('name' in normalized && typeof normalized.name === 'string' && normalized.name) ||
      'Hessa Workspace',
    ownerUserId:
      ('ownerUserId' in normalized &&
        typeof normalized.ownerUserId === 'string' &&
        normalized.ownerUserId) ||
      '',
    plan: normalizePlan('plan' in normalized ? normalized.plan : 'free'),
    subscriptionStatus: normalizeSubscriptionStatus(
      'subscriptionStatus' in normalized ? normalized.subscriptionStatus : 'free',
    ),
    status: normalizeAccountStatus('status' in normalized ? normalized.status : 'active'),
    trialEndsAt:
      ('trialEndsAt' in normalized && typeof normalized.trialEndsAt === 'string'
        ? normalized.trialEndsAt
        : null) || null,
    subscriptionStartedAt:
      ('subscriptionStartedAt' in normalized &&
      typeof normalized.subscriptionStartedAt === 'string'
        ? normalized.subscriptionStartedAt
        : null) || null,
    subscriptionEndsAt:
      ('subscriptionEndsAt' in normalized && typeof normalized.subscriptionEndsAt === 'string'
        ? normalized.subscriptionEndsAt
        : null) || null,
    createdAt:
      ('createdAt' in normalized && typeof normalized.createdAt === 'string'
        ? normalized.createdAt
        : null) || now,
    updatedAt:
      ('updatedAt' in normalized && typeof normalized.updatedAt === 'string'
        ? normalized.updatedAt
        : null) || now,
  }
}

function normalizeAccountUser(rawUser: unknown): AccountUserRecord {
  const normalized = rawUser && typeof rawUser === 'object' ? rawUser : Object.create(null)

  return {
    accountId:
      ('accountId' in normalized && typeof normalized.accountId === 'string' && normalized.accountId) ||
      '',
    email:
      ('email' in normalized && typeof normalized.email === 'string' && normalized.email) || '',
    joinedAt:
      ('joinedAt' in normalized && typeof normalized.joinedAt === 'string' && normalized.joinedAt) ||
      new Date().toISOString(),
    name:
      ('name' in normalized && typeof normalized.name === 'string' && normalized.name) || '',
    role: normalizeRole('role' in normalized ? normalized.role : 'owner'),
    userId:
      ('userId' in normalized && typeof normalized.userId === 'string' && normalized.userId) ||
      createId(),
  }
}

function normalizePlatformRegistry(rawPlatform: unknown): PlatformRegistry {
  const normalized =
    rawPlatform && typeof rawPlatform === 'object' ? rawPlatform : Object.create(null)

  return {
    version:
      'version' in normalized && Number.isInteger(normalized.version) && normalized.version > 0
        ? normalized.version
        : 1,
    accounts:
      'accounts' in normalized && Array.isArray(normalized.accounts)
        ? normalized.accounts.map(normalizeAccount)
        : [],
    planPricing: normalizePlanPricingList(
      'planPricing' in normalized ? normalized.planPricing : [],
    ),
    users:
      'users' in normalized && Array.isArray(normalized.users)
        ? normalized.users.map(normalizeAccountUser)
        : [],
  }
}

function loadPlatformRegistry() {
  try {
    const stored = window.localStorage.getItem(PLATFORM_STORAGE_KEY)
    return normalizePlatformRegistry(stored ? JSON.parse(stored) : null)
  } catch {
    return normalizePlatformRegistry(null)
  }
}

function savePlatformRegistry(platform: PlatformRegistry) {
  const normalized = normalizePlatformRegistry(platform)
  window.localStorage.setItem(PLATFORM_STORAGE_KEY, JSON.stringify(normalized))
  return normalized
}

function getWorkspaceStorageKey(userId: string) {
  return `${WORKSPACE_STORAGE_PREFIX}${userId}`
}

function getAccountStorageKey(accountId: string) {
  return `${ACCOUNT_STORAGE_PREFIX}${accountId}`
}

function loadDatabaseByKey(storageKey: string, accountId: string) {
  try {
    const stored = window.localStorage.getItem(storageKey)

    if (!stored) {
      return cloneDefaultDatabase(accountId)
    }

    return normalizeDatabase(JSON.parse(stored), accountId)
  } catch {
    return cloneDefaultDatabase(accountId)
  }
}

function saveDatabaseByKey(storageKey: string, database: Database, accountId: string) {
  const normalized = normalizeDatabase(database, accountId)
  window.localStorage.setItem(storageKey, JSON.stringify(normalized))
  return normalized
}

function loadDatabaseForAccount(accountId: string) {
  return loadDatabaseByKey(getAccountStorageKey(accountId), accountId)
}

function saveDatabaseForAccount(accountId: string, database: Database) {
  return saveDatabaseByKey(getAccountStorageKey(accountId), database, accountId)
}

function ensurePlatformMembership(user: User) {
  const platform = loadPlatformRegistry()
  const email = user.email?.trim().toLowerCase() ?? ''
  const shouldBeSuperAdmin = isSuperAdminEmail(email)
  let membership = platform.users.find((item) => item.userId === user.id)
  let account: AccountRecord | undefined

  if (membership) {
    account = platform.accounts.find((item) => item.id === membership?.accountId)
  }
  let didChange = false

  if (!membership) {
    const role: UserRole = shouldBeSuperAdmin ? 'super_admin' : 'owner'
    account = createDefaultAccount(user)
    membership = {
      accountId: account.id,
      email,
      joinedAt: new Date().toISOString(),
      name: getUserDisplayName(user),
      role,
      userId: user.id,
    }
    platform.accounts.push(account)
    platform.users.push(membership)
    didChange = true
  }

  if (!account) {
    account = createDefaultAccount(user)
    account.id = membership.accountId || account.id
    platform.accounts.push(account)
    didChange = true
  }

  if (membership.email !== email || membership.name !== getUserDisplayName(user)) {
    membership.email = email
    membership.name = getUserDisplayName(user)
    didChange = true
  }

  if (shouldBeSuperAdmin && membership.role !== 'super_admin') {
    membership.role = 'super_admin'
    didChange = true
  }

  if (!shouldBeSuperAdmin && membership.role === 'super_admin') {
    membership.role = 'owner'
    didChange = true
  }

  if (didChange) {
    savePlatformRegistry(platform)
  }

  migrateLegacyWorkspaceToAccount(user.id, membership.accountId)

  return {
    account,
    membership,
    platform: didChange ? loadPlatformRegistry() : platform,
  }
}

function getUnknownErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function isTransientFetchFailure(error: unknown) {
  const message = getUnknownErrorMessage(error).toLowerCase()

  return (
    message === 'failed to fetch' ||
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('load failed')
  )
}

async function getSessionUserFromCache() {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase.auth.getSession()

  if (error) {
    throw new Error(error.message)
  }

  return data.session?.user ?? null
}

async function getVerifiedUserWithCacheFallback() {
  const supabase = getSupabaseClient()

  try {
    const { data, error } = await supabase.auth.getUser()

    if (error) {
      if (isTransientFetchFailure(error)) {
        return getSessionUserFromCache()
      }

      throw new Error(error.message)
    }

    return data.user
  } catch (error) {
    if (!isTransientFetchFailure(error)) {
      throw error
    }

    return getSessionUserFromCache()
  }
}

async function requireSession() {
  const user = await getVerifiedUserWithCacheFallback()
  const context = user ? ensurePlatformMembership(user) : null
  const session = user ? { user: toPublicUser(user, context?.membership) } : null

  if (!session) {
    throw new Error('Please sign in to continue.')
  }

  return {
    account: context?.account,
    membership: context?.membership,
    session,
  }
}

async function requireWorkspaceContext() {
  const context = await requireSession()

  if (!context.account || !context.membership) {
    throw new Error('Workspace account could not be resolved.')
  }

  if (context.account.status === 'suspended' || context.account.subscriptionStatus === 'suspended') {
    throw new Error('This account is suspended. Contact the platform owner to reactivate it.')
  }

  return {
    account: context.account,
    membership: context.membership,
    session: context.session,
  }
}

async function requireSuperAdminContext() {
  const context = await requireSession()

  if (!context.account || !context.membership || context.membership.role !== 'super_admin') {
    throw new Error('Only super admins can access the master admin panel.')
  }

  return {
    account: context.account,
    membership: context.membership,
    session: context.session,
  }
}

function migrateLegacyWorkspaceToAccount(userId: string, accountId: string) {
  const legacyStored = window.localStorage.getItem(LEGACY_STORAGE_KEY)
  const userStored = window.localStorage.getItem(getWorkspaceStorageKey(userId))
  const targetKey = getAccountStorageKey(accountId)

  if (window.localStorage.getItem(targetKey)) {
    return
  }

  try {
    const source = userStored || legacyStored

    if (!source) {
      return
    }

    const legacyDatabase = normalizeDatabase(JSON.parse(source), accountId)
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
    getDefaultScheduleTime(contactNumber - 1),
  )
}

function getProposalScheduleTime(proposal: ProposalRecord, followUpNumber: number) {
  return normalizeScheduleTime(
    proposal.followUpScheduleTimes[followUpNumber - 1],
    getDefaultScheduleTime(followUpNumber - 1),
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

function buildProposalTemplateContext(
  proposal: ProposalRecord,
  settings: SettingsState,
  followUpNumber: number,
  scheduledFor: string,
) {
  return {
    attemptsCompleted: String(proposal.sentFollowUps),
    company: proposal.company || '',
    companyOrName: proposal.company || proposal.clientName,
    contactNumber: String(followUpNumber),
    createdDate: toDateLabel(proposal.createdAt),
    email: proposal.email,
    fromEmail: settings.sender.fromEmail,
    fromName: settings.sender.fromName || 'Hessa Enterprises',
    maxContacts: String(proposal.targetFollowUps),
    name: proposal.clientName,
    nextContactDate: scheduledFor ? toDateLabel(scheduledFor) : '',
    notes: proposal.notes || '',
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

function getProposalTemplate(settings: SettingsState, contactNumber: number) {
  return settings.proposalTemplates[contactNumber - 1] ?? settings.proposalTemplates.at(-1)
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
  scheduledFor: string,
) {
  const template = getProposalTemplate(settings, followUpNumber)
  const context = buildProposalTemplateContext(proposal, settings, followUpNumber, scheduledFor)
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

function getAppStateFromDatabase(
  database: Database,
  currentUser: AuthUser,
  account: AccountRecord,
): AppState {
  return {
    account,
    currentUser,
    runtimeInfo: getRuntimeInfo(),
    settings: database.settings,
    stats: summarizeClients(database.clients),
    clients: sortClients(database.clients),
    proposals: sortProposals(database.proposals),
  }
}

function persistDatabase(accountId: string, database: Database) {
  database.clients = sortClients(database.clients)
  database.proposals = sortProposals(database.proposals)
  return saveDatabaseForAccount(accountId, database)
}

function mergeSettings(
  currentSettings: SettingsState,
  incomingSettings: SettingsInput,
  accountId: string,
): SettingsState {
  const normalizedAppointmentTemplates = normalizeTemplates(
    incomingSettings.templates,
    createDefaultTemplates(DEFAULT_TRY_COUNT, accountId),
    createLegacyDefaultTemplates(),
    createDefaultTemplate,
    createLegacyDefaultTemplate,
    accountId,
  )
  const normalizedProposalTemplates = normalizeTemplates(
    incomingSettings.proposalTemplates,
    createDefaultProposalTemplates(DEFAULT_TRY_COUNT, accountId),
    createLegacyDefaultProposalTemplates(),
    createDefaultProposalTemplate,
    createLegacyDefaultProposalTemplate,
    accountId,
  )

  return {
    accountId,
    sender: {
      fromEmail: incomingSettings.sender.fromEmail.trim(),
      fromName: incomingSettings.sender.fromName.trim() || 'Hessa Enterprises',
    },
    templates: normalizedAppointmentTemplates.map((template, index) => ({
      accountId,
      id: template.id,
      title: template.title,
      subject:
        incomingSettings.templates[index]?.subject?.trim() ||
        currentSettings.templates[index]?.subject ||
        template.subject,
      body:
        incomingSettings.templates[index]?.body ||
        currentSettings.templates[index]?.body ||
        template.body,
    })),
    proposalTemplates: normalizedProposalTemplates.map((template, index) => ({
      accountId,
      id: template.id,
      title: template.title,
      subject:
        incomingSettings.proposalTemplates[index]?.subject?.trim() ||
        currentSettings.proposalTemplates[index]?.subject ||
        template.subject,
      body:
        incomingSettings.proposalTemplates[index]?.body ||
        currentSettings.proposalTemplates[index]?.body ||
        template.body,
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
    accountId: client.accountId,
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
    scheduledFor,
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
    accountId: proposal.accountId,
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
  account: AccountRecord,
  message: string,
  processed = 1,
  sent = 1,
): AppOperationResponse {
  return {
    ...getAppStateFromDatabase(database, currentUser, account),
    result: {
      failed: 0,
      message,
      processed,
      sent,
    },
  }
}

function getAccountMetrics(accountId: string) {
  const database = loadDatabaseForAccount(accountId)
  const emailCount =
    database.clients.reduce((total, client) => total + client.sentContacts, 0) +
    database.proposals.reduce((total, proposal) => total + proposal.sentFollowUps, 0)

  return {
    appointmentCount: database.clients.length,
    emailCount,
    proposalCount: database.proposals.length,
  }
}

function getAdminPlatformState(): AdminPlatformState {
  const platform = loadPlatformRegistry()
  const accounts = platform.accounts.map((account) => {
    const users = platform.users.filter((user) => user.accountId === account.id)
    const metrics = getAccountMetrics(account.id)

    return {
      ...account,
      ...metrics,
      activeUsers: users.length,
      users,
    }
  })
  const metrics = accounts.reduce(
    (summary, account) => {
      summary.totalAccounts += 1
      summary.totalUsers += account.users.length
      summary.appointmentCount += account.appointmentCount
      summary.proposalCount += account.proposalCount
      summary.emailCount += account.emailCount

      if (account.status === 'suspended' || account.subscriptionStatus === 'suspended') {
        summary.suspendedAccounts += 1
      } else {
        summary.activeAccounts += 1
      }

      return summary
    },
    {
      activeAccounts: 0,
      appointmentCount: 0,
      emailCount: 0,
      proposalCount: 0,
      suspendedAccounts: 0,
      totalAccounts: 0,
      totalUsers: 0,
    },
  )

  return {
    accounts,
    metrics,
    planPricing: platform.planPricing,
  }
}

function isSupabaseSchemaUnavailable(error: unknown) {
  const normalized = error && typeof error === 'object' ? error : Object.create(null)
  const code = 'code' in normalized && typeof normalized.code === 'string' ? normalized.code : ''
  const message =
    'message' in normalized && typeof normalized.message === 'string' ? normalized.message : ''

  return (
    code === '42P01' ||
    code === '42703' ||
    code === 'PGRST205' ||
    message.includes('Could not find the table') ||
    message.includes('schema cache')
  )
}

function mapSupabaseAccount(rawAccount: unknown): AccountRecord {
  const normalized =
    rawAccount && typeof rawAccount === 'object' ? rawAccount : Object.create(null)

  return normalizeAccount({
    id:
      'id' in normalized && typeof normalized.id === 'string' && normalized.id
        ? normalized.id
        : '',
    name:
      'name' in normalized && typeof normalized.name === 'string' && normalized.name
        ? normalized.name
        : '',
    ownerUserId:
      'owner_user_id' in normalized && typeof normalized.owner_user_id === 'string'
        ? normalized.owner_user_id
        : '',
    plan: 'plan' in normalized ? normalized.plan : 'free',
    subscriptionStatus:
      'subscription_status' in normalized ? normalized.subscription_status : 'free',
    status: 'status' in normalized ? normalized.status : 'active',
    trialEndsAt:
      'trial_ends_at' in normalized && typeof normalized.trial_ends_at === 'string'
        ? normalized.trial_ends_at
        : null,
    subscriptionStartedAt:
      'subscription_started_at' in normalized &&
      typeof normalized.subscription_started_at === 'string'
        ? normalized.subscription_started_at
        : null,
    subscriptionEndsAt:
      'subscription_ends_at' in normalized &&
      typeof normalized.subscription_ends_at === 'string'
        ? normalized.subscription_ends_at
        : null,
    createdAt:
      'created_at' in normalized && typeof normalized.created_at === 'string'
        ? normalized.created_at
        : null,
    updatedAt:
      'updated_at' in normalized && typeof normalized.updated_at === 'string'
        ? normalized.updated_at
        : null,
  })
}

function mapSupabaseAccountUser(rawUser: unknown): AccountUserRecord {
  const normalized = rawUser && typeof rawUser === 'object' ? rawUser : Object.create(null)

  return normalizeAccountUser({
    accountId:
      'account_id' in normalized && typeof normalized.account_id === 'string'
        ? normalized.account_id
        : '',
    email:
      'email' in normalized && typeof normalized.email === 'string' ? normalized.email : '',
    joinedAt:
      'joined_at' in normalized && typeof normalized.joined_at === 'string'
        ? normalized.joined_at
        : '',
    name:
      'full_name' in normalized && typeof normalized.full_name === 'string'
        ? normalized.full_name
        : '',
    role: 'role' in normalized ? normalized.role : 'viewer',
    userId:
      'user_id' in normalized && typeof normalized.user_id === 'string'
        ? normalized.user_id
        : '',
  })
}

function mapSupabasePlanPricing(rawPricing: unknown): PlanPricingRecord {
  const normalized =
    rawPricing && typeof rawPricing === 'object' ? rawPricing : Object.create(null)

  return normalizePlanPricing({
    annual_price_cents:
      'annual_price_cents' in normalized ? normalized.annual_price_cents : 0,
    currency: 'currency' in normalized ? normalized.currency : 'USD',
    discount_percent:
      'discount_percent' in normalized ? normalized.discount_percent : 0,
    is_coming_soon:
      'is_coming_soon' in normalized ? normalized.is_coming_soon : true,
    monthly_price_cents:
      'monthly_price_cents' in normalized ? normalized.monthly_price_cents : 0,
    plan: 'plan' in normalized ? normalized.plan : 'free',
    updated_at: 'updated_at' in normalized ? normalized.updated_at : null,
  })
}

function countRowsByAccount(rows: Array<{ account_id?: unknown }>) {
  return rows.reduce((counts, row) => {
    if (typeof row.account_id === 'string') {
      counts.set(row.account_id, (counts.get(row.account_id) ?? 0) + 1)
    }

    return counts
  }, new Map<string, number>())
}

async function selectAccountIdRows(tableName: string) {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase.from(tableName).select('account_id')

  if (error) {
    if (isSupabaseSchemaUnavailable(error)) {
      return []
    }

    throw new Error(error.message)
  }

  return (data ?? []) as Array<{ account_id?: unknown }>
}

async function getAdminPlatformStateFromSupabase() {
  const supabase = getSupabaseClient()
  const { data: accountRows, error: accountsError } = await supabase
    .from('accounts')
    .select('*')
    .order('created_at', { ascending: false })

  if (accountsError) {
    if (isSupabaseSchemaUnavailable(accountsError)) {
      return null
    }

    throw new Error(accountsError.message)
  }

  const { data: userRows, error: usersError } = await supabase
    .from('account_users')
    .select('*')

  if (usersError) {
    if (isSupabaseSchemaUnavailable(usersError)) {
      return null
    }

    throw new Error(usersError.message)
  }

  const { data: pricingRows, error: pricingError } = await supabase
    .from('plan_pricing')
    .select('*')

  if (pricingError && !isSupabaseSchemaUnavailable(pricingError)) {
    throw new Error(pricingError.message)
  }

  const [
    appointmentRows,
    proposalRows,
    emailEventRows,
    gmailSendLogRows,
  ] = await Promise.all([
    selectAccountIdRows('appointments'),
    selectAccountIdRows('proposals'),
    selectAccountIdRows('email_events'),
    selectAccountIdRows('gmail_send_logs'),
  ])
  const appointmentCounts = countRowsByAccount(appointmentRows)
  const proposalCounts = countRowsByAccount(proposalRows)
  const emailEventCounts = countRowsByAccount([...emailEventRows, ...gmailSendLogRows])
  const users = (userRows ?? []).map(mapSupabaseAccountUser)
  const planPricing = normalizePlanPricingList(
    pricingError ? [] : (pricingRows ?? []).map(mapSupabasePlanPricing),
  )
  const accounts = (accountRows ?? []).map((rawAccount) => {
    const account = mapSupabaseAccount(rawAccount)
    const accountUsers = users.filter((user) => user.accountId === account.id)

    return {
      ...account,
      activeUsers: accountUsers.length,
      appointmentCount: appointmentCounts.get(account.id) ?? 0,
      emailCount: emailEventCounts.get(account.id) ?? 0,
      proposalCount: proposalCounts.get(account.id) ?? 0,
      users: accountUsers,
    }
  })

  const metrics = accounts.reduce(
    (summary, account) => {
      summary.totalAccounts += 1
      summary.totalUsers += account.users.length
      summary.appointmentCount += account.appointmentCount
      summary.proposalCount += account.proposalCount
      summary.emailCount += account.emailCount

      if (account.status === 'suspended' || account.subscriptionStatus === 'suspended') {
        summary.suspendedAccounts += 1
      } else {
        summary.activeAccounts += 1
      }

      return summary
    },
    {
      activeAccounts: 0,
      appointmentCount: 0,
      emailCount: 0,
      proposalCount: 0,
      suspendedAccounts: 0,
      totalAccounts: 0,
      totalUsers: 0,
    },
  )

  return {
    accounts,
    metrics,
    planPricing,
  }
}

async function getAdminPlatformStateFromEdge() {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase.functions.invoke<AdminPlatformState>(
    'admin-platform-state',
  )

  if (error) {
    const normalizedError = error && typeof error === 'object' ? error : Object.create(null)
    const context =
      'context' in normalizedError && normalizedError.context instanceof Response
        ? normalizedError.context
        : null
    const message = error.message ?? ''

    if (
      context?.status === 404 ||
      message.includes('Failed to send a request to the Edge Function') ||
      message.includes('Function not found')
    ) {
      return null
    }

    throw new Error(message)
  }

  return data ?? null
}

async function getBestAdminPlatformState() {
  const edgeState = await getAdminPlatformStateFromEdge()

  if (edgeState) {
    return edgeState
  }

  const localState = getAdminPlatformState()
  const supabaseState = await getAdminPlatformStateFromSupabase()

  if (!supabaseState) {
    return localState
  }

  if (supabaseState.accounts.length > 0 || localState.accounts.length === 0) {
    return supabaseState
  }

  return {
    ...localState,
    planPricing: supabaseState.planPricing,
  }
}

async function updateSupabaseAccount(
  accountId: string,
  patch: Partial<{
    plan: AccountPlan
    status: AccountStatus
    subscription_status: SubscriptionStatus
    updated_at: string
  }>,
) {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('accounts')
    .update(patch)
    .eq('id', accountId)
    .select('id')

  if (error) {
    if (isSupabaseSchemaUnavailable(error)) {
      return false
    }

    throw new Error(error.message)
  }

  return Array.isArray(data) && data.length > 0
}

async function updateSupabasePlanPricing(pricing: PlanPricingRecord) {
  const supabase = getSupabaseClient()
  const { error } = await supabase.from('plan_pricing').upsert(
    {
      annual_price_cents: pricing.annualPriceCents,
      currency: pricing.currency,
      discount_percent: pricing.discountPercent,
      is_coming_soon: pricing.isComingSoon,
      monthly_price_cents: pricing.monthlyPriceCents,
      plan: pricing.plan,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'plan' },
  )

  if (error) {
    if (isSupabaseSchemaUnavailable(error)) {
      return false
    }

    throw new Error(error.message)
  }

  return true
}

function updatePlatformAccount(
  accountId: string,
  updater: (account: AccountRecord) => AccountRecord,
) {
  const platform = loadPlatformRegistry()
  const accountIndex = platform.accounts.findIndex((account) => account.id === accountId)

  if (accountIndex === -1) {
    throw new Error('Account could not be found.')
  }

  platform.accounts[accountIndex] = updater(platform.accounts[accountIndex])
  savePlatformRegistry(platform)
}

function updatePlatformPlanPricing(
  plan: AccountPlan,
  updater: (pricing: PlanPricingRecord) => PlanPricingRecord,
) {
  const platform = loadPlatformRegistry()
  const currentPricing = normalizePlanPricingList(platform.planPricing)
  const pricingIndex = currentPricing.findIndex((pricing) => pricing.plan === plan)

  if (pricingIndex === -1) {
    throw new Error('Plan pricing could not be found.')
  }

  currentPricing[pricingIndex] = updater(currentPricing[pricingIndex])
  platform.planPricing = currentPricing
  savePlatformRegistry(platform)
}

export const webApp = {
  async getSession() {
    const supabase = getSupabaseClient()
    const { data, error } = await supabase.auth.getSession()

    if (error) {
      throw new Error(error.message)
    }

    return toTenantSession(data.session?.user)
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

    const nextSession = toTenantSession(data.session?.user)

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

    const nextSession = toTenantSession(data.user)

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
      session: toTenantSession(data.user),
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
    const { account, session } = await requireWorkspaceContext()
    return getAppStateFromDatabase(loadDatabaseForAccount(account.id), session.user, account)
  },

  async getAdminState() {
    await requireSuperAdminContext()
    return getBestAdminPlatformState()
  },

  async updateAccountPlan(accountId: string, plan: AccountPlan) {
    await requireSuperAdminContext()
    const normalizedPlan = normalizePlan(plan)
    const planPatch: Parameters<typeof updateSupabaseAccount>[1] = {
      plan: normalizedPlan,
      updated_at: new Date().toISOString(),
    }

    if (normalizedPlan === 'free') {
      planPatch.subscription_status = 'free'
    }

    const updatedInSupabase = await updateSupabaseAccount(accountId, planPatch)

    if (updatedInSupabase) {
      return getBestAdminPlatformState()
    }

    updatePlatformAccount(accountId, (account) => ({
      ...account,
      plan: normalizedPlan,
      subscriptionStatus:
        normalizedPlan === 'free' && account.subscriptionStatus !== 'suspended'
          ? 'free'
          : account.subscriptionStatus,
      updatedAt: new Date().toISOString(),
    }))

    return getAdminPlatformState()
  },

  async updateAccountStatus(accountId: string, status: AccountStatus) {
    await requireSuperAdminContext()
    const normalizedStatus = normalizeAccountStatus(status)
    const currentAdminState = await getAdminPlatformStateFromSupabase()
    const currentAccount = currentAdminState?.accounts.find((account) => account.id === accountId)
    const updatedInSupabase = await updateSupabaseAccount(accountId, {
      status: normalizedStatus,
      subscription_status:
        normalizedStatus === 'suspended'
          ? 'suspended'
          : currentAccount?.plan === 'free'
            ? 'free'
            : 'active',
      updated_at: new Date().toISOString(),
    })

    if (updatedInSupabase) {
      return getBestAdminPlatformState()
    }

    updatePlatformAccount(accountId, (account) => ({
      ...account,
      status: normalizedStatus,
      subscriptionStatus:
        normalizedStatus === 'suspended'
          ? 'suspended'
          : account.subscriptionStatus === 'suspended'
            ? account.plan === 'free'
              ? 'free'
              : 'active'
            : account.subscriptionStatus,
      updatedAt: new Date().toISOString(),
    }))

    return getAdminPlatformState()
  },

  async updatePlanPricing(pricingInput: PlanPricingRecord) {
    await requireSuperAdminContext()
    const pricing = {
      ...normalizePlanPricing(pricingInput),
      updatedAt: new Date().toISOString(),
    }
    const updatedInSupabase = await updateSupabasePlanPricing(pricing)

    if (updatedInSupabase) {
      return getBestAdminPlatformState()
    }

    updatePlatformPlanPricing(pricing.plan, () => pricing)

    return getAdminPlatformState()
  },

  async saveSettings(incomingSettings: SettingsInput) {
    const { account, session } = await requireWorkspaceContext()
    const database = loadDatabaseForAccount(account.id)
    database.settings = mergeSettings(database.settings, incomingSettings, account.id)
    const persisted = persistDatabase(account.id, database)

    return {
      ...getAppStateFromDatabase(persisted, session.user, account),
      result: {
        failed: 0,
        message: 'Workspace settings saved successfully.',
        processed: 0,
        sent: 0,
      },
    }
  },

  async createClient(clientInput: ClientInput, options: EmailDeliveryOptions = {}) {
    const { account, session } = await requireWorkspaceContext()
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
      normalizeScheduleTime(clientInput.contactScheduleTimes[index], getDefaultScheduleTime(index)),
    )

    const database = loadDatabaseForAccount(account.id)
    database.settings.templates = ensureTemplateCount(
      database.settings.templates,
      targetContacts,
      createDefaultTemplate,
      account.id,
    )
    const createdAt = new Date().toISOString()
    const client: ClientRecord = {
      id: createId(),
      accountId: account.id,
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
    persistDatabase(account.id, database)

    const shouldAutoOpen =
      database.settings.automation.autoOpenDraftOnCreate &&
      client.nextContactAt !== null &&
      new Date(client.nextContactAt).getTime() <= Date.now()

    if (shouldAutoOpen) {
      return this.sendClientFollowUp(client.id, options)
    }

    return {
      ...getAppStateFromDatabase(loadDatabaseForAccount(account.id), session.user, account),
      result: {
        failed: 0,
        message: `Client added. First draft scheduled for ${toDateLabel(client.nextContactAt)}.`,
        processed: 0,
        sent: 0,
      },
    }
  },

  async createProposal(proposalInput: ProposalInput, options: EmailDeliveryOptions = {}) {
    const { account, session } = await requireWorkspaceContext()
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
        getDefaultScheduleTime(index),
      ),
    )

    const database = loadDatabaseForAccount(account.id)
    database.settings.proposalTemplates = ensureTemplateCount(
      database.settings.proposalTemplates,
      targetFollowUps,
      createDefaultProposalTemplate,
      account.id,
    )
    const createdAt = new Date().toISOString()
    const proposal: ProposalRecord = {
      id: createId(),
      accountId: account.id,
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
    persistDatabase(account.id, database)

    const shouldAutoOpen =
      database.settings.automation.autoOpenDraftOnCreate &&
      proposal.nextFollowUpAt !== null &&
      new Date(proposal.nextFollowUpAt).getTime() <= Date.now()

    if (shouldAutoOpen) {
      return this.sendProposalFollowUp(proposal.id, options)
    }

    return {
      ...getAppStateFromDatabase(loadDatabaseForAccount(account.id), session.user, account),
      result: {
        failed: 0,
        message: `Proposal follow-up added. First email scheduled for ${toDateLabel(firstFollowUpAt)}.`,
        processed: 0,
        sent: 0,
      },
    }
  },

  async processDueFollowUps(options: EmailDeliveryOptions = {}) {
    const { account, session } = await requireWorkspaceContext()
    const database = loadDatabaseForAccount(account.id)
    const candidates = selectClientsForProcessing(database.clients)

    if (candidates.length === 0) {
      return {
        ...getAppStateFromDatabase(database, session.user, account),
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
    const persisted = persistDatabase(account.id, database)
    const remainingDue = selectClientsForProcessing(persisted.clients).length
    const suffix =
      remainingDue > 0
        ? ` ${remainingDue} more scheduled follow-ups are still due.`
        : ''

    return buildOperationResponse(
      persisted,
      session.user,
      account,
      `${delivery.method === 'gmail' ? 'Sent' : 'Opened'} the next follow-up for ${client.name}.${suffix}`,
    )
  },

  async processDueProposalFollowUps(options: EmailDeliveryOptions = {}) {
    const { account, session } = await requireWorkspaceContext()
    const database = loadDatabaseForAccount(account.id)
    const candidates = selectProposalsForProcessing(database.proposals)

    if (candidates.length === 0) {
      return {
        ...getAppStateFromDatabase(database, session.user, account),
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
    const persisted = persistDatabase(account.id, database)
    const remainingDue = selectProposalsForProcessing(persisted.proposals).length
    const suffix =
      remainingDue > 0 ? ` ${remainingDue} more proposal follow-ups are still due.` : ''

    return buildOperationResponse(
      persisted,
      session.user,
      account,
      `${delivery.method === 'gmail' ? 'Sent' : 'Opened'} the next proposal follow-up for ${proposal.clientName}.${suffix}`,
    )
  },

  async sendClientFollowUp(clientId: string, options: EmailDeliveryOptions = {}) {
    if (!clientId) {
      throw new Error('A client must be selected before opening a draft.')
    }

    const { account, session } = await requireWorkspaceContext()
    const database = loadDatabaseForAccount(account.id)
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
    const persisted = persistDatabase(account.id, database)

    return buildOperationResponse(
      persisted,
      session.user,
      account,
      `${delivery.method === 'gmail' ? 'Sent' : 'Opened'} touchpoint ${client.sentContacts} for ${client.name}.`,
    )
  },

  async sendProposalFollowUp(proposalId: string, options: EmailDeliveryOptions = {}) {
    if (!proposalId) {
      throw new Error('A proposal must be selected before opening a draft.')
    }

    const { account, session } = await requireWorkspaceContext()
    const database = loadDatabaseForAccount(account.id)
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
    const persisted = persistDatabase(account.id, database)

    return buildOperationResponse(
      persisted,
      session.user,
      account,
      `${delivery.method === 'gmail' ? 'Sent' : 'Opened'} proposal follow-up ${proposal.sentFollowUps} for ${proposal.clientName}.`,
    )
  },

  async updateClientStatus(clientId: string, nextStatus: ClientRecord['status']) {
    const { account, session } = await requireWorkspaceContext()
    const database = loadDatabaseForAccount(account.id)
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

    const persisted = persistDatabase(account.id, database)

    return {
      ...getAppStateFromDatabase(persisted, session.user, account),
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
    const { account, session } = await requireWorkspaceContext()
    const database = loadDatabaseForAccount(account.id)
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

    const persisted = persistDatabase(account.id, database)

    return {
      ...getAppStateFromDatabase(persisted, session.user, account),
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

    const { account, session } = await requireWorkspaceContext()
    const database = loadDatabaseForAccount(account.id)
    const clientIndex = database.clients.findIndex((item) => item.id === clientId)

    if (clientIndex === -1) {
      throw new Error('The selected client could not be found.')
    }

    database.clients.splice(clientIndex, 1)
    const persisted = persistDatabase(account.id, database)

    return {
      ...getAppStateFromDatabase(persisted, session.user, account),
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

    const { account, session } = await requireWorkspaceContext()
    const database = loadDatabaseForAccount(account.id)
    const proposalIndex = database.proposals.findIndex((item) => item.id === proposalId)

    if (proposalIndex === -1) {
      throw new Error('The selected proposal could not be found.')
    }

    database.proposals.splice(proposalIndex, 1)
    const persisted = persistDatabase(account.id, database)

    return {
      ...getAppStateFromDatabase(persisted, session.user, account),
      result: {
        failed: 0,
        message: 'Proposal deleted successfully.',
        processed: 0,
        sent: 0,
      },
    }
  },
}
