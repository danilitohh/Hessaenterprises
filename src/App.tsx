import { startTransition, useEffect, useEffectEvent, useRef, useState, type FormEvent } from 'react'
import appointmentManagementIcon from './assets/landing-icons/appointment-management.png?url&no-inline'
import browserAccessIcon from './assets/landing-icons/browser-access.png?url&no-inline'
import clientHistoryIcon from './assets/landing-icons/client-history.png?url&no-inline'
import emailFollowUpIcon from './assets/landing-icons/email-follow-up.png?url&no-inline'
import perUserWorkspaceIcon from './assets/landing-icons/per-user-workspace.png?url&no-inline'
import proposalPipelineIcon from './assets/landing-icons/proposal-pipeline.png?url&no-inline'
import logoWordmark from './assets/logo-wordmark.png'
import type {
  AccountPlan,
  AccountStatus,
  AdminPlatformState,
  AppOperationResponse,
  AppState,
  AuthSession,
  ClientInput,
  ClientRecord,
  ClientStatus,
  EmailTemplate,
  LoginInput,
  PasswordResetInput,
  PasswordUpdateInput,
  PlanPricingRecord,
  ProposalInput,
  ProposalRecord,
  ProposalStatus,
  RegisterInput,
  SettingsInput,
  SettingsState,
} from './types'
import {
  connectGmailAccount,
  disconnectGmailAccount,
  getGmailConnectionStatus,
  type GmailConnectionStatus,
} from './gmailIntegration'
import { supabase } from './supabaseClient'
import { webApp } from './webApp'
import './App.css'

const DEFAULT_TRY_COUNT = 4
const MAX_SEQUENCE_TRIES = 100
const DEFAULT_SCHEDULE_TIMES = ['09:00', '11:00', '14:00', '16:00']
const relativeTime = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

type Notice = {
  tone: 'error' | 'info' | 'success'
  message: string
}

type DiagnosticEntry = {
  context: string
  detail: string
  id: string
  timestamp: string
}

type AuthMode = 'forgot-password' | 'login' | 'register' | 'reset-password'
type DashboardPageId =
  | 'appointments'
  | 'dashboard'
  | 'proposals'
  | 'settings'
  | 'templates'
  | 'tracking'

type AuthFormState = {
  email: string
  name: string
  password: string
}

type DashboardPriority = 'High' | 'Low' | 'Medium'

type DashboardActivityItem = {
  description: string
  id: string
  timestamp: string | null
  title: string
  tone: 'danger' | 'info' | 'success' | 'warning'
}

type TrackingRecord = {
  company: string
  email: string
  id: string
  lastEmailAt: string | null
  name: string
  nextEmailAt: string | null
  notes: string
  sentCount: number
  status: ClientStatus | ProposalStatus
  targetCount: number
  type: 'Appointment' | 'Proposal'
}

type SettingsFormState = {
  autoOpenDraftOnCreate: boolean
  fromEmail: string
  fromName: string
  intervalDays: string
  proposalTemplates: EmailTemplate[]
  templates: EmailTemplate[]
}

type TemplateWorkflow = 'appointment' | 'proposal'

type TemplateEditorState = {
  index: number
  workflow: TemplateWorkflow
}

type PlanPricingDraft = {
  annualPrice: string
  currency: string
  discountPercent: string
  isComingSoon: boolean
  monthlyPrice: string
}

type ProposalFormState = {
  clientName: string
  company: string
  email: string
  followUpScheduleTimes: string[]
  notes: string
  targetFollowUps: number
}

function getDefaultScheduleTime(index: number) {
  return DEFAULT_SCHEDULE_TIMES[index % DEFAULT_SCHEDULE_TIMES.length] || '09:00'
}

function normalizeTryCount(value: number | string) {
  const numericValue = typeof value === 'number' ? value : Number(value)

  if (!Number.isFinite(numericValue)) {
    return DEFAULT_TRY_COUNT
  }

  return Math.min(MAX_SEQUENCE_TRIES, Math.max(1, Math.trunc(numericValue)))
}

function createAppointmentTemplate(index: number): EmailTemplate {
  const contactNumber = index + 1

  return {
    accountId: '',
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

function createProposalTemplate(index: number): EmailTemplate {
  const contactNumber = index + 1

  return {
    accountId: '',
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

function ensureTemplateCount(
  templates: EmailTemplate[],
  targetCount: number,
  workflow: TemplateWorkflow,
) {
  const desiredCount = normalizeTryCount(targetCount)
  const createTemplate = workflow === 'appointment' ? createAppointmentTemplate : createProposalTemplate
  const accountId = templates[0]?.accountId ?? ''

  if (templates.length >= desiredCount) {
    return templates
  }

  return [
    ...templates,
    ...Array.from({ length: desiredCount - templates.length }, (_, index) =>
      ({ ...createTemplate(templates.length + index), accountId }),
    ),
  ]
}

function createInitialClientForm(): ClientInput {
  return {
    company: '',
    email: '',
    name: '',
    notes: '',
    targetContacts: DEFAULT_TRY_COUNT,
    contactScheduleTimes: Array.from({ length: DEFAULT_TRY_COUNT }, (_, index) =>
      getDefaultScheduleTime(index),
    ),
  }
}

function createInitialProposalForm(): ProposalFormState {
  return {
    clientName: '',
    company: '',
    email: '',
    followUpScheduleTimes: Array.from({ length: DEFAULT_TRY_COUNT }, (_, index) =>
      getDefaultScheduleTime(index),
    ),
    notes: '',
    targetFollowUps: DEFAULT_TRY_COUNT,
  }
}

function createInitialAuthForm(): AuthFormState {
  return {
    email: '',
    name: '',
    password: '',
  }
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong.'
}

function toDiagnosticDetail(error: unknown) {
  if (error instanceof Error) {
    return error.stack || error.message
  }

  if (typeof error === 'string') {
    return error
  }

  try {
    return JSON.stringify(error, null, 2)
  } catch {
    return 'Unknown non-serializable error.'
  }
}

function getAuthTitle(authMode: AuthMode) {
  if (authMode === 'forgot-password') {
    return 'Recover your password'
  }

  if (authMode === 'reset-password') {
    return 'Create a new password'
  }

  return authMode === 'login' ? 'Welcome back' : 'Create your workspace'
}

function getAuthDescription(authMode: AuthMode) {
  if (authMode === 'forgot-password') {
    return 'Enter your account email and we will send a secure password reset link.'
  }

  if (authMode === 'reset-password') {
    return 'Set a new password for your Hessa workspace.'
  }

  return authMode === 'login'
    ? 'Sign in to open your client follow-up command center.'
    : 'Register a new account to organize clients, proposals, appointments, and next steps.'
}

function getAuthSubmitLabel(authMode: AuthMode, isAuthenticating: boolean) {
  if (isAuthenticating) {
    if (authMode === 'forgot-password') {
      return 'Sending reset link...'
    }

    if (authMode === 'reset-password') {
      return 'Updating password...'
    }

    return authMode === 'login' ? 'Signing in...' : 'Creating account...'
  }

  if (authMode === 'forgot-password') {
    return 'Send reset link'
  }

  if (authMode === 'reset-password') {
    return 'Update password'
  }

  return authMode === 'login' ? 'Log in' : 'Create account'
}

function getInitialAuthMode(): AuthMode {
  if (typeof window === 'undefined') {
    return 'login'
  }

  return new URLSearchParams(window.location.search).get('auth') === 'reset-password'
    ? 'reset-password'
    : 'login'
}

function clearAuthRecoveryUrl() {
  const url = new URL(window.location.href)
  url.searchParams.delete('auth')
  url.hash = ''
  window.history.replaceState({}, document.title, url.toString())
}

function formatDateTime(isoDate: string | null) {
  if (!isoDate) {
    return 'Pending'
  }

  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(isoDate))
}

function centsToPrice(cents: number) {
  return cents > 0 ? (cents / 100).toFixed(2) : ''
}

function priceToCents(price: string) {
  const amount = Number(price)
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : 0
}

function createPlanPricingDraft(pricing: PlanPricingRecord): PlanPricingDraft {
  return {
    annualPrice: centsToPrice(pricing.annualPriceCents),
    currency: pricing.currency,
    discountPercent: pricing.discountPercent ? String(pricing.discountPercent) : '',
    isComingSoon: pricing.isComingSoon,
    monthlyPrice: centsToPrice(pricing.monthlyPriceCents),
  }
}

function createPlanPricingDrafts(planPricing: PlanPricingRecord[] = []) {
  return planPricing.reduce(
    (drafts, pricing) => ({
      ...drafts,
      [pricing.plan]: createPlanPricingDraft(pricing),
    }),
    {} as Partial<Record<AccountPlan, PlanPricingDraft>>,
  )
}

function buildPlanPricingFromDraft(
  plan: AccountPlan,
  draft: PlanPricingDraft,
  currentPricing?: PlanPricingRecord,
): PlanPricingRecord {
  return {
    annualPriceCents: priceToCents(draft.annualPrice),
    currency: draft.currency.trim().toUpperCase() || 'USD',
    discountPercent: Math.min(100, Math.max(0, Math.round(Number(draft.discountPercent) || 0))),
    isComingSoon: draft.isComingSoon,
    monthlyPriceCents: priceToCents(draft.monthlyPrice),
    plan,
    updatedAt: currentPricing?.updatedAt ?? new Date().toISOString(),
  }
}

function formatRelativeDue(isoDate: string | null) {
  if (!isoDate) {
    return 'Not scheduled'
  }

  const diffMs = new Date(isoDate).getTime() - Date.now()
  const diffMinutes = Math.round(diffMs / 60_000)
  const diffHours = Math.round(diffMs / 3_600_000)
  const diffDays = Math.round(diffMs / 86_400_000)

  if (Math.abs(diffMinutes) < 60) {
    return relativeTime.format(diffMinutes, 'minute')
  }

  if (Math.abs(diffHours) < 48) {
    return relativeTime.format(diffHours, 'hour')
  }

  return relativeTime.format(diffDays, 'day')
}

function getClientStatusLabel(status: ClientStatus) {
  if (status === 'finished') {
    return 'Completed'
  }

  if (status === 'canceled') {
    return 'Paused'
  }

  return 'Active'
}

function getClientStageLabel(client: ClientRecord) {
  return `${client.sentContacts}/${client.targetContacts} touchpoints completed`
}

function getProposalStatusLabel(status: ProposalStatus) {
  if (status === 'finished') {
    return 'Completed'
  }

  if (status === 'canceled') {
    return 'Paused'
  }

  return 'Active'
}

function getProposalPriority(proposal: ProposalRecord): DashboardPriority {
  if (proposal.lastError || isOverdue(proposal.nextFollowUpAt)) {
    return 'High'
  }

  if (isDueToday(proposal.nextFollowUpAt) || proposal.sentFollowUps >= proposal.targetFollowUps - 1) {
    return 'Medium'
  }

  return 'Low'
}

function getProposalStageLabel(proposal: ProposalRecord) {
  return `${proposal.sentFollowUps}/${proposal.targetFollowUps} proposal follow-ups sent`
}

function createProposalAttemptStatuses(proposal: ProposalRecord) {
  return Array.from({ length: proposal.targetFollowUps }, (_, index) => {
    const followUpNumber = index + 1

    if (followUpNumber <= proposal.sentFollowUps) {
      return 'done'
    }

    if (proposal.status === 'canceled') {
      return 'stopped'
    }

    if (followUpNumber === proposal.sentFollowUps + 1) {
      return 'current'
    }

    return 'upcoming'
  })
}

function createAttemptStatuses(client: ClientRecord) {
  return Array.from({ length: client.targetContacts }, (_, index) => {
    const contactNumber = index + 1

    if (client.status === 'finished' || contactNumber <= client.sentContacts) {
      return 'done'
    }

    if (client.status === 'active' && contactNumber === client.sentContacts + 1) {
      return 'current'
    }

    if (client.status === 'canceled') {
      return 'stopped'
    }

    return 'upcoming'
  })
}

function mapSettingsToForm(settings: SettingsState): SettingsFormState {
  return {
    autoOpenDraftOnCreate: settings.automation.autoOpenDraftOnCreate,
    fromEmail: settings.sender.fromEmail,
    fromName: settings.sender.fromName,
    intervalDays: String(settings.automation.intervalDays),
    proposalTemplates: ensureTemplateCount(
      settings.proposalTemplates.map((template) => ({ ...template })),
      DEFAULT_TRY_COUNT,
      'proposal',
    ),
    templates: ensureTemplateCount(
      settings.templates.map((template) => ({ ...template })),
      DEFAULT_TRY_COUNT,
      'appointment',
    ),
  }
}

const dashboardMetrics = [
  { label: 'Upcoming follow-ups', value: '12' },
  { label: 'Pending proposals', value: '7' },
  { label: 'Client appointments', value: '4' },
  { label: 'Emails to send today', value: '9' },
]

const proposalStatuses = ['Sent', 'Pending', 'Approved', 'Declined']

const landingFeatures = [
  {
    icon: emailFollowUpIcon,
    title: 'Email follow-up tracking',
    description: 'See every next email, due date, and prepared message before a client goes cold.',
  },
  {
    icon: appointmentManagementIcon,
    title: 'Appointment management',
    description: 'Keep reminders visible for walkthroughs, calls, consultations, and site visits.',
  },
  {
    icon: proposalPipelineIcon,
    title: 'Proposal pipeline',
    description: 'Track proposal movement from sent to pending, approved, declined, or ready to revive.',
  },
  {
    icon: perUserWorkspaceIcon,
    title: 'Per-user workspace',
    description: 'Each account gets its own clients, notes, follow-up sequences, and settings.',
  },
  {
    icon: clientHistoryIcon,
    title: 'Client history',
    description: 'Keep context, notes, outreach attempts, and next steps in one organized timeline.',
  },
  {
    icon: browserAccessIcon,
    title: 'Browser-based access',
    description: 'Open the workspace from the web without a desktop install or complicated setup.',
  },
]

const landingPlanCards: Array<{
  plan: AccountPlan
  title: string
  description: string
  features: string[]
}> = [
  {
    plan: 'free',
    title: 'Free',
    description: 'Start organizing follow-ups while the billing system is being prepared.',
    features: ['Basic workspace access', 'Appointment follow-up tracking', 'Proposal reminders'],
  },
  {
    plan: 'basic',
    title: 'Basic',
    description: 'Designed for solo operators who need a clean client follow-up rhythm.',
    features: ['More follow-up sequences', 'Reusable templates', 'Gmail sending readiness'],
  },
  {
    plan: 'pro',
    title: 'Pro',
    description: 'Built for growing teams that manage appointments and proposal pipelines daily.',
    features: ['Team workflow controls', 'Advanced tracking overview', 'Priority workspace tools'],
  },
  {
    plan: 'business',
    title: 'Business',
    description: 'Prepared for service companies that need admin control and future billing scale.',
    features: ['Account-level controls', 'Subscription readiness', 'Future payment integrations'],
  },
]

const howItWorksSteps = [
  {
    title: 'Add your client',
    description: 'Capture the contact, company, opportunity notes, and the right follow-up cadence.',
  },
  {
    title: 'Schedule the follow-up',
    description: 'Pick the next email or appointment reminder so the opportunity keeps moving.',
  },
  {
    title: 'Track the proposal',
    description: 'Mark proposal status and keep pending decisions from disappearing into inbox noise.',
  },
  {
    title: 'Close the opportunity',
    description: 'Use a clear client history to follow up at the right moment and win more work.',
  },
]

const templateTokens = [
  '{{name}}',
  '{{company}}',
  '{{companyOrName}}',
  '{{contactNumber}}',
  '{{maxContacts}}',
  '{{fromName}}',
  '{{fromEmail}}',
  '{{notes}}',
  '{{scheduledDate}}',
  '{{scheduledTime}}',
]

const dashboardNavItems: Array<{ href: DashboardPageId; label: string }> = [
  { href: 'dashboard', label: 'Dashboard' },
  { href: 'appointments', label: 'Appointments' },
  { href: 'proposals', label: 'Proposals' },
  { href: 'tracking', label: 'Tracking' },
  { href: 'templates', label: 'Templates' },
  { href: 'settings', label: 'Settings' },
]

const accountPlanOptions: AccountPlan[] = ['free', 'basic', 'pro', 'business']
const accountStatusOptions: AccountStatus[] = ['active', 'suspended']

const dashboardPageIds = new Set<DashboardPageId>(dashboardNavItems.map((item) => item.href))

function getInitialDashboardPage(): DashboardPageId {
  if (typeof window === 'undefined') {
    return 'dashboard'
  }

  const rawHashPage = window.location.hash.replace('#', '')
  const hashPage =
    rawHashPage === 'clients'
      ? 'appointments'
      : rawHashPage === 'follow-ups'
        ? 'tracking'
        : (rawHashPage as DashboardPageId)
  return dashboardPageIds.has(hashPage) ? hashPage : 'dashboard'
}

function isAdminPath(pathname = window.location.pathname) {
  return pathname === '/admin' || pathname === '/super-admin'
}

function getDashboardPageForSection(sectionId: string): DashboardPageId {
  if (sectionId === 'new-client' || sectionId.startsWith('client-record-')) {
    return 'appointments'
  }

  if (dashboardPageIds.has(sectionId as DashboardPageId)) {
    return sectionId as DashboardPageId
  }

  if (sectionId === 'clients') {
    return 'appointments'
  }

  if (sectionId === 'follow-ups') {
    return 'tracking'
  }

  return 'dashboard'
}

function getInitials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
}

function getStartOfToday() {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  return date
}

function getEndOfToday() {
  const date = new Date()
  date.setHours(23, 59, 59, 999)
  return date
}

function isDueToday(isoDate: string | null) {
  if (!isoDate) {
    return false
  }

  const dueDate = new Date(isoDate)
  return dueDate >= getStartOfToday() && dueDate <= getEndOfToday()
}

function isOverdue(isoDate: string | null) {
  if (!isoDate) {
    return false
  }

  return new Date(isoDate) < getStartOfToday()
}

function isOpenProposal(proposal: ProposalRecord) {
  return proposal.status === 'active'
}

function isProposalFollowUpDue(proposal: ProposalRecord) {
  if (
    !isOpenProposal(proposal) ||
    proposal.sentFollowUps >= proposal.targetFollowUps ||
    !proposal.nextFollowUpAt
  ) {
    return false
  }

  return new Date(proposal.nextFollowUpAt).getTime() <= Date.now()
}

function compareNullableDates(firstDate: string | null, secondDate: string | null) {
  const first = firstDate ? new Date(firstDate).getTime() : Number.POSITIVE_INFINITY
  const second = secondDate ? new Date(secondDate).getTime() : Number.POSITIVE_INFINITY
  return first - second
}

function App() {
  const diagnosticIdRef = useRef(0)
  const [session, setSession] = useState<AuthSession | null>(null)
  const [appState, setAppState] = useState<AppState | null>(null)
  const [clientForm, setClientForm] = useState<ClientInput>(() => createInitialClientForm())
  const [proposalForm, setProposalForm] = useState<ProposalFormState>(() =>
    createInitialProposalForm(),
  )
  const [authForm, setAuthForm] = useState<AuthFormState>(() => createInitialAuthForm())
  const [settingsForm, setSettingsForm] = useState<SettingsFormState | null>(null)
  const [authMode, setAuthMode] = useState<AuthMode>(() => getInitialAuthMode())
  const [notice, setNotice] = useState<Notice | null>(null)
  const [diagnostics, setDiagnostics] = useState<DiagnosticEntry[]>([])
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false)
  const [isAdminRoute, setIsAdminRoute] = useState(() =>
    typeof window === 'undefined' ? false : isAdminPath(window.location.pathname),
  )
  const [adminState, setAdminState] = useState<AdminPlatformState | null>(null)
  const [planPricingDrafts, setPlanPricingDrafts] = useState<
    Partial<Record<AccountPlan, PlanPricingDraft>>
  >({})
  const [isLoadingAdmin, setIsLoadingAdmin] = useState(false)
  const [busyAdminAccountId, setBusyAdminAccountId] = useState<string | null>(null)
  const [busyPlanPricingId, setBusyPlanPricingId] = useState<AccountPlan | null>(null)
  const [activeDashboardPage, setActiveDashboardPage] = useState<DashboardPageId>(() =>
    getInitialDashboardPage(),
  )
  const [dashboardSearch, setDashboardSearch] = useState('')
  const [gmailConnection, setGmailConnection] = useState<GmailConnectionStatus | null>(null)
  const [isCheckingGmailConnection, setIsCheckingGmailConnection] = useState(false)
  const [isConnectingGmail, setIsConnectingGmail] = useState(false)
  const [isDisconnectingGmail, setIsDisconnectingGmail] = useState(false)
  const [loading, setLoading] = useState(true)
  const [isAuthenticating, setIsAuthenticating] = useState(false)
  const [isGoogleAuthenticating, setIsGoogleAuthenticating] = useState(false)
  const [isSubmittingClient, setIsSubmittingClient] = useState(false)
  const [isSubmittingProposal, setIsSubmittingProposal] = useState(false)
  const [isSavingSettings, setIsSavingSettings] = useState(false)
  const [isProcessingQueue, setIsProcessingQueue] = useState(false)
  const [isProcessingProposalQueue, setIsProcessingProposalQueue] = useState(false)
  const [busyClientId, setBusyClientId] = useState<string | null>(null)
  const [busyProposalId, setBusyProposalId] = useState<string | null>(null)
  const [appointmentTemplateChoice, setAppointmentTemplateChoice] = useState(0)
  const [proposalTemplateChoice, setProposalTemplateChoice] = useState(0)
  const [templateEditor, setTemplateEditor] = useState<TemplateEditorState | null>(null)

  function recordDiagnostic(context: string, error: unknown) {
    diagnosticIdRef.current += 1

    const entry: DiagnosticEntry = {
      context,
      detail: toDiagnosticDetail(error),
      id: `diagnostic-${diagnosticIdRef.current}`,
      timestamp: new Date().toISOString(),
    }

    setDiagnostics((current) => [entry, ...current].slice(0, 10))
  }

  function buildDiagnosticsReport() {
    return [
      'Hessa diagnostics report',
      `Generated: ${new Date().toISOString()}`,
      `Page: ${window.location.href}`,
      `User agent: ${navigator.userAgent}`,
      `Session: ${session ? `signed in as ${session.user.email}` : 'signed out'}`,
      '',
      diagnostics.length
        ? diagnostics
            .map(
              (entry, index) =>
                [
                  `#${index + 1} ${entry.context}`,
                  `Time: ${entry.timestamp}`,
                  `Detail: ${entry.detail}`,
                ].join('\n'),
            )
            .join('\n\n')
        : 'No diagnostics captured yet.',
    ].join('\n')
  }

  async function copyDiagnosticsReport() {
    try {
      await navigator.clipboard.writeText(buildDiagnosticsReport())
      setNotice({
        tone: 'success',
        message: 'Diagnostics copied. Send that report to support.',
      })
    } catch (error) {
      recordDiagnostic('Copy diagnostics', error)
      setNotice({
        tone: 'error',
        message: 'Could not copy diagnostics. You can select the text manually.',
      })
    }
  }

  function applyAppState(nextState: AppState, syncSettings: boolean) {
    startTransition(() => {
      setAppState(nextState)
    })

    if (syncSettings) {
      setSettingsForm(mapSettingsToForm(nextState.settings))
    }
  }

  function applyOperationResponse(response: AppOperationResponse, syncSettings: boolean) {
    applyAppState(response, syncSettings)

    if (response.result?.message) {
      setNotice({
        tone: response.result.failed > 0 ? 'error' : 'success',
        message: response.result.message,
      })

      if (response.result.failed > 0) {
        recordDiagnostic('Workspace operation', response.result.message)
      }
    }
  }

  function applyAdminState(nextAdminState: AdminPlatformState) {
    setAdminState(nextAdminState)
    setPlanPricingDrafts(createPlanPricingDrafts(nextAdminState.planPricing))
  }

  const refreshState = useEffectEvent(async (syncSettings = false) => {
    try {
      const nextState = await webApp.getAppState()
      applyAppState(nextState, syncSettings || settingsForm === null)
    } catch (error) {
      const message = toErrorMessage(error)

      if (message === 'Please sign in to continue.') {
        setSession(null)
        setAppState(null)
        setSettingsForm(null)
        setAdminState(null)
        setPlanPricingDrafts({})
      }

      setNotice({
        tone: 'error',
        message,
      })
      recordDiagnostic('Refresh workspace state', error)
    } finally {
      setLoading(false)
    }
  })

  async function refreshAdminState() {
    setIsLoadingAdmin(true)

    try {
      const nextAdminState = await webApp.getAdminState()
      applyAdminState(nextAdminState)
    } catch (error) {
      setNotice({
        tone: 'error',
        message: toErrorMessage(error),
      })
      recordDiagnostic('Refresh super admin state', error)
    } finally {
      setIsLoadingAdmin(false)
    }
  }

  const refreshAdminStateFromEffect = useEffectEvent(async () => {
    await refreshAdminState()
  })

  async function handleAdminPlanChange(accountId: string, plan: AccountPlan) {
    setBusyAdminAccountId(accountId)

    try {
      const nextAdminState = await webApp.updateAccountPlan(accountId, plan)
      applyAdminState(nextAdminState)
      setNotice({
        tone: 'success',
        message: 'Account plan updated.',
      })
    } catch (error) {
      setNotice({
        tone: 'error',
        message: toErrorMessage(error),
      })
      recordDiagnostic('Update account plan', error)
    } finally {
      setBusyAdminAccountId(null)
    }
  }

  async function handleAdminStatusChange(accountId: string, status: AccountStatus) {
    setBusyAdminAccountId(accountId)

    try {
      const nextAdminState = await webApp.updateAccountStatus(accountId, status)
      applyAdminState(nextAdminState)
      setNotice({
        tone: 'success',
        message: status === 'suspended' ? 'Account suspended.' : 'Account activated.',
      })
    } catch (error) {
      setNotice({
        tone: 'error',
        message: toErrorMessage(error),
      })
      recordDiagnostic('Update account status', error)
    } finally {
      setBusyAdminAccountId(null)
    }
  }

  function updatePlanPricingDraft(plan: AccountPlan, patch: Partial<PlanPricingDraft>) {
    setPlanPricingDrafts((currentDrafts) => {
      const currentPricing = adminState?.planPricing.find((pricing) => pricing.plan === plan)
      const currentDraft =
        currentDrafts[plan] ??
        (currentPricing
          ? createPlanPricingDraft(currentPricing)
          : createPlanPricingDraft({
              annualPriceCents: 0,
              currency: 'USD',
              discountPercent: 0,
              isComingSoon: true,
              monthlyPriceCents: 0,
              plan,
              updatedAt: new Date().toISOString(),
            }))

      return {
        ...currentDrafts,
        [plan]: {
          ...currentDraft,
          ...patch,
        },
      }
    })
  }

  async function handlePlanPricingSave(plan: AccountPlan) {
    const currentPricing = adminState?.planPricing.find((pricing) => pricing.plan === plan)
    const draft = planPricingDrafts[plan]

    if (!draft) {
      return
    }

    setBusyPlanPricingId(plan)

    try {
      const nextAdminState = await webApp.updatePlanPricing(
        buildPlanPricingFromDraft(plan, draft, currentPricing),
      )
      applyAdminState(nextAdminState)
      setNotice({
        tone: 'success',
        message: `${plan} pricing settings saved.`,
      })
    } catch (error) {
      setNotice({
        tone: 'error',
        message: toErrorMessage(error),
      })
      recordDiagnostic('Update plan pricing', error)
    } finally {
      setBusyPlanPricingId(null)
    }
  }

  const syncAuthSession = useEffectEvent(async () => {
    try {
      const nextSession = await webApp.getSession()
      setSession(nextSession)

      if (nextSession) {
        setAuthForm(createInitialAuthForm())
      }
    } catch (error) {
      setNotice({
        tone: 'error',
        message: toErrorMessage(error),
      })
      recordDiagnostic('Sync auth session', error)
    }
  })

  async function refreshGmailConnection(showErrors = false) {
    if (!session) {
      return
    }

    setIsCheckingGmailConnection(true)

    try {
      const nextConnection = await getGmailConnectionStatus()
      setGmailConnection(nextConnection)
    } catch (error) {
      setGmailConnection({
        connected: false,
        connectedAt: null,
        email: null,
        mode: 'draft',
      })
      recordDiagnostic('Gmail connection status', error)

      if (showErrors) {
        setNotice({
          tone: 'error',
          message: toErrorMessage(error),
        })
      }
    } finally {
      setIsCheckingGmailConnection(false)
    }
  }

  const refreshGmailConnectionFromEffect = useEffectEvent(async (showErrors = false) => {
    await refreshGmailConnection(showErrors)
  })

  const processAutomaticGmailFollowUps = useEffectEvent(async () => {
    if (!gmailConnection?.connected || !appState?.stats.dueNow || isProcessingQueue) {
      return
    }

    setIsProcessingQueue(true)

    try {
      const response = await webApp.processDueFollowUps({
        preferGmail: true,
      })
      applyOperationResponse(response, false)
    } catch (error) {
      setNotice({
        tone: 'error',
        message: toErrorMessage(error),
      })
      recordDiagnostic('Automatic Gmail follow-up send', error)
    } finally {
      setIsProcessingQueue(false)
    }
  })

  const processAutomaticGmailProposalFollowUps = useEffectEvent(async () => {
    if (
      !gmailConnection?.connected ||
      !appState?.proposals.some(isProposalFollowUpDue) ||
      isProcessingProposalQueue
    ) {
      return
    }

    setIsProcessingProposalQueue(true)

    try {
      const response = await webApp.processDueProposalFollowUps({
        preferGmail: true,
      })
      applyOperationResponse(response, false)
    } catch (error) {
      setNotice({
        tone: 'error',
        message: toErrorMessage(error),
      })
      recordDiagnostic('Automatic Gmail proposal follow-up send', error)
    } finally {
      setIsProcessingProposalQueue(false)
    }
  })

  useEffect(() => {
    const handleHashChange = () => {
      setIsAdminRoute(isAdminPath(window.location.pathname))
      setActiveDashboardPage(getInitialDashboardPage())
    }
    const handlePopState = () => {
      setIsAdminRoute(isAdminPath(window.location.pathname))
    }

    window.addEventListener('hashchange', handleHashChange)
    window.addEventListener('popstate', handlePopState)

    return () => {
      window.removeEventListener('hashchange', handleHashChange)
      window.removeEventListener('popstate', handlePopState)
    }
  }, [])

  useEffect(() => {
    const handleWindowError = (event: ErrorEvent) => {
      recordDiagnostic('Browser runtime error', event.error ?? event.message)
    }
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      recordDiagnostic('Unhandled promise rejection', event.reason)
    }

    window.addEventListener('error', handleWindowError)
    window.addEventListener('unhandledrejection', handleUnhandledRejection)

    const currentUrl = new URL(window.location.href)
    const authError =
      currentUrl.searchParams.get('error_description') ||
      currentUrl.searchParams.get('error') ||
      currentUrl.hash.match(/error_description=([^&]+)/)?.[1] ||
      currentUrl.hash.match(/error=([^&]+)/)?.[1]
    const authErrorTimer = authError
      ? window.setTimeout(() => {
          recordDiagnostic('Auth redirect error', decodeURIComponent(authError.replace(/\+/g, ' ')))
        }, 0)
      : null

    return () => {
      if (authErrorTimer) {
        window.clearTimeout(authErrorTimer)
      }

      window.removeEventListener('error', handleWindowError)
      window.removeEventListener('unhandledrejection', handleUnhandledRejection)
    }
  }, [])

  useEffect(() => {
    const boot = async () => {
      try {
        const nextSession = await webApp.getSession()
        setSession(nextSession)
      } catch (error) {
        setNotice({
          tone: 'error',
          message: toErrorMessage(error),
        })
        recordDiagnostic('Initial auth session check', error)
      } finally {
        setLoading(false)
      }
    }

    void boot()
  }, [])

  useEffect(() => {
    if (!supabase) {
      return
    }

    const recoveryTimer =
      new URLSearchParams(window.location.search).get('auth') === 'reset-password'
        ? window.setTimeout(() => {
            setAuthMode('reset-password')
          }, 0)
        : null

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      window.setTimeout(() => {
        if (event === 'PASSWORD_RECOVERY') {
          setAuthMode('reset-password')
          setNotice({
            tone: 'info',
            message: 'Choose a new password to finish recovering your account.',
          })
        }

        if (event === 'SIGNED_OUT') {
          setSession(null)
          setAppState(null)
          setSettingsForm(null)
          setGmailConnection(null)
          setAdminState(null)
          setPlanPricingDrafts({})
          return
        }

        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
          void syncAuthSession()
        }
      }, 0)
    })

    return () => {
      if (recoveryTimer) {
        window.clearTimeout(recoveryTimer)
      }

      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!session) {
      return
    }

    const bootId = window.setTimeout(() => {
      setLoading(true)
      void refreshState(true)
    }, 0)

    const intervalId = window.setInterval(() => {
      void refreshState(false)
    }, 30_000)

    return () => {
      window.clearTimeout(bootId)
      window.clearInterval(intervalId)
    }
  }, [session])

  useEffect(() => {
    if (!session || !isAdminRoute) {
      return
    }

    const adminRefreshId = window.setTimeout(() => {
      void refreshAdminStateFromEffect()
    }, 0)

    return () => {
      window.clearTimeout(adminRefreshId)
    }
  }, [session, isAdminRoute])

  useEffect(() => {
    if (!session) {
      return
    }

    const gmailTimer = window.setTimeout(() => {
      const currentUrl = new URL(window.location.href)
      const gmailResult = currentUrl.searchParams.get('gmail')
      const gmailError = currentUrl.searchParams.get('gmail_error')

      if (gmailResult === 'connected') {
        setNotice({
          tone: 'success',
          message:
            'Gmail connected. Follow-up emails can now be sent from your connected Gmail account.',
        })
        currentUrl.searchParams.delete('gmail')
        window.history.replaceState({}, document.title, currentUrl.toString())
      }

      if (gmailError) {
        const message = decodeURIComponent(gmailError.replace(/\+/g, ' '))
        setNotice({
          tone: 'error',
          message,
        })
        recordDiagnostic('Gmail OAuth callback', message)
        currentUrl.searchParams.delete('gmail_error')
        window.history.replaceState({}, document.title, currentUrl.toString())
      }

      void refreshGmailConnectionFromEffect(gmailResult === 'connected' || Boolean(gmailError))
    }, 0)

    return () => {
      window.clearTimeout(gmailTimer)
    }
  }, [session])

  useEffect(() => {
    if (!session || !gmailConnection?.connected) {
      return
    }

    const initialCheckId = window.setTimeout(() => {
      void processAutomaticGmailFollowUps().then(() => processAutomaticGmailProposalFollowUps())
    }, 1_000)

    const intervalId = window.setInterval(() => {
      void processAutomaticGmailFollowUps().then(() => processAutomaticGmailProposalFollowUps())
    }, 60_000)

    return () => {
      window.clearTimeout(initialCheckId)
      window.clearInterval(intervalId)
    }
  }, [session, gmailConnection?.connected, appState?.stats.dueNow, appState?.proposals])

  function updateClientSchedule(rawTargetContacts: number | string) {
    const targetContacts = normalizeTryCount(rawTargetContacts)

    setClientForm((current) => {
      const nextSchedule = Array.from({ length: targetContacts }, (_, index) =>
        current.contactScheduleTimes[index] || getDefaultScheduleTime(index),
      )

      return {
        ...current,
        targetContacts,
        contactScheduleTimes: nextSchedule,
      }
    })

    setSettingsForm((current) =>
      current
        ? {
            ...current,
            templates: ensureTemplateCount(current.templates, targetContacts, 'appointment'),
          }
        : current,
    )
  }

  function updateProposalSchedule(rawTargetFollowUps: number | string) {
    const targetFollowUps = normalizeTryCount(rawTargetFollowUps)

    setProposalForm((current) => {
      const nextSchedule = Array.from({ length: targetFollowUps }, (_, index) =>
        current.followUpScheduleTimes[index] || getDefaultScheduleTime(index),
      )

      return {
        ...current,
        targetFollowUps,
        followUpScheduleTimes: nextSchedule,
      }
    })

    setSettingsForm((current) =>
      current
        ? {
            ...current,
            proposalTemplates: ensureTemplateCount(
              current.proposalTemplates,
              targetFollowUps,
              'proposal',
            ),
          }
        : current,
    )
  }

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsAuthenticating(true)

    try {
      if (authMode === 'forgot-password') {
        const payload: PasswordResetInput = {
          email: authForm.email,
        }

        await webApp.requestPasswordReset(payload)
        setAuthForm(createInitialAuthForm())
        setAuthMode('login')
        setNotice({
          tone: 'success',
          message: 'Password recovery email sent. Check your inbox for the secure reset link.',
        })
      } else if (authMode === 'reset-password') {
        const payload: PasswordUpdateInput = {
          password: authForm.password,
        }
        const result = await webApp.updatePassword(payload)

        setAuthForm(createInitialAuthForm())
        setAuthMode('login')
        clearAuthRecoveryUrl()
        setNotice({
          tone: 'success',
          message: result.message,
        })

        if (result.session) {
          setSession(result.session)
        }
      } else if (authMode === 'register') {
        const payload: RegisterInput = {
          name: authForm.name,
          email: authForm.email,
          password: authForm.password,
        }

        const result = await webApp.register(payload)
        setAuthForm(createInitialAuthForm())
        setNotice({
          tone: 'success',
          message: result.message,
        })

        if (result.session) {
          setSession(result.session)
        } else {
          setAuthMode('login')
        }
      } else {
        const payload: LoginInput = {
          email: authForm.email,
          password: authForm.password,
        }

        const result = await webApp.login(payload)
        setAuthForm(createInitialAuthForm())
        setNotice({
          tone: 'success',
          message: result.message,
        })

        if (result.session) {
          setSession(result.session)
        }
      }
    } catch (error) {
      setNotice({
        tone: 'error',
        message: toErrorMessage(error),
      })
      recordDiagnostic(`Auth submit: ${authMode}`, error)
    } finally {
      setIsAuthenticating(false)
    }
  }

  async function handleGoogleAuth() {
    setIsGoogleAuthenticating(true)

    try {
      await webApp.loginWithGoogle()
      setNotice({
        tone: 'info',
        message: 'Redirecting to Google for secure sign-in...',
      })
    } catch (error) {
      setNotice({
        tone: 'error',
        message: toErrorMessage(error),
      })
      recordDiagnostic('Google auth redirect', error)
      setIsGoogleAuthenticating(false)
    }
  }

  async function handleConnectGmail() {
    setIsConnectingGmail(true)

    try {
      await connectGmailAccount()
      setNotice({
        tone: 'info',
        message: 'Redirecting to Google to connect Gmail...',
      })
    } catch (error) {
      setNotice({
        tone: 'error',
        message: toErrorMessage(error),
      })
      recordDiagnostic('Connect Gmail', error)
      setIsConnectingGmail(false)
    }
  }

  async function handleDisconnectGmail() {
    setIsDisconnectingGmail(true)

    try {
      await disconnectGmailAccount()
      await refreshGmailConnection(false)
      setNotice({
        tone: 'info',
        message: 'Gmail disconnected. Follow-ups will open as email drafts again.',
      })
    } catch (error) {
      setNotice({
        tone: 'error',
        message: toErrorMessage(error),
      })
      recordDiagnostic('Disconnect Gmail', error)
    } finally {
      setIsDisconnectingGmail(false)
    }
  }

  function handleLandingAuthCta(nextMode: AuthMode) {
    setAuthMode(nextMode)
    window.setTimeout(() => {
      document.getElementById('account-access')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    }, 0)
  }

  function openDashboardPage(pageId: DashboardPageId, targetId: string = pageId) {
    if (isAdminRoute) {
      window.history.pushState({}, document.title, '/')
      setIsAdminRoute(false)
    }

    setActiveDashboardPage(pageId)

    const nextUrl = new URL(window.location.href)
    nextUrl.hash = pageId
    window.history.replaceState({}, document.title, nextUrl.toString())

    window.setTimeout(() => {
      if (targetId !== pageId) {
        document.getElementById(targetId)?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        })
        return
      }

      document.querySelector('.dashboard-workspace')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    }, 0)
  }

  function scrollToDashboardSection(sectionId: string) {
    openDashboardPage(getDashboardPageForSection(sectionId), sectionId)
  }

  function openAdminPanel() {
    window.history.pushState({}, document.title, '/admin')
    setIsAdminRoute(true)
    window.setTimeout(() => {
      document.querySelector('.dashboard-workspace')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    }, 0)
  }

  async function handleRecoveryExit() {
    clearAuthRecoveryUrl()
    setAuthForm(createInitialAuthForm())
    setAuthMode('login')

    if (!session) {
      return
    }

    try {
      await webApp.logout()
      setSession(null)
      setAppState(null)
      setSettingsForm(null)
      setGmailConnection(null)
      setAdminState(null)
      setPlanPricingDrafts({})
      setNotice({
        tone: 'info',
        message: 'Password recovery was canceled. You can log in again when ready.',
      })
    } catch (error) {
      setNotice({
        tone: 'error',
        message: toErrorMessage(error),
      })
      recordDiagnostic('Cancel password recovery', error)
    }
  }

  async function handleLogout() {
    try {
      await webApp.logout()
      setSession(null)
      setAppState(null)
      setSettingsForm(null)
      setGmailConnection(null)
      setAdminState(null)
      setPlanPricingDrafts({})
      setNotice({
        tone: 'info',
        message: 'You have been signed out.',
      })
    } catch (error) {
      setNotice({
        tone: 'error',
        message: toErrorMessage(error),
      })
      recordDiagnostic('Logout', error)
    }
  }

  async function handleClientSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSubmittingClient(true)

    try {
      const response = await webApp.createClient(clientForm, {
        preferGmail: gmailConnection?.connected ?? false,
      })
      applyOperationResponse(response, false)
      setClientForm(createInitialClientForm())
    } catch (error) {
      setNotice({
        tone: 'error',
        message: toErrorMessage(error),
      })
      recordDiagnostic('Create client', error)
    } finally {
      setIsSubmittingClient(false)
    }
  }

  async function handleProposalSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSubmittingProposal(true)

    const payload: ProposalInput = {
      clientName: proposalForm.clientName,
      email: proposalForm.email,
      company: proposalForm.company,
      notes: proposalForm.notes,
      targetFollowUps: proposalForm.targetFollowUps,
      followUpScheduleTimes: proposalForm.followUpScheduleTimes,
    }

    try {
      const response = await webApp.createProposal(payload, {
        preferGmail: gmailConnection?.connected ?? false,
      })
      applyOperationResponse(response, false)
      setProposalForm(createInitialProposalForm())
    } catch (error) {
      setNotice({
        tone: 'error',
        message: toErrorMessage(error),
      })
      recordDiagnostic('Create proposal', error)
    } finally {
      setIsSubmittingProposal(false)
    }
  }

  function updateTemplateDraft(
    workflow: TemplateWorkflow,
    index: number,
    field: 'body' | 'subject',
    value: string,
  ) {
    setSettingsForm((current) => {
      if (!current) {
        return current
      }

      const key = workflow === 'appointment' ? 'templates' : 'proposalTemplates'

      return {
        ...current,
        [key]: current[key].map((template, itemIndex) =>
          itemIndex === index ? { ...template, [field]: value } : template,
        ),
      }
    })
  }

  async function saveSettingsChanges() {
    if (!settingsForm) {
      return false
    }

    setIsSavingSettings(true)

    const payload: SettingsInput = {
      sender: {
        fromEmail: settingsForm.fromEmail.trim(),
        fromName: settingsForm.fromName.trim(),
      },
      templates: settingsForm.templates.map((template) => ({
        ...template,
        subject: template.subject.trim(),
        body: template.body,
      })),
      proposalTemplates: settingsForm.proposalTemplates.map((template) => ({
        ...template,
        subject: template.subject.trim(),
        body: template.body,
      })),
      automation: {
        intervalDays: Math.max(1, Number(settingsForm.intervalDays) || 2),
        autoOpenDraftOnCreate: settingsForm.autoOpenDraftOnCreate,
      },
    }

    try {
      const response = await webApp.saveSettings(payload)
      applyOperationResponse(response, true)
      return true
    } catch (error) {
      setNotice({
        tone: 'error',
        message: toErrorMessage(error),
      })
      recordDiagnostic('Save settings', error)
      return false
    } finally {
      setIsSavingSettings(false)
    }
  }

  async function handleSaveTemplateModal() {
    const saved = await saveSettingsChanges()

    if (saved) {
      setTemplateEditor(null)
    }
  }

  async function handleSaveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await saveSettingsChanges()
  }

  async function handleProcessQueue() {
    setIsProcessingQueue(true)

    try {
      const response = await webApp.processDueFollowUps({
        preferGmail: gmailConnection?.connected ?? false,
      })
      applyOperationResponse(response, false)
    } catch (error) {
      setNotice({
        tone: 'error',
        message: toErrorMessage(error),
      })
      recordDiagnostic('Process follow-up queue', error)
    } finally {
      setIsProcessingQueue(false)
    }
  }

  async function handleProcessProposalQueue() {
    setIsProcessingProposalQueue(true)

    try {
      const response = await webApp.processDueProposalFollowUps({
        preferGmail: gmailConnection?.connected ?? false,
      })
      applyOperationResponse(response, false)
    } catch (error) {
      setNotice({
        tone: 'error',
        message: toErrorMessage(error),
      })
      recordDiagnostic('Process proposal follow-up queue', error)
    } finally {
      setIsProcessingProposalQueue(false)
    }
  }

  async function handleSendClient(clientId: string) {
    setBusyClientId(clientId)

    try {
      const response = await webApp.sendClientFollowUp(clientId, {
        preferGmail: gmailConnection?.connected ?? false,
      })
      applyOperationResponse(response, false)
    } catch (error) {
      setNotice({
        tone: 'error',
        message: toErrorMessage(error),
      })
      recordDiagnostic('Send client follow-up', error)
    } finally {
      setBusyClientId(null)
    }
  }

  async function handleSendProposal(proposalId: string) {
    setBusyProposalId(proposalId)

    try {
      const response = await webApp.sendProposalFollowUp(proposalId, {
        preferGmail: gmailConnection?.connected ?? false,
      })
      applyOperationResponse(response, false)
    } catch (error) {
      setNotice({
        tone: 'error',
        message: toErrorMessage(error),
      })
      recordDiagnostic('Send proposal follow-up', error)
    } finally {
      setBusyProposalId(null)
    }
  }

  async function handleUpdateProposalStatus(proposal: ProposalRecord, status: ProposalStatus) {
    setBusyProposalId(proposal.id)

    try {
      const response = await webApp.updateProposalStatus(proposal.id, status)
      applyOperationResponse(response, false)
    } catch (error) {
      setNotice({
        tone: 'error',
        message: toErrorMessage(error),
      })
      recordDiagnostic('Update proposal status', error)
    } finally {
      setBusyProposalId(null)
    }
  }

  async function handleDeleteProposal(proposal: ProposalRecord) {
    const shouldDelete = window.confirm(
      `You are about to delete the proposal for ${proposal.clientName}. This action cannot be undone.`,
    )

    if (!shouldDelete) {
      return
    }

    setBusyProposalId(proposal.id)

    try {
      const response = await webApp.deleteProposal(proposal.id)
      applyOperationResponse(response, false)
    } catch (error) {
      setNotice({
        tone: 'error',
        message: toErrorMessage(error),
      })
      recordDiagnostic('Delete proposal', error)
    } finally {
      setBusyProposalId(null)
    }
  }

  async function handleToggleClient(client: ClientRecord) {
    const nextStatus = client.status === 'active' ? 'canceled' : 'active'
    setBusyClientId(client.id)

    try {
      const response = await webApp.updateClientStatus(client.id, nextStatus)
      applyOperationResponse(response, false)
    } catch (error) {
      setNotice({
        tone: 'error',
        message: toErrorMessage(error),
      })
      recordDiagnostic('Toggle client status', error)
    } finally {
      setBusyClientId(null)
    }
  }

  async function handleDeleteClient(client: ClientRecord) {
    const shouldDelete = window.confirm(
      `You are about to delete ${client.name}. This action cannot be undone.`,
    )

    if (!shouldDelete) {
      return
    }

    setBusyClientId(client.id)

    try {
      const response = await webApp.deleteClient(client.id)
      applyOperationResponse(response, false)
    } catch (error) {
      setNotice({
        tone: 'error',
        message: toErrorMessage(error),
      })
      recordDiagnostic('Delete client', error)
    } finally {
      setBusyClientId(null)
    }
  }

  const diagnosticsPanel = (
    <aside className={`diagnostics-panel ${isDiagnosticsOpen ? 'diagnostics-panel-open' : ''}`}>
      <button
        className={`diagnostics-trigger ${diagnostics.length ? 'diagnostics-trigger-alert' : ''}`}
        onClick={() => setIsDiagnosticsOpen((current) => !current)}
        type="button"
      >
        Diagnostics
        {diagnostics.length ? <span>{diagnostics.length}</span> : null}
      </button>

      {isDiagnosticsOpen ? (
        <div className="diagnostics-card">
          <div className="diagnostics-card-header">
            <div>
              <span className="eyebrow">Support report</span>
              <h3>What went wrong?</h3>
            </div>
            <button
              aria-label="Close diagnostics"
              className="diagnostics-close"
              onClick={() => setIsDiagnosticsOpen(false)}
              type="button"
            >
              x
            </button>
          </div>

          <p>
            If something fails, copy this report and send it to support so we can see the exact
            error context.
          </p>

          <div className="diagnostics-actions">
            <button
              className="secondary-button"
              disabled={diagnostics.length === 0}
              onClick={() => void copyDiagnosticsReport()}
              type="button"
            >
              Copy report
            </button>
            <button
              className="ghost-button"
              disabled={diagnostics.length === 0}
              onClick={() => setDiagnostics([])}
              type="button"
            >
              Clear
            </button>
          </div>

          <div className="diagnostics-list">
            {diagnostics.length ? (
              diagnostics.map((entry) => (
                <article className="diagnostics-entry" key={entry.id}>
                  <strong>{entry.context}</strong>
                  <span>{new Date(entry.timestamp).toLocaleString()}</span>
                  <pre>{entry.detail}</pre>
                </article>
              ))
            ) : (
              <div className="diagnostics-empty">No errors captured yet.</div>
            )}
          </div>
        </div>
      ) : null}
    </aside>
  )

  if (authMode === 'reset-password') {
    return (
      <main className="crm-shell recovery-shell">
        {diagnosticsPanel}
        <section className="recovery-layout">
          <article className="panel recovery-brand-card">
            <div className="landing-brand-lockup">
              <img alt="Hessa Enterprises" className="landing-logo" src={logoWordmark} />
              <span className="eyebrow">Secure account recovery</span>
            </div>

            <div className="recovery-copy">
              <span className="brand-caption">Password reset</span>
              <h1>Create a new password for your workspace.</h1>
              <p className="lede">
                This page opens from the secure reset link in your email. Choose a new password
                before continuing to your client follow-up workspace.
              </p>
            </div>

            <div className="recovery-card-list" aria-label="Recovery safeguards">
              <div>
                <strong>Private reset session</strong>
                <span>Supabase verifies the reset link before accepting a new password.</span>
              </div>
              <div>
                <strong>Minimum 8 characters</strong>
                <span>Use a password that is unique to this account.</span>
              </div>
            </div>
          </article>

          <article className="panel auth-card recovery-auth-card">
            <div className="auth-card-header">
              <span className="eyebrow">New password</span>
              <h2>{getAuthTitle(authMode)}</h2>
              <p>{getAuthDescription(authMode)}</p>
            </div>

            {notice ? <div className={`notice notice-${notice.tone}`}>{notice.message}</div> : null}

            <form className="stack-form" onSubmit={handleAuthSubmit}>
              <label className="field">
                <span>New password</span>
                <input
                  autoComplete="new-password"
                  minLength={8}
                  onChange={(event) =>
                    setAuthForm((current) => ({ ...current, password: event.target.value }))
                  }
                  placeholder="Minimum 8 characters"
                  required
                  type="password"
                  value={authForm.password}
                />
              </label>

              <button
                className="primary-button full-width"
                disabled={isAuthenticating}
                type="submit"
              >
                {getAuthSubmitLabel(authMode, isAuthenticating)}
              </button>
            </form>

            <button
              className="auth-link-button"
              onClick={() => void handleRecoveryExit()}
              type="button"
            >
              Back to log in
            </button>

            <p className="recovery-security-note">
              If this link was opened by mistake, go back to log in and request a new reset email
              when needed.
            </p>
          </article>
        </section>
      </main>
    )
  }

  if (!session) {
    return (
      <main className="crm-shell landing-shell">
        {diagnosticsPanel}
        <section className="landing-hero-grid">
          <article className="panel landing-hero-panel">
            <div className="landing-hero-top">
              <div className="landing-brand-lockup">
                <img alt="Hessa Enterprises" className="landing-logo" src={logoWordmark} />
                <span className="eyebrow">Client follow-up workspace</span>
              </div>
              <span className="stage-chip">Premium SaaS CRM</span>
            </div>

            <div className="landing-hero-copy">
              <span className="brand-caption">Built for service businesses and sales teams</span>
              <h1>Keep every client, appointment, and proposal moving forward.</h1>
              <p className="lede">
                Manage email follow-ups, appointment reminders, and proposal tracking from one clean
                workspace. Each user gets their own account to organize clients, schedule next steps,
                and never lose sight of an opportunity.
              </p>
            </div>

            <div className="landing-hero-actions">
              <button
                className="primary-button"
                onClick={() => handleLandingAuthCta('register')}
                type="button"
              >
                Create your workspace
              </button>
              <button
                className="secondary-button"
                onClick={() => handleLandingAuthCta('login')}
                type="button"
              >
                Log in
              </button>
            </div>

            <div className="landing-audience-strip">
              <span>Contractors</span>
              <span>Home services</span>
              <span>Consultants</span>
              <span>Sales teams</span>
            </div>
          </article>

          <article className="panel dashboard-preview-card" aria-label="Dashboard preview">
            <div className="preview-topbar">
              <div>
                <span className="eyebrow">Workspace pulse</span>
                <h2>Today&apos;s follow-up board</h2>
              </div>
              <span className="stage-chip">Live pipeline</span>
            </div>

            <div className="preview-metric-grid">
              {dashboardMetrics.map((metric) => (
                <div className="preview-metric-card" key={metric.label}>
                  <strong>{metric.value}</strong>
                  <span>{metric.label}</span>
                </div>
              ))}
            </div>

            <div className="preview-board">
              <div className="preview-board-header">
                <span>Opportunity queue</span>
                <strong>Next steps</strong>
              </div>

              <div className="preview-row">
                <div>
                  <strong>Acme Roofing</strong>
                  <span>Estimate follow-up email due at 9:00 AM</span>
                </div>
                <span className="preview-pill">Email ready</span>
              </div>

              <div className="preview-row">
                <div>
                  <strong>Northside Remodel</strong>
                  <span>Appointment reminder before site walkthrough</span>
                </div>
                <span className="preview-pill preview-pill-gold">Appointment</span>
              </div>

              <div className="preview-row">
                <div>
                  <strong>Valley HVAC</strong>
                  <span>Proposal waiting on client decision</span>
                </div>
                <span className="preview-pill preview-pill-soft">Proposal</span>
              </div>
            </div>

            <div className="proposal-status-panel">
              <span className="preview-label">Proposal status badges</span>
              <div className="proposal-status-list">
                {proposalStatuses.map((status) => (
                  <span
                    className={`proposal-status proposal-status-${status.toLowerCase()}`}
                    key={status}
                  >
                    {status}
                  </span>
                ))}
              </div>
            </div>
          </article>
        </section>

        <section className="landing-content-grid">
          <div className="landing-main-flow">
            <section className="landing-section">
              <div className="landing-section-heading">
                <span className="eyebrow">What you can manage</span>
                <h2>A cleaner operating rhythm for every client relationship.</h2>
                <p>
                  Replace scattered reminders, forgotten proposal threads, and manual inbox hunting
                  with one focused workspace for client follow-up.
                </p>
              </div>

              <div className="landing-feature-grid">
                {landingFeatures.map((feature) => (
                  <article className="home-feature-item landing-feature-card" key={feature.title}>
                    <img alt="" aria-hidden="true" className="feature-card-mark" src={feature.icon} />
                    <strong>{feature.title}</strong>
                    <span>{feature.description}</span>
                  </article>
                ))}
              </div>
            </section>

            <section className="panel how-it-works-panel">
              <div className="landing-section-heading">
                <span className="eyebrow">How it works</span>
                <h2>Move from new lead to closed opportunity without losing the thread.</h2>
              </div>

              <div className="how-step-grid">
                {howItWorksSteps.map((step, index) => (
                  <article className="how-step-card" key={step.title}>
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <strong>{step.title}</strong>
                    <p>{step.description}</p>
                  </article>
                ))}
              </div>
            </section>

            <section className="panel investment-panel">
              <div className="investment-copy">
                <span className="eyebrow">Why invest in this platform?</span>
                <h2>Missed follow-ups and forgotten proposals can become lost revenue.</h2>
                <p>
                  Every unanswered proposal, late appointment reminder, and buried client note adds
                  friction to the sale. Hessa gives teams a calm command center for the next action,
                  so opportunities keep progressing instead of quietly slipping away.
                </p>
              </div>

              <div className="investment-points">
                <div>
                  <strong>Protect revenue</strong>
                  <span>Keep high-value prospects from going cold after the first conversation.</span>
                </div>
                <div>
                  <strong>Build trust</strong>
                  <span>Show up on time with reminders, context, and consistent communication.</span>
                </div>
                <div>
                  <strong>Stay focused</strong>
                  <span>Know exactly which client, proposal, or appointment needs attention today.</span>
                </div>
              </div>
            </section>

            <section className="panel landing-pricing-panel">
              <div className="landing-section-heading">
                <span className="eyebrow">Plans</span>
                <h2>Flexible plans are coming soon.</h2>
                <p>
                  Pricing is not active yet. Hessa is being prepared for monthly plans so each
                  business can grow from a simple workspace into a full follow-up operating system.
                </p>
              </div>

              <div className="landing-plan-grid">
                {landingPlanCards.map((plan) => (
                  <article className="landing-plan-card" key={plan.plan}>
                    <div>
                      <span className="stage-chip">Coming soon</span>
                      <h3>{plan.title}</h3>
                      <p>{plan.description}</p>
                    </div>

                    <strong>Pricing to be announced</strong>

                    <ul>
                      {plan.features.map((feature) => (
                        <li key={feature}>{feature}</li>
                      ))}
                    </ul>
                  </article>
                ))}
              </div>
            </section>
          </div>

          <article className="panel auth-card landing-auth-card" id="account-access">
            <div className="auth-card-header">
              <span className="eyebrow">Account access</span>
              <h2>{getAuthTitle(authMode)}</h2>
              <p>{getAuthDescription(authMode)}</p>
            </div>

            <div className="auth-toggle">
              <button
                className={`auth-toggle-button ${authMode === 'login' || authMode === 'forgot-password' ? 'auth-toggle-button-active' : ''}`}
                onClick={() => setAuthMode('login')}
                type="button"
              >
                Log in
              </button>
              <button
                className={`auth-toggle-button ${authMode === 'register' ? 'auth-toggle-button-active' : ''}`}
                onClick={() => setAuthMode('register')}
                type="button"
              >
                Register
              </button>
            </div>

            {notice ? <div className={`notice notice-${notice.tone}`}>{notice.message}</div> : null}

            {authMode === 'login' || authMode === 'register' ? (
              <>
                <div className="google-auth-section">
                  <button
                    className="google-auth-action"
                    disabled={isGoogleAuthenticating}
                    onClick={() => void handleGoogleAuth()}
                    type="button"
                  >
                    {isGoogleAuthenticating ? 'Redirecting to Google...' : 'Continue with Google'}
                  </button>

                  <p className="google-auth-hint">
                    Google sign-in is handled securely by Supabase Auth.
                  </p>
                </div>

                <div className="auth-divider">
                  <span>or continue with email</span>
                </div>
              </>
            ) : null}

            <form className="stack-form" onSubmit={handleAuthSubmit}>
              {authMode === 'register' ? (
                <label className="field">
                  <span>Full name</span>
                  <input
                    onChange={(event) =>
                      setAuthForm((current) => ({ ...current, name: event.target.value }))
                    }
                    placeholder="Your name"
                    required
                    type="text"
                    value={authForm.name}
                  />
                </label>
              ) : null}

              <label className="field">
                <span>Email address</span>
                <input
                  onChange={(event) =>
                    setAuthForm((current) => ({ ...current, email: event.target.value }))
                  }
                  placeholder="you@company.com"
                  required
                  type="email"
                  value={authForm.email}
                />
              </label>

              {authMode === 'forgot-password' ? null : (
                <label className="field">
                  <span>Password</span>
                  <input
                    minLength={8}
                    onChange={(event) =>
                      setAuthForm((current) => ({ ...current, password: event.target.value }))
                    }
                    placeholder="Minimum 8 characters"
                    required
                    type="password"
                    value={authForm.password}
                  />
                </label>
              )}

              {authMode === 'login' ? (
                <button
                  className="auth-link-button"
                  onClick={() => setAuthMode('forgot-password')}
                  type="button"
                >
                  Forgot your password?
                </button>
              ) : null}

              {authMode === 'forgot-password' ? (
                <button
                  className="auth-link-button"
                  onClick={() => setAuthMode('login')}
                  type="button"
                >
                  Back to log in
                </button>
              ) : null}

              <button
                className="primary-button full-width"
                disabled={isAuthenticating}
                type="submit"
              >
                {getAuthSubmitLabel(authMode, isAuthenticating)}
              </button>
            </form>
          </article>
        </section>
      </main>
    )
  }

  if (loading || !appState || !settingsForm) {
    return (
      <main className="crm-shell">
        {diagnosticsPanel}
        <section className="loading-stage panel">
          <img alt="Hessa Enterprises" className="loading-wordmark" src={logoWordmark} />
          <div className="loading-copy">
            <span className="eyebrow">Hessa Follow Up</span>
            <h1>Loading your workspace...</h1>
            <p>Preparing appointments, proposals, schedules, and email templates.</p>
          </div>
        </section>
      </main>
    )
  }

  const activeClients = appState.clients.filter((client) => client.status === 'active')
  const sortedActiveClients = [...activeClients].sort((first, second) =>
    compareNullableDates(first.nextContactAt, second.nextContactAt),
  )
  const dueTodayClients = sortedActiveClients.filter((client) => isDueToday(client.nextContactAt))
  const overdueClients = sortedActiveClients.filter((client) => isOverdue(client.nextContactAt))
  const openProposals = appState.proposals.filter(isOpenProposal)
  const activeWorkflowCount = activeClients.length + openProposals.length
  const finishedProposals = appState.proposals.filter((proposal) => proposal.status === 'finished')
  const pausedProposals = appState.proposals.filter((proposal) => proposal.status === 'canceled')
  const sortedOpenProposals = [...openProposals].sort((first, second) =>
    compareNullableDates(first.nextFollowUpAt, second.nextFollowUpAt),
  )
  const dueTodayProposals = sortedOpenProposals.filter((proposal) =>
    isDueToday(proposal.nextFollowUpAt),
  )
  const overdueProposals = sortedOpenProposals.filter((proposal) =>
    isOverdue(proposal.nextFollowUpAt),
  )
  const dueProposalFollowUps = sortedOpenProposals.filter(isProposalFollowUpDue)
  const searchQuery = dashboardSearch.trim().toLowerCase()
  const filteredDirectoryClients = appState.clients.filter((client) => {
    if (!searchQuery) {
      return true
    }

    return [client.name, client.company, client.email, client.notes, client.status]
      .join(' ')
      .toLowerCase()
      .includes(searchQuery)
  })
  const filteredProposals = appState.proposals.filter((proposal) => {
    if (!searchQuery) {
      return true
    }

    return [
      proposal.clientName,
      proposal.company,
      proposal.email,
      proposal.notes,
      proposal.status,
    ]
      .join(' ')
      .toLowerCase()
      .includes(searchQuery)
  })
  const trackingRecords: TrackingRecord[] = [
    ...appState.clients.map((client) => ({
      company: client.company,
      email: client.email,
      id: `appointment-${client.id}`,
      lastEmailAt: client.lastContactAt,
      name: client.name,
      nextEmailAt: client.nextContactAt,
      notes: client.notes,
      sentCount: client.sentContacts,
      status: client.status,
      targetCount: client.targetContacts,
      type: 'Appointment' as const,
    })),
    ...appState.proposals.map((proposal) => ({
      company: proposal.company,
      email: proposal.email,
      id: `proposal-${proposal.id}`,
      lastEmailAt: proposal.lastFollowUpAt,
      name: proposal.clientName,
      nextEmailAt: proposal.nextFollowUpAt,
      notes: proposal.notes,
      sentCount: proposal.sentFollowUps,
      status: proposal.status,
      targetCount: proposal.targetFollowUps,
      type: 'Proposal' as const,
    })),
  ].sort((first, second) => compareNullableDates(first.nextEmailAt, second.nextEmailAt))
  const filteredTrackingRecords = trackingRecords.filter((record) => {
    if (!searchQuery) {
      return true
    }

    return [
      record.company,
      record.email,
      record.name,
      record.notes,
      record.status,
      record.type,
      `${record.sentCount}/${record.targetCount}`,
    ]
      .join(' ')
      .toLowerCase()
      .includes(searchQuery)
  })
  const totalEmailsSent =
    appState.clients.reduce((total, client) => total + client.sentContacts, 0) +
    appState.proposals.reduce((total, proposal) => total + proposal.sentFollowUps, 0)
  const overviewCards = [
    {
      count: appState.clients.length,
      label: 'Appointments',
      value: `${dueTodayClients.length + overdueClients.length} need email today`,
    },
    {
      count: appState.proposals.length,
      label: 'Proposals',
      tone: 'warning',
      value: `${dueProposalFollowUps.length} proposal follow-ups due`,
    },
    {
      count: totalEmailsSent,
      label: 'Emails sent',
      tone: 'success',
      value: 'Appointments and proposals combined',
    },
    {
      count: gmailConnection?.connected ? 'On' : 'Drafts',
      label: 'Gmail sending',
      tone: gmailConnection?.connected ? 'success' : 'info',
      value: gmailConnection?.connected ? gmailConnection.email || 'Connected' : 'Not connected',
    },
  ]
  const activeAppointmentTemplateIndex = Math.min(
    appointmentTemplateChoice,
    Math.max(0, settingsForm.templates.length - 1),
  )
  const activeProposalTemplateIndex = Math.min(
    proposalTemplateChoice,
    Math.max(0, settingsForm.proposalTemplates.length - 1),
  )
  const activeTemplate =
    templateEditor?.workflow === 'appointment'
      ? settingsForm.templates[templateEditor.index]
      : templateEditor?.workflow === 'proposal'
        ? settingsForm.proposalTemplates[templateEditor.index]
        : null
  const activeTemplateTitle =
    templateEditor?.workflow === 'appointment'
      ? `Appointment touchpoint ${templateEditor.index + 1}`
      : templateEditor?.workflow === 'proposal'
        ? `Proposal follow-up ${templateEditor.index + 1}`
        : ''
  const recentActivityFromClients: DashboardActivityItem[] = [
    ...appState.clients.flatMap((client) =>
      client.history.map((item) => ({
        description: item.error || `${client.name} · ${item.subject}`,
        id: item.id,
        timestamp: item.happenedAt,
        title: item.status === 'prepared' ? 'Draft opened' : 'Draft error',
        tone: item.status === 'prepared' ? ('success' as const) : ('danger' as const),
      })),
    ),
    ...appState.proposals.flatMap((proposal) =>
      proposal.history.map((item) => ({
        description: item.error || `${proposal.clientName} · ${item.subject}`,
        id: item.id,
        timestamp: item.happenedAt,
        title: item.status === 'prepared' ? 'Proposal follow-up sent' : 'Proposal follow-up error',
        tone: item.status === 'prepared' ? ('success' as const) : ('danger' as const),
      })),
    ),
  ]
    .sort((first, second) => {
      const firstTime = first.timestamp ? new Date(first.timestamp).getTime() : 0
      const secondTime = second.timestamp ? new Date(second.timestamp).getTime() : 0
      return secondTime - firstTime
    })
    .slice(0, 5)
  const activityItems = recentActivityFromClients
  const kpiCards = [
    {
      helper: 'Scheduled for today',
      label: 'Appointment emails due',
      value: String(dueTodayClients.length),
    },
    {
      helper: 'Need attention before they go cold',
      label: 'Overdue appointments',
      tone: 'danger',
      value: String(overdueClients.length),
    },
    {
      helper: `${dueProposalFollowUps.length} proposal follow-ups due now`,
      label: 'Active proposal follow-ups',
      value: String(openProposals.length),
    },
    {
      helper: 'Proposal emails ready to send today',
      label: 'Proposal emails due',
      tone: 'accent',
      value: String(dueTodayProposals.length + overdueProposals.length),
    },
  ]
  const proposalPipeline = [
    {
      count: openProposals.length,
      label: 'Active',
      value: 'Proposal follow-ups in progress',
    },
    {
      count: dueProposalFollowUps.length,
      label: 'Due now',
      tone: 'warning',
      value: 'Ready for the next email',
    },
    {
      count: finishedProposals.length,
      label: 'Completed',
      tone: 'success',
      value: 'Sequence completed',
    },
    {
      count: pausedProposals.length,
      label: 'Paused',
      tone: 'danger',
      value: 'Stopped manually',
    },
  ]

  if (isAdminRoute) {
    const canAccessAdmin = appState.currentUser.role === 'super_admin'
    const adminUsers =
      adminState?.accounts
        .flatMap((account) =>
          account.users.map((user) => ({
            ...user,
            accountName: account.name,
            accountPlan: account.plan,
            accountStatus: account.status,
          })),
        )
        .sort((firstUser, secondUser) => firstUser.email.localeCompare(secondUser.email)) ?? []
    const adminPlanPricing = adminState?.planPricing ?? []

    return (
      <main className="dashboard-shell super-admin-shell">
        {diagnosticsPanel}

        <aside className="dashboard-sidebar">
          <div className="sidebar-brand">
            <img alt="Hessa Enterprises" src={logoWordmark} />
            <div>
              <span className="eyebrow">Platform owner</span>
              <strong>Super Admin</strong>
            </div>
          </div>

          <nav className="sidebar-nav" aria-label="Admin navigation">
            <button
              className="sidebar-nav-item sidebar-nav-item-active"
              onClick={() => document.getElementById('admin-accounts')?.scrollIntoView({ behavior: 'smooth' })}
              type="button"
            >
              <span>Accounts</span>
            </button>
            <button
              className="sidebar-nav-item"
              onClick={() => document.getElementById('admin-users')?.scrollIntoView({ behavior: 'smooth' })}
              type="button"
            >
              <span>Users</span>
            </button>
            <button
              className="sidebar-nav-item"
              onClick={() => document.getElementById('admin-pricing')?.scrollIntoView({ behavior: 'smooth' })}
              type="button"
            >
              <span>Pricing</span>
            </button>
            <button
              className="sidebar-nav-item"
              onClick={() => openDashboardPage('dashboard')}
              type="button"
            >
              <span>Workspace</span>
            </button>
          </nav>

          <div className="sidebar-summary">
            <span>Admin role</span>
            <strong>{appState.currentUser.role}</strong>
            <small>{appState.currentUser.email}</small>
          </div>
        </aside>

        <div className="dashboard-workspace">
          <header className="dashboard-topbar">
            <div className="dashboard-search admin-route-pill">
              <span>Route</span>
              <strong>/admin</strong>
            </div>

            <button
              className="secondary-button dashboard-new-client"
              onClick={() => openDashboardPage('dashboard')}
              type="button"
            >
              Back to workspace
            </button>

            <button className="ghost-button dashboard-logout" onClick={() => void handleLogout()} type="button">
              Logout
            </button>
          </header>

          {notice ? <div className={`notice notice-${notice.tone}`}>{notice.message}</div> : null}

          {!canAccessAdmin ? (
            <section className="dashboard-card">
              <span className="eyebrow">Access denied</span>
              <h1>Only super admins can open the master panel.</h1>
              <p className="dashboard-card-copy">
                Your current role is {appState.currentUser.role}. Normal users can only access their
                own account workspace.
              </p>
            </section>
          ) : (
            <>
              <section className="dashboard-overview">
                <div className="dashboard-heading">
                  <div>
                    <span className="eyebrow">SaaS control layer</span>
                    <h1>Master admin panel</h1>
                    <p>
                      Manage accounts, users, subscription readiness, and account access before
                      payments are connected.
                    </p>
                  </div>
                  <span className="demo-data-badge live-data-badge">Payments disabled</span>
                </div>

                <div className="dashboard-overview-grid">
                  {[
                    ['Accounts', adminState?.metrics.totalAccounts ?? 0],
                    ['Users', adminState?.metrics.totalUsers ?? 0],
                    ['Active accounts', adminState?.metrics.activeAccounts ?? 0],
                    ['Suspended', adminState?.metrics.suspendedAccounts ?? 0],
                  ].map(([label, value]) => (
                    <article className="pipeline-stage" key={label}>
                      <span>{label}</span>
                      <strong>{value}</strong>
                      <small>Platform metric</small>
                    </article>
                  ))}
                </div>
              </section>

              <section className="dashboard-card" id="admin-pricing">
                <div className="dashboard-card-header">
                  <div>
                    <span className="eyebrow">Billing readiness</span>
                    <h2>Plan pricing and discounts</h2>
                    <p className="dashboard-card-copy">
                      Prepare future prices and discounts here. Payments stay disabled until a
                      billing provider is connected.
                    </p>
                  </div>
                  <span className="demo-data-badge live-data-badge">Coming soon</span>
                </div>

                <div className="admin-pricing-grid">
                  {adminPlanPricing.map((pricing) => {
                    const draft = planPricingDrafts[pricing.plan] ?? createPlanPricingDraft(pricing)

                    return (
                      <article className="admin-pricing-card" key={pricing.plan}>
                        <div className="admin-pricing-card-head">
                          <div>
                            <span className="stage-chip">{pricing.isComingSoon ? 'Coming soon' : 'Ready'}</span>
                            <h3>{pricing.plan}</h3>
                          </div>
                          <label className="admin-toggle-row">
                            <input
                              checked={draft.isComingSoon}
                              onChange={(event) =>
                                updatePlanPricingDraft(pricing.plan, {
                                  isComingSoon: event.target.checked,
                                })
                              }
                              type="checkbox"
                            />
                            <span>Show as coming soon</span>
                          </label>
                        </div>

                        <div className="admin-pricing-fields">
                          <label className="field">
                            <span>Currency</span>
                            <input
                              className="text-input"
                              maxLength={3}
                              onChange={(event) =>
                                updatePlanPricingDraft(pricing.plan, {
                                  currency: event.target.value,
                                })
                              }
                              placeholder="USD"
                              value={draft.currency}
                            />
                          </label>

                          <label className="field">
                            <span>Monthly price</span>
                            <input
                              className="text-input"
                              min="0"
                              onChange={(event) =>
                                updatePlanPricingDraft(pricing.plan, {
                                  monthlyPrice: event.target.value,
                                })
                              }
                              placeholder="0.00"
                              step="0.01"
                              type="number"
                              value={draft.monthlyPrice}
                            />
                          </label>

                          <label className="field">
                            <span>Annual price</span>
                            <input
                              className="text-input"
                              min="0"
                              onChange={(event) =>
                                updatePlanPricingDraft(pricing.plan, {
                                  annualPrice: event.target.value,
                                })
                              }
                              placeholder="0.00"
                              step="0.01"
                              type="number"
                              value={draft.annualPrice}
                            />
                          </label>

                          <label className="field">
                            <span>Discount %</span>
                            <input
                              className="text-input"
                              max="100"
                              min="0"
                              onChange={(event) =>
                                updatePlanPricingDraft(pricing.plan, {
                                  discountPercent: event.target.value,
                                })
                              }
                              placeholder="0"
                              type="number"
                              value={draft.discountPercent}
                            />
                          </label>
                        </div>

                        <button
                          className="secondary-button full-width"
                          disabled={busyPlanPricingId === pricing.plan}
                          onClick={() => void handlePlanPricingSave(pricing.plan)}
                          type="button"
                        >
                          {busyPlanPricingId === pricing.plan ? 'Saving...' : 'Save plan pricing'}
                        </button>
                      </article>
                    )
                  })}
                </div>
              </section>

              <section className="dashboard-card" id="admin-users">
                <div className="dashboard-card-header">
                  <div>
                    <span className="eyebrow">Users</span>
                    <h2>All registered users</h2>
                    <p className="dashboard-card-copy">
                      Every user known to the SaaS account system appears here with account, role,
                      plan, and account status.
                    </p>
                  </div>
                  <span className="demo-data-badge live-data-badge">{adminUsers.length} users</span>
                </div>

                {adminUsers.length ? (
                  <div className="admin-all-users-list">
                    {adminUsers.map((user) => (
                      <article className="admin-all-user-row" key={`${user.accountId}-${user.userId}`}>
                        <span>{getInitials(user.name || user.email)}</span>
                        <div>
                          <strong>{user.name || user.email}</strong>
                          <small>{user.email}</small>
                        </div>
                        <div>
                          <strong>{user.accountName}</strong>
                          <small>{user.accountId}</small>
                        </div>
                        <em>{user.role}</em>
                        <em>{user.accountPlan}</em>
                        <em>{user.accountStatus}</em>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="dashboard-empty-state">
                    <h3>No users registered yet</h3>
                    <p>Users will appear here after they sign up or log in.</p>
                  </div>
                )}
              </section>

              <section className="dashboard-card" id="admin-accounts">
                <div className="dashboard-card-header">
                  <div>
                    <span className="eyebrow">Accounts</span>
                    <h2>Registered workspaces</h2>
                  </div>
                  <button
                    className="secondary-button compact-action"
                    disabled={isLoadingAdmin}
                    onClick={() => void refreshAdminState()}
                    type="button"
                  >
                    {isLoadingAdmin ? 'Refreshing...' : 'Refresh'}
                  </button>
                </div>

                {isLoadingAdmin && !adminState ? (
                  <div className="dashboard-empty-state">
                    <h3>Loading accounts...</h3>
                    <p>Preparing platform metrics.</p>
                  </div>
                ) : adminState?.accounts.length ? (
                  <div className="admin-account-list">
                    {adminState.accounts.map((account) => (
                      <article className="admin-account-card" key={account.id}>
                        <div className="admin-account-head">
                          <div>
                            <span className={`status-pill pill-${account.status === 'active' ? 'active' : 'canceled'}`}>
                              {account.status}
                            </span>
                            <h3>{account.name}</h3>
                            <p>{account.id}</p>
                          </div>
                          <div className="admin-account-controls">
                            <label className="field">
                              <span>Plan</span>
                              <select
                                className="select-input"
                                disabled={busyAdminAccountId === account.id}
                                onChange={(event) =>
                                  void handleAdminPlanChange(
                                    account.id,
                                    event.target.value as AccountPlan,
                                  )
                                }
                                value={account.plan}
                              >
                                {accountPlanOptions.map((plan) => (
                                  <option key={plan} value={plan}>
                                    {plan}
                                  </option>
                                ))}
                              </select>
                            </label>

                            <label className="field">
                              <span>Status</span>
                              <select
                                className="select-input"
                                disabled={busyAdminAccountId === account.id}
                                onChange={(event) =>
                                  void handleAdminStatusChange(
                                    account.id,
                                    event.target.value as AccountStatus,
                                  )
                                }
                                value={account.status}
                              >
                                {accountStatusOptions.map((status) => (
                                  <option key={status} value={status}>
                                    {status}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>
                        </div>

                        <div className="admin-account-metrics">
                          <div>
                            <span>Subscription</span>
                            <strong>{account.subscriptionStatus}</strong>
                          </div>
                          <div>
                            <span>Appointments</span>
                            <strong>{account.appointmentCount}</strong>
                          </div>
                          <div>
                            <span>Proposals</span>
                            <strong>{account.proposalCount}</strong>
                          </div>
                          <div>
                            <span>Emails sent</span>
                            <strong>{account.emailCount}</strong>
                          </div>
                        </div>

                        <div className="admin-user-list">
                          {account.users.map((user) => (
                            <div className="admin-user-row" key={user.userId}>
                              <span>{getInitials(user.name || user.email)}</span>
                              <div>
                                <strong>{user.name || user.email}</strong>
                                <small>{user.email}</small>
                              </div>
                              <em>{user.role}</em>
                            </div>
                          ))}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="dashboard-empty-state">
                    <h3>No accounts registered yet</h3>
                    <p>Accounts will appear here as users sign up or log in.</p>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </main>
    )
  }

  return (
    <main className="dashboard-shell">
      {diagnosticsPanel}

      <aside className="dashboard-sidebar">
        <div className="sidebar-brand">
          <img alt="Hessa Enterprises" src={logoWordmark} />
          <div>
            <span className="eyebrow">CRM workspace</span>
            <strong>Hessa Follow Up</strong>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Workspace navigation">
          {dashboardNavItems.map((item) => (
            <button
              className={
                item.href === activeDashboardPage
                  ? 'sidebar-nav-item sidebar-nav-item-active'
                  : 'sidebar-nav-item'
              }
              key={item.href}
              onClick={() => openDashboardPage(item.href)}
              type="button"
            >
              <span>{item.label}</span>
            </button>
          ))}
          {appState.currentUser.role === 'super_admin' ? (
            <button className="sidebar-nav-item" onClick={openAdminPanel} type="button">
              <span>Super Admin</span>
            </button>
          ) : null}
        </nav>

        <div className="sidebar-summary">
          <span>Workspace health</span>
          <strong>{activeWorkflowCount} active</strong>
          <small>
            {`${appState.clients.length} appointments and ${appState.proposals.length} proposals tracked.`}
          </small>
        </div>
      </aside>

      <div className="dashboard-workspace">
        <header className="dashboard-topbar">
          <label className="dashboard-search">
            <span>Search</span>
            <input
              onChange={(event) => setDashboardSearch(event.target.value)}
              placeholder="Search appointments, proposals, tracking..."
              type="search"
              value={dashboardSearch}
            />
          </label>

          <button
            className="primary-button dashboard-new-client"
            onClick={() => scrollToDashboardSection('new-client')}
            type="button"
          >
            New Appointment
          </button>

          <div className="dashboard-user-card">
            <span>{getInitials(appState.currentUser.name || appState.currentUser.email)}</span>
            <div>
              <strong>{appState.currentUser.name}</strong>
              <small>{appState.currentUser.email}</small>
            </div>
          </div>

          <button className="ghost-button dashboard-logout" onClick={() => void handleLogout()} type="button">
            Logout
          </button>
        </header>

        {notice ? <div className={`notice notice-${notice.tone}`}>{notice.message}</div> : null}

        {activeTemplate && templateEditor ? (
          <div className="template-modal-backdrop" role="presentation">
            <section
              aria-labelledby="template-modal-title"
              aria-modal="true"
              className="template-modal"
              role="dialog"
            >
              <div className="template-modal-header">
                <div>
                  <span className="eyebrow">
                    {templateEditor.workflow === 'appointment'
                      ? 'Appointment follow-up'
                      : 'Proposal follow-up'}
                  </span>
                  <h2 id="template-modal-title">{activeTemplateTitle}</h2>
                </div>
                <button
                  aria-label="Close template editor"
                  className="diagnostics-close"
                  onClick={() => setTemplateEditor(null)}
                  type="button"
                >
                  ×
                </button>
              </div>

              <div className="template-modal-body">
                <label className="field">
                  <span>Subject line</span>
                  <input
                    onChange={(event) =>
                      updateTemplateDraft(
                        templateEditor.workflow,
                        templateEditor.index,
                        'subject',
                        event.target.value,
                      )
                    }
                    type="text"
                    value={activeTemplate.subject}
                  />
                </label>

                <label className="field">
                  <span>Body</span>
                  <textarea
                    onChange={(event) =>
                      updateTemplateDraft(
                        templateEditor.workflow,
                        templateEditor.index,
                        'body',
                        event.target.value,
                      )
                    }
                    rows={12}
                    value={activeTemplate.body}
                  />
                </label>
              </div>

              <div className="token-rack template-modal-tokens">
                {templateTokens.map((token) => (
                  <code key={token}>{token}</code>
                ))}
              </div>

              <div className="template-modal-actions">
                <button
                  className="ghost-button"
                  onClick={() => setTemplateEditor(null)}
                  type="button"
                >
                  Close
                </button>
                <button
                  className="primary-button"
                  disabled={isSavingSettings}
                  onClick={() => void handleSaveTemplateModal()}
                  type="button"
                >
                  {isSavingSettings ? 'Saving...' : 'Save template'}
                </button>
              </div>
            </section>
          </div>
        ) : null}

        <section
          className="dashboard-overview"
          hidden={activeDashboardPage !== 'dashboard'}
          id="dashboard"
        >
          <div className="dashboard-heading">
            <div>
              <span className="eyebrow">Hessa Enterprises</span>
              <h1>Workspace dashboard</h1>
              <p>
                See appointment follow-ups, proposal follow-ups, sent email counts, and Gmail
                sending health from one focused workspace.
              </p>
            </div>

            <span className="demo-data-badge live-data-badge">Live workspace data</span>
          </div>

          <div className="dashboard-kpi-grid">
            {kpiCards.map((card) => (
              <article className={`dashboard-kpi-card ${card.tone ? `dashboard-kpi-${card.tone}` : ''}`} key={card.label}>
                <span>{card.label}</span>
                <strong>{card.value}</strong>
                <small>{card.helper}</small>
              </article>
            ))}
          </div>

          <div className="dashboard-overview-grid">
            {overviewCards.map((card) => (
              <article className={`pipeline-stage pipeline-${card.tone || 'info'}`} key={card.label}>
                <span>{card.label}</span>
                <strong>{card.count}</strong>
                <small>{card.value}</small>
              </article>
            ))}
          </div>
        </section>

        <section
          className="dashboard-primary-grid dashboard-single-grid"
          hidden={activeDashboardPage !== 'dashboard'}
        >
          <div className="dashboard-side-stack">
            <article className="dashboard-card">
              <div className="dashboard-card-header">
                <div>
                  <span className="eyebrow">Pipeline</span>
                  <h2>Proposal overview</h2>
                </div>
              </div>

              <div className="pipeline-stage-list">
                {proposalPipeline.map((stage) => (
                  <div className={`pipeline-stage pipeline-${stage.tone || 'info'}`} key={stage.label}>
                    <span>{stage.label}</span>
                    <strong>{stage.count}</strong>
                    <small>{stage.value}</small>
                  </div>
                ))}
              </div>

              <button
                className="secondary-button full-width"
                disabled={isProcessingProposalQueue || appState.proposals.length === 0}
                onClick={() => void handleProcessProposalQueue()}
                type="button"
              >
                {isProcessingProposalQueue
                  ? gmailConnection?.connected
                    ? 'Sending proposal follow-up...'
                    : 'Opening proposal draft...'
                  : gmailConnection?.connected
                    ? 'Send next proposal email'
                    : 'Open next proposal draft'}
              </button>
            </article>

            <article className="dashboard-card">
              <div className="dashboard-card-header">
                <div>
                  <span className="eyebrow">Activity</span>
                  <h2>Recent activity</h2>
                </div>
              </div>

              {activityItems.length === 0 ? (
                <div className="dashboard-empty-state">
                  <h3>No recent activity yet</h3>
                  <p>Activity will appear here after appointment or proposal emails are sent.</p>
                </div>
              ) : (
                <div className="activity-feed">
                  {activityItems.map((item) => (
                    <div className={`activity-item activity-${item.tone}`} key={item.id}>
                      <span></span>
                      <div>
                        <strong>{item.title}</strong>
                        <p>{item.description}</p>
                        <small>{formatDateTime(item.timestamp)}</small>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </article>
          </div>
        </section>

        <section
          className="dashboard-card followup-dashboard-card"
          hidden={activeDashboardPage !== 'tracking'}
          id="tracking"
        >
          <div className="dashboard-card-header">
            <div>
              <span className="eyebrow">Tracking</span>
              <h2>Email tracking</h2>
            </div>
            <span className="section-count">{filteredTrackingRecords.length}</span>
          </div>

          <p className="dashboard-card-copy">
            See every appointment and proposal follow-up sequence in one place, including how many
            emails have already been sent and what is scheduled next.
          </p>

          {filteredTrackingRecords.length === 0 ? (
            <div className="dashboard-empty-state">
              <h3>No tracking records yet</h3>
              <p>Create an appointment or proposal follow-up to start tracking sent emails.</p>
            </div>
          ) : (
            <div className="followup-card-list">
              {filteredTrackingRecords.map((record) => (
                <article className="followup-client-card" key={record.id}>
                  <div className="followup-client-top">
                    <div>
                      <div className="identity-row">
                        <span className={`status-pill pill-${record.status}`}>
                          {getClientStatusLabel(record.status)}
                        </span>
                        <span className="meta-pill">{record.type}</span>
                      </div>
                      <h3>{record.name}</h3>
                      <p>
                        {record.company || 'No company'} · {record.email}
                      </p>
                    </div>
                    <strong className="proposal-value">
                      {record.sentCount}/{record.targetCount}
                    </strong>
                  </div>

                  <div className="followup-detail-grid tracking-detail-grid">
                    <div>
                      <span>Workflow</span>
                      <strong>{record.type}</strong>
                    </div>
                    <div>
                      <span>Emails sent</span>
                      <strong>
                        {record.sentCount}/{record.targetCount}
                      </strong>
                    </div>
                    <div>
                      <span>Last email</span>
                      <strong>{formatDateTime(record.lastEmailAt)}</strong>
                    </div>
                    <div>
                      <span>Next email</span>
                      <strong>{formatDateTime(record.nextEmailAt)}</strong>
                    </div>
                  </div>

                  <p className="followup-summary">
                    {record.notes || `${record.type} follow-up sequence`}
                  </p>
                </article>
              ))}
            </div>
          )}
        </section>

        <section
          className="dashboard-card proposal-workspace-card"
          hidden={activeDashboardPage !== 'proposals'}
          id="proposals"
        >
          <div className="dashboard-card-header">
            <div>
              <span className="eyebrow">Proposals</span>
              <h2>Proposal follow-ups</h2>
            </div>
            <div className="proposal-header-actions">
              <span className="section-count">{filteredProposals.length}</span>
              <button
                className="secondary-button compact-action"
                disabled={isProcessingProposalQueue || appState.proposals.length === 0}
                onClick={() => void handleProcessProposalQueue()}
                type="button"
              >
                {isProcessingProposalQueue
                  ? gmailConnection?.connected
                    ? 'Sending...'
                    : 'Opening...'
                  : gmailConnection?.connected
                    ? 'Send due proposal follow-up'
                    : 'Open due proposal draft'}
              </button>
            </div>
          </div>

          <p className="dashboard-card-copy">
            This works like regular follow-ups, but the email copy is only about checking in on the
            proposal that was already sent.
          </p>

          <div className="proposal-workspace-grid">
            <article className="proposal-intake-card">
              <div className="studio-heading">
                <span className="section-index">02</span>
                <div>
                  <span className="eyebrow">Proposal sequence</span>
                  <h3>Create a new proposal follow-up</h3>
                </div>
              </div>

              <form className="stack-form" onSubmit={handleProposalSubmit}>
                <label className="field">
                  <span>Client name</span>
                  <input
                    onChange={(event) =>
                      setProposalForm((current) => ({
                        ...current,
                        clientName: event.target.value,
                      }))
                    }
                    placeholder="e.g. Acme Roofing"
                    required
                    type="text"
                    value={proposalForm.clientName}
                  />
                </label>

                <div className="field-row">
                  <label className="field">
                    <span>Email</span>
                    <input
                      onChange={(event) =>
                        setProposalForm((current) => ({ ...current, email: event.target.value }))
                      }
                      placeholder="decisionmaker@company.com"
                      required
                      type="email"
                      value={proposalForm.email}
                    />
                  </label>

                  <label className="field">
                    <span>Company</span>
                    <input
                      onChange={(event) =>
                        setProposalForm((current) => ({ ...current, company: event.target.value }))
                      }
                      placeholder="Optional"
                      type="text"
                      value={proposalForm.company}
                    />
                  </label>
                </div>

                <div className="composer-topline">
                  <label className="field compact-field">
                    <span>Number of tries</span>
                    <input
                      className="select-input"
                      inputMode="numeric"
                      max={MAX_SEQUENCE_TRIES}
                      min={1}
                      onChange={(event) => updateProposalSchedule(event.target.value)}
                      type="number"
                      value={proposalForm.targetFollowUps}
                    />
                  </label>

                  <div className="composer-note">
                    <span>Sequence timing</span>
                    <strong>{settingsForm.intervalDays} days between proposal follow-ups</strong>
                    <small>Each slot below sets the send time for that step in the sequence.</small>
                  </div>
                </div>

                <div className="schedule-board">
                  {proposalForm.followUpScheduleTimes.map((time, index) => (
                    <label className="schedule-tile" key={`proposal-follow-up-time-${index + 1}`}>
                      <span>Proposal follow-up {index + 1}</span>
                      <input
                        onChange={(event) =>
                          setProposalForm((current) => ({
                            ...current,
                            followUpScheduleTimes: current.followUpScheduleTimes.map(
                              (item, itemIndex) =>
                                itemIndex === index ? event.target.value : item,
                            ),
                          }))
                        }
                        required
                        type="time"
                        value={time}
                      />
                    </label>
                  ))}
                </div>

                <label className="field">
                  <span>Internal notes</span>
                  <textarea
                    onChange={(event) =>
                      setProposalForm((current) => ({ ...current, notes: event.target.value }))
                    }
                    placeholder="Context, timing, decision maker, next step..."
                    rows={4}
                    value={proposalForm.notes}
                  />
                </label>

                <button className="primary-button full-width" disabled={isSubmittingProposal} type="submit">
                  {isSubmittingProposal ? 'Saving proposal follow-up...' : 'Save proposal follow-up'}
                </button>
              </form>
            </article>

            <div className="proposal-directory-list">
              {filteredProposals.length === 0 ? (
                <article className="dashboard-empty-state">
                  <h3>No proposal follow-ups yet</h3>
                  <p>Add a client whose proposal was already sent to start the follow-up sequence.</p>
                </article>
              ) : (
                filteredProposals.map((proposal) => {
                  const isBusy = busyProposalId === proposal.id
                  const isComplete = proposal.sentFollowUps >= proposal.targetFollowUps
                  const isFinished = proposal.status === 'finished'
                  const isPaused = proposal.status === 'canceled'
                  const priority = getProposalPriority(proposal)
                  const attemptStatuses = createProposalAttemptStatuses(proposal)

                  return (
                    <article className="proposal-directory-card" key={proposal.id}>
                      <div className="client-directory-head">
                        <div>
                          <div className="identity-row">
                            <span className={`status-pill pill-${proposal.status}`}>
                              {getProposalStatusLabel(proposal.status)}
                            </span>
                            {proposal.status === 'active' ? (
                              <span className={`priority-badge priority-${priority.toLowerCase()}`}>
                                {priority} priority
                              </span>
                            ) : null}
                          </div>
                          <h3>{proposal.clientName}</h3>
                          <p className="client-subtitle">
                            {proposal.company || 'No company'} · {proposal.email}
                          </p>
                        </div>

                        <div className="next-window">
                          <span>{isPaused ? 'Paused on' : 'Next proposal email'}</span>
                          <strong>
                            {formatRelativeDue(isPaused ? proposal.canceledAt : proposal.nextFollowUpAt)}
                          </strong>
                          <small>{formatDateTime(isPaused ? proposal.canceledAt : proposal.nextFollowUpAt)}</small>
                        </div>
                      </div>

                      <div className="followup-detail-grid">
                        <div>
                          <span>Current status</span>
                          <strong>{getProposalStatusLabel(proposal.status)}</strong>
                        </div>
                        <div>
                          <span>Last follow-up</span>
                          <strong>{formatDateTime(proposal.lastFollowUpAt)}</strong>
                        </div>
                        <div>
                          <span>Next follow-up</span>
                          <strong>{formatDateTime(proposal.nextFollowUpAt)}</strong>
                        </div>
                      </div>

                      <div className="attempt-track">
                        {attemptStatuses.map((status, index) => (
                          <div
                            className={`attempt-node attempt-node-${status}`}
                            key={`${proposal.id}-proposal-${index + 1}`}
                          >
                            <span>{`Follow-up ${index + 1}`}</span>
                            <strong>{proposal.followUpScheduleTimes[index]}</strong>
                          </div>
                        ))}
                      </div>

                      <p className="followup-summary">{proposal.notes || getProposalStageLabel(proposal)}</p>

                      <div className="followup-action-row">
                        {proposal.status === 'active' ? (
                          <>
                            <button
                              className="primary-button"
                              disabled={isBusy || isComplete}
                              onClick={() => void handleSendProposal(proposal.id)}
                              type="button"
                            >
                              {isBusy
                                ? gmailConnection?.connected
                                  ? 'Sending...'
                                  : 'Opening...'
                                : gmailConnection?.connected
                                  ? 'Send proposal email'
                                  : 'Open proposal draft'}
                            </button>
                            <button
                              className="ghost-button"
                              disabled={isBusy}
                              onClick={() => void handleUpdateProposalStatus(proposal, 'canceled')}
                              type="button"
                            >
                              Pause proposal
                            </button>
                          </>
                        ) : null}

                        {isPaused ? (
                          <button
                            className="secondary-button"
                            disabled={isBusy}
                            onClick={() => void handleUpdateProposalStatus(proposal, 'active')}
                            type="button"
                          >
                            {isBusy ? 'Rescheduling...' : 'Resume proposal'}
                          </button>
                        ) : null}

                        {isFinished ? (
                          <button
                            className="danger-button"
                            disabled={isBusy}
                            onClick={() => void handleDeleteProposal(proposal)}
                            type="button"
                          >
                            {isBusy ? 'Deleting...' : 'Delete proposal'}
                          </button>
                        ) : null}
                      </div>
                    </article>
                  )
                })
              )}
            </div>
          </div>
        </section>

        <section
          className="dashboard-operations-grid dashboard-single-grid"
          hidden={activeDashboardPage !== 'settings'}
        >
          <article
            className="dashboard-card"
            hidden={activeDashboardPage !== 'settings'}
            id="settings"
          >
            <div className="dashboard-card-header">
              <div>
                <span className="eyebrow">Settings</span>
                <h2>Brand and workflow</h2>
              </div>
            </div>

            <div className="gmail-connection-card">
              <div>
                <span className="eyebrow">Gmail sending</span>
                <h3>{gmailConnection?.connected ? 'Gmail is connected' : 'Connect Gmail'}</h3>
                <p>
                  {gmailConnection?.connected
                    ? `Emails will be sent from ${gmailConnection.email}. Due appointment and proposal follow-ups send automatically while this dashboard is open.`
                    : 'Let users authorize Gmail once so appointment and proposal follow-up emails can send automatically from their own account.'}
                </p>
              </div>

              <div className="gmail-connection-actions">
                <button
                  className="primary-button"
                  disabled={isConnectingGmail || isCheckingGmailConnection || Boolean(gmailConnection?.connected)}
                  onClick={() => void handleConnectGmail()}
                  type="button"
                >
                  {isConnectingGmail ? 'Connecting...' : 'Connect Gmail'}
                </button>
                <button
                  className="ghost-button"
                  disabled={
                    isDisconnectingGmail || isCheckingGmailConnection || !gmailConnection?.connected
                  }
                  onClick={() => void handleDisconnectGmail()}
                  type="button"
                >
                  {isDisconnectingGmail ? 'Disconnecting...' : 'Disconnect'}
                </button>
                <button
                  className="secondary-button"
                  disabled={isCheckingGmailConnection}
                  onClick={() => void refreshGmailConnection(true)}
                  type="button"
                >
                  {isCheckingGmailConnection ? 'Checking...' : 'Refresh'}
                </button>
              </div>
            </div>

            <form className="stack-form" onSubmit={handleSaveSettings}>
              <div className="field-row">
                <label className="field">
                  <span>Reference email</span>
                  <input
                    onChange={(event) =>
                      setSettingsForm((current) =>
                        current ? { ...current, fromEmail: event.target.value } : current,
                      )
                    }
                    placeholder="sales@company.com"
                    type="email"
                    value={settingsForm.fromEmail}
                  />
                </label>

                <label className="field">
                  <span>Display name</span>
                  <input
                    onChange={(event) =>
                      setSettingsForm((current) =>
                        current ? { ...current, fromName: event.target.value } : current,
                      )
                    }
                    placeholder="Hessa Enterprises"
                    type="text"
                    value={settingsForm.fromName}
                  />
                </label>
              </div>

              <div className="field-row">
                <label className="field compact-field">
                  <span>Days between touchpoints</span>
                  <input
                    inputMode="numeric"
                    onChange={(event) =>
                      setSettingsForm((current) =>
                        current ? { ...current, intervalDays: event.target.value } : current,
                      )
                    }
                    required
                    type="text"
                    value={settingsForm.intervalDays}
                  />
                </label>

                <label className="checkbox-field">
                  <input
                    checked={settingsForm.autoOpenDraftOnCreate}
                    onChange={(event) =>
                      setSettingsForm((current) =>
                        current
                          ? { ...current, autoOpenDraftOnCreate: event.target.checked }
                          : current,
                      )
                    }
                    type="checkbox"
                  />
                  <span>Open the first draft automatically when it is already due</span>
                </label>
              </div>

              <button className="secondary-button full-width" disabled={isSavingSettings} type="submit">
                {isSavingSettings ? 'Saving settings...' : 'Save settings'}
              </button>
            </form>
          </article>
        </section>

        <section
          className="dashboard-card"
          hidden={activeDashboardPage !== 'appointments'}
          id="appointments"
        >
          <div className="dashboard-card-header">
            <div>
              <span className="eyebrow">Appointments</span>
              <h2>Appointment workspace</h2>
            </div>
            <div className="proposal-header-actions">
              <span className="section-count">{filteredDirectoryClients.length}</span>
              <button
                className="secondary-button compact-action"
                disabled={isProcessingQueue || appState.clients.length === 0}
                onClick={() => void handleProcessQueue()}
                type="button"
              >
                {isProcessingQueue
                  ? gmailConnection?.connected
                    ? 'Sending...'
                    : 'Opening...'
                  : gmailConnection?.connected
                    ? 'Send due appointment email'
                    : 'Open due appointment draft'}
              </button>
            </div>
          </div>

          <div className="client-workspace-grid">
            <article className="client-intake-card" id="new-client">
              <div className="studio-heading">
                <span className="section-index">01</span>
                <div>
                  <span className="eyebrow">Intake</span>
                  <h3>Create appointment follow-up</h3>
                </div>
              </div>

              <form className="stack-form" onSubmit={handleClientSubmit}>
                <label className="field">
                  <span>Appointment contact</span>
                  <input
                    onChange={(event) =>
                      setClientForm((current) => ({ ...current, name: event.target.value }))
                    }
                    placeholder="e.g. Laura Ramirez"
                    required
                    type="text"
                    value={clientForm.name}
                  />
                </label>

                <div className="field-row">
                  <label className="field">
                    <span>Email</span>
                    <input
                      onChange={(event) =>
                        setClientForm((current) => ({ ...current, email: event.target.value }))
                      }
                      placeholder="client@company.com"
                      required
                      type="email"
                      value={clientForm.email}
                    />
                  </label>

                  <label className="field">
                    <span>Company</span>
                    <input
                      onChange={(event) =>
                        setClientForm((current) => ({ ...current, company: event.target.value }))
                      }
                      placeholder="Optional"
                      type="text"
                      value={clientForm.company}
                    />
                  </label>
                </div>

                <label className="field">
                  <span>Internal notes</span>
                  <textarea
                    onChange={(event) =>
                      setClientForm((current) => ({ ...current, notes: event.target.value }))
                    }
                    placeholder="Context, objections, timing, priority..."
                    rows={4}
                    value={clientForm.notes}
                  />
                </label>

                <div className="composer-topline">
                  <label className="field compact-field">
                    <span>Number of tries</span>
                    <input
                      className="select-input"
                      inputMode="numeric"
                      max={MAX_SEQUENCE_TRIES}
                      min={1}
                      onChange={(event) => updateClientSchedule(event.target.value)}
                      type="number"
                      value={clientForm.targetContacts}
                    />
                  </label>

                  <div className="composer-note">
                    <span>Sequence timing</span>
                    <strong>{settingsForm.intervalDays} days between touchpoints</strong>
                    <small>Each slot below sets the send time for that step in the sequence.</small>
                  </div>
                </div>

                <div className="schedule-board">
                  {clientForm.contactScheduleTimes.map((time, index) => (
                    <label className="schedule-tile" key={`contact-time-${index + 1}`}>
                      <span>Touchpoint {index + 1}</span>
                      <input
                        onChange={(event) =>
                          setClientForm((current) => ({
                            ...current,
                            contactScheduleTimes: current.contactScheduleTimes.map((item, itemIndex) =>
                              itemIndex === index ? event.target.value : item,
                            ),
                          }))
                        }
                        required
                        type="time"
                        value={time}
                      />
                    </label>
                  ))}
                </div>

                <button className="primary-button full-width" disabled={isSubmittingClient} type="submit">
                  {isSubmittingClient ? 'Saving appointment...' : 'Save appointment'}
                </button>
              </form>
            </article>

            <div className="client-directory-list">
              {filteredDirectoryClients.length === 0 ? (
                <article className="dashboard-empty-state">
                  <h3>No saved appointments yet</h3>
                  <p>Create your first appointment follow-up sequence to start tracking emails.</p>
                </article>
              ) : (
                filteredDirectoryClients.map((client) => {
                  const attemptStatuses = createAttemptStatuses(client)
                  const isBusy = busyClientId === client.id
                  const isFinished = client.status === 'finished'
                  const isPaused = client.status === 'canceled'

                  return (
                    <article className="client-directory-card" id={`client-record-${client.id}`} key={client.id}>
                      <div className="client-directory-head">
                        <div>
                          <div className="identity-row">
                            <span className={`status-pill pill-${client.status}`}>
                              {getClientStatusLabel(client.status)}
                            </span>
                            <span className="meta-pill">{getClientStageLabel(client)}</span>
                          </div>
                          <h3>{client.name}</h3>
                          <p className="client-subtitle">
                            {client.company || 'No company'} · {client.email}
                          </p>
                        </div>

                        <div className="next-window">
                          <span>{isPaused ? 'Paused on' : 'Next email'}</span>
                          <strong>{formatRelativeDue(isPaused ? client.canceledAt : client.nextContactAt)}</strong>
                          <small>{formatDateTime(isPaused ? client.canceledAt : client.nextContactAt)}</small>
                        </div>
                      </div>

                      <div className="attempt-track">
                        {attemptStatuses.map((status, index) => (
                          <div className={`attempt-node attempt-node-${status}`} key={`${client.id}-${index + 1}`}>
                            <span>{`Touchpoint ${index + 1}`}</span>
                            <strong>{client.contactScheduleTimes[index]}</strong>
                          </div>
                        ))}
                      </div>

                      <div className="meta-grid">
                        <div className="meta-card">
                          <span className="meta-label">Last contact</span>
                          <strong>{formatDateTime(client.lastContactAt)}</strong>
                        </div>
                        <div className="meta-card">
                          <span className="meta-label">Created</span>
                          <strong>{formatDateTime(client.createdAt)}</strong>
                        </div>
                        <div className="meta-card">
                          <span className="meta-label">Emails sent</span>
                          <strong>
                            {client.sentContacts}/{client.targetContacts}
                          </strong>
                        </div>
                      </div>

                      {client.lastError ? <div className="error-box">{client.lastError}</div> : null}
                      {client.notes ? <p className="client-note">{client.notes}</p> : null}

                      <div className="action-row">
                        {client.status === 'active' ? (
                          <>
                            <button
                              className="primary-button"
                              disabled={isBusy}
                              onClick={() => void handleSendClient(client.id)}
                              type="button"
                            >
                              {isBusy
                                ? gmailConnection?.connected
                                  ? 'Sending...'
                                  : 'Opening...'
                                : gmailConnection?.connected
                                  ? 'Send email'
                                  : 'Open draft'}
                            </button>
                            <button
                              className="ghost-button"
                              disabled={isBusy}
                              onClick={() => void handleToggleClient(client)}
                              type="button"
                            >
                              Pause appointment
                            </button>
                          </>
                        ) : null}

                        {isPaused ? (
                          <button
                            className="secondary-button"
                            disabled={isBusy}
                            onClick={() => void handleToggleClient(client)}
                            type="button"
                          >
                            {isBusy ? 'Rescheduling...' : 'Resume appointment'}
                          </button>
                        ) : null}

                        {isFinished ? (
                          <button
                            className="danger-button"
                            disabled={isBusy}
                            onClick={() => void handleDeleteClient(client)}
                            type="button"
                          >
                            {isBusy ? 'Deleting...' : 'Delete appointment'}
                          </button>
                        ) : null}
                      </div>
                    </article>
                  )
                })
              )}
            </div>
          </div>
        </section>

        <section
          className="dashboard-card"
          hidden={activeDashboardPage !== 'templates'}
          id="templates"
        >
          <div className="dashboard-card-header">
            <div>
              <span className="eyebrow">Templates</span>
              <h2>Email copy by workflow</h2>
            </div>
            <span className="section-count">
              {settingsForm.templates.length + settingsForm.proposalTemplates.length}
            </span>
          </div>

          <div className="template-stack">
            <div className="template-group">
              <div className="template-group-heading">
                <div>
                  <span className="eyebrow">Appointment follow-ups</span>
                  <h3>Appointment email sequence</h3>
                </div>
                <span className="meta-pill">{settingsForm.templates.length} templates</span>
              </div>

              <div className="template-picker-card">
                <label className="field">
                  <span>Select appointment template</span>
                  <select
                    className="select-input"
                    onChange={(event) => setAppointmentTemplateChoice(Number(event.target.value))}
                    value={activeAppointmentTemplateIndex}
                  >
                    {settingsForm.templates.map((template, index) => (
                      <option key={template.id} value={index}>
                        {`Template ${index + 1}`}
                      </option>
                    ))}
                  </select>
                </label>

                <button
                  className="secondary-button"
                  onClick={() =>
                    setTemplateEditor({
                      workflow: 'appointment',
                      index: activeAppointmentTemplateIndex,
                    })
                  }
                  type="button"
                >
                  Edit selected template
                </button>
              </div>
            </div>

            <div className="template-group">
              <div className="template-group-heading">
                <div>
                  <span className="eyebrow">Proposal follow-ups</span>
                  <h3>Proposal email sequence</h3>
                </div>
                <span className="meta-pill">{settingsForm.proposalTemplates.length} templates</span>
              </div>

              <div className="template-picker-card">
                <label className="field">
                  <span>Select proposal template</span>
                  <select
                    className="select-input"
                    onChange={(event) => setProposalTemplateChoice(Number(event.target.value))}
                    value={activeProposalTemplateIndex}
                  >
                    {settingsForm.proposalTemplates.map((template, index) => (
                      <option key={template.id} value={index}>
                        {`Template ${index + 1}`}
                      </option>
                    ))}
                  </select>
                </label>

                <button
                  className="secondary-button"
                  onClick={() =>
                    setTemplateEditor({
                      workflow: 'proposal',
                      index: activeProposalTemplateIndex,
                    })
                  }
                  type="button"
                >
                  Edit selected template
                </button>
              </div>
            </div>
          </div>

          <div className="token-rack">
            {templateTokens.map((token) => (
              <code key={token}>{token}</code>
            ))}
          </div>

          <button
            className="secondary-button full-width"
            disabled={isSavingSettings}
            onClick={() => void saveSettingsChanges()}
            type="button"
          >
            {isSavingSettings ? 'Saving templates...' : 'Save templates'}
          </button>
        </section>
      </div>
    </main>
  )
}

export default App
