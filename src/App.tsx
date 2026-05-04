import { startTransition, useEffect, useEffectEvent, useRef, useState, type FormEvent } from 'react'
import appointmentManagementIcon from './assets/landing-icons/appointment-management.png?url&no-inline'
import browserAccessIcon from './assets/landing-icons/browser-access.png?url&no-inline'
import clientHistoryIcon from './assets/landing-icons/client-history.png?url&no-inline'
import emailFollowUpIcon from './assets/landing-icons/email-follow-up.png?url&no-inline'
import perUserWorkspaceIcon from './assets/landing-icons/per-user-workspace.png?url&no-inline'
import proposalPipelineIcon from './assets/landing-icons/proposal-pipeline.png?url&no-inline'
import logoWordmark from './assets/logo-wordmark.png'
import type {
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

const MAX_CONTACTS = 4
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

type AuthFormState = {
  email: string
  name: string
  password: string
}

type DashboardPriority = 'High' | 'Low' | 'Medium'

type DashboardFollowUpCard = {
  clientId: string | null
  clientName: string
  company: string
  email: string
  id: string
  isMock: boolean
  lastContactDate: string | null
  nextFollowUpDate: string | null
  priority: DashboardPriority
  projectName: string
  proposalAmount: number
  proposalValue: string
  status: string
  summary: string
}

type DashboardActivityItem = {
  description: string
  id: string
  isMock: boolean
  timestamp: string | null
  title: string
  tone: 'danger' | 'info' | 'success' | 'warning'
}

type SettingsFormState = {
  autoOpenDraftOnCreate: boolean
  fromEmail: string
  fromName: string
  intervalDays: string
  templates: EmailTemplate[]
}

type ProposalFormState = {
  clientName: string
  company: string
  email: string
  followUpScheduleTimes: string[]
  nextFollowUpDate: string
  nextFollowUpTime: string
  notes: string
  projectName: string
  proposalValue: string
  sentDate: string
  status: ProposalStatus
  targetFollowUps: number
}

function createInitialClientForm(): ClientInput {
  return {
    company: '',
    email: '',
    name: '',
    notes: '',
    targetContacts: 4,
    contactScheduleTimes: [...DEFAULT_SCHEDULE_TIMES],
  }
}

function toDateInputValue(date: Date) {
  return date.toISOString().slice(0, 10)
}

function createInitialProposalForm(): ProposalFormState {
  const today = toDateInputValue(new Date())

  return {
    clientName: '',
    company: '',
    email: '',
    followUpScheduleTimes: [...DEFAULT_SCHEDULE_TIMES],
    nextFollowUpDate: today,
    nextFollowUpTime: '09:00',
    notes: '',
    projectName: '',
    proposalValue: '',
    sentDate: today,
    status: 'sent',
    targetFollowUps: 4,
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

function combineDateAndTime(dateValue: string, timeValue = '09:00') {
  const [hours, minutes] = timeValue.split(':').map(Number)
  const date = new Date(`${dateValue}T00:00:00`)
  date.setHours(Number.isFinite(hours) ? hours : 9, Number.isFinite(minutes) ? minutes : 0, 0, 0)
  return date.toISOString()
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
  if (status === 'approved') {
    return 'Approved'
  }

  if (status === 'declined') {
    return 'Declined'
  }

  if (status === 'pending') {
    return 'Pending'
  }

  return 'Sent'
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

    if (proposal.status === 'approved' || proposal.status === 'declined') {
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
    templates: settings.templates.map((template) => ({ ...template })),
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

const dashboardNavItems = [
  { href: 'dashboard', label: 'Dashboard' },
  { href: 'clients', label: 'Clients' },
  { href: 'proposals', label: 'Proposals' },
  { href: 'follow-ups', label: 'Follow-Ups' },
  { href: 'email-drafts', label: 'Email Drafts' },
  { href: 'templates', label: 'Templates' },
  { href: 'settings', label: 'Settings' },
]

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', {
    currency: 'USD',
    maximumFractionDigits: 0,
    style: 'currency',
  }).format(amount)
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
  return proposal.status !== 'approved' && proposal.status !== 'declined'
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

function createRelativeIsoDate(days: number, hours = 0) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  date.setHours(date.getHours() + hours, 0, 0, 0)
  return date.toISOString()
}

function getClientPriority(client: ClientRecord): DashboardPriority {
  if (client.lastError || isOverdue(client.nextContactAt)) {
    return 'High'
  }

  if (isDueToday(client.nextContactAt) || client.sentContacts >= client.targetContacts - 1) {
    return 'Medium'
  }

  return 'Low'
}

function getClientProjectName(client: ClientRecord) {
  return client.company ? `${client.company} follow-up` : 'Client follow-up sequence'
}

function createDashboardCardFromClient(client: ClientRecord): DashboardFollowUpCard {
  return {
    clientId: client.id,
    clientName: client.name,
    company: client.company || 'No company added',
    email: client.email,
    id: client.id,
    isMock: false,
    lastContactDate: client.lastContactAt,
    nextFollowUpDate: client.nextContactAt,
    priority: getClientPriority(client),
    projectName: getClientProjectName(client),
    proposalAmount: 0,
    proposalValue: 'Not tracked yet',
    status: getClientStatusLabel(client.status),
    summary: client.notes || `${client.sentContacts}/${client.targetContacts} touchpoints completed`,
  }
}

function createMockFollowUpCards(): DashboardFollowUpCard[] {
  return [
    {
      clientId: null,
      clientName: 'Acme Roofing',
      company: 'Acme Roofing',
      email: 'estimating@acmeroofing.example',
      id: 'mock-acme-roofing',
      isMock: true,
      lastContactDate: createRelativeIsoDate(-2),
      nextFollowUpDate: createRelativeIsoDate(0, 1),
      priority: 'High',
      projectName: 'Commercial roof replacement',
      proposalAmount: 24500,
      proposalValue: '$24,500',
      status: 'Proposal sent',
      summary: 'Decision maker asked for financing options before approval.',
    },
    {
      clientId: null,
      clientName: 'Northside Remodel',
      company: 'Northside Remodel',
      email: 'ops@northside.example',
      id: 'mock-northside-remodel',
      isMock: true,
      lastContactDate: createRelativeIsoDate(-1),
      nextFollowUpDate: createRelativeIsoDate(0, 3),
      priority: 'Medium',
      projectName: 'Kitchen renovation estimate',
      proposalAmount: 18300,
      proposalValue: '$18,300',
      status: 'Pending review',
      summary: 'Follow up after the site walkthrough and revised scope.',
    },
    {
      clientId: null,
      clientName: 'Valley HVAC',
      company: 'Valley HVAC',
      email: 'service@valleyhvac.example',
      id: 'mock-valley-hvac',
      isMock: true,
      lastContactDate: createRelativeIsoDate(-4),
      nextFollowUpDate: createRelativeIsoDate(0, 5),
      priority: 'Low',
      projectName: 'Maintenance contract proposal',
      proposalAmount: 12800,
      proposalValue: '$12,800',
      status: 'Appointment scheduled',
      summary: 'Confirm maintenance plan details before sending final proposal.',
    },
  ]
}

function createMockActivityItems(): DashboardActivityItem[] {
  return [
    {
      description: 'Proposal follow-up prepared for Acme Roofing.',
      id: 'mock-activity-1',
      isMock: true,
      timestamp: createRelativeIsoDate(0, -1),
      title: 'Email draft queued',
      tone: 'success',
    },
    {
      description: 'Northside Remodel moved into pending review.',
      id: 'mock-activity-2',
      isMock: true,
      timestamp: createRelativeIsoDate(-1),
      title: 'Proposal status updated',
      tone: 'warning',
    },
    {
      description: 'Valley HVAC appointment reminder is ready for today.',
      id: 'mock-activity-3',
      isMock: true,
      timestamp: createRelativeIsoDate(-2),
      title: 'Follow-up scheduled',
      tone: 'info',
    },
  ]
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

  function updateClientSchedule(targetContacts: number) {
    setClientForm((current) => {
      const nextSchedule = Array.from({ length: targetContacts }, (_, index) =>
        current.contactScheduleTimes[index] || DEFAULT_SCHEDULE_TIMES[index],
      )

      return {
        ...current,
        targetContacts,
        contactScheduleTimes: nextSchedule,
      }
    })
  }

  function updateProposalSchedule(targetFollowUps: number) {
    setProposalForm((current) => {
      const nextSchedule = Array.from({ length: targetFollowUps }, (_, index) =>
        current.followUpScheduleTimes[index] || DEFAULT_SCHEDULE_TIMES[index],
      )

      return {
        ...current,
        targetFollowUps,
        followUpScheduleTimes: nextSchedule,
      }
    })
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

  function scrollToDashboardSection(sectionId: string) {
    document.getElementById(sectionId)?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    })
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
      projectName: proposalForm.projectName,
      proposalValue: Number(proposalForm.proposalValue) || 0,
      notes: proposalForm.notes,
      sentAt: combineDateAndTime(proposalForm.sentDate, '12:00'),
      nextFollowUpAt: combineDateAndTime(
        proposalForm.nextFollowUpDate,
        proposalForm.nextFollowUpTime,
      ),
      status: proposalForm.status,
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

  async function saveSettingsChanges() {
    if (!settingsForm) {
      return
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
      automation: {
        intervalDays: Math.max(1, Number(settingsForm.intervalDays) || 2),
        autoOpenDraftOnCreate: settingsForm.autoOpenDraftOnCreate,
      },
    }

    try {
      const response = await webApp.saveSettings(payload)
      applyOperationResponse(response, true)
    } catch (error) {
      setNotice({
        tone: 'error',
        message: toErrorMessage(error),
      })
      recordDiagnostic('Save settings', error)
    } finally {
      setIsSavingSettings(false)
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
            <p>Preparing clients, schedules, and email templates.</p>
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
  const approvedProposals = appState.proposals.filter((proposal) => proposal.status === 'approved')
  const declinedProposals = appState.proposals.filter((proposal) => proposal.status === 'declined')
  const sentProposals = appState.proposals.filter((proposal) => proposal.status === 'sent')
  const pendingProposals = appState.proposals.filter((proposal) => proposal.status === 'pending')
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
  const featuredClients =
    dueTodayClients.length || overdueClients.length
      ? [...overdueClients, ...dueTodayClients]
      : sortedActiveClients.slice(0, 4)
  const mockFollowUpCards = createMockFollowUpCards()
  const usingMockDashboardData = appState.clients.length === 0 && appState.proposals.length === 0
  const dashboardCards = usingMockDashboardData
    ? mockFollowUpCards
    : featuredClients.map(createDashboardCardFromClient)
  const searchQuery = dashboardSearch.trim().toLowerCase()
  const filteredDashboardCards = dashboardCards.filter((card) => {
    if (!searchQuery) {
      return true
    }

    return [
      card.clientName,
      card.company,
      card.email,
      card.priority,
      card.projectName,
      card.status,
      card.summary,
    ]
      .join(' ')
      .toLowerCase()
      .includes(searchQuery)
  })
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
      proposal.projectName,
      proposal.notes,
      proposal.status,
      String(proposal.proposalValue),
    ]
      .join(' ')
      .toLowerCase()
      .includes(searchQuery)
  })
  const recentActivityFromClients: DashboardActivityItem[] = [
    ...appState.clients.flatMap((client) =>
      client.history.map((item) => ({
        description: item.error || `${client.name} · ${item.subject}`,
        id: item.id,
        isMock: false,
        timestamp: item.happenedAt,
        title: item.status === 'prepared' ? 'Draft opened' : 'Draft error',
        tone: item.status === 'prepared' ? ('success' as const) : ('danger' as const),
      })),
    ),
    ...appState.proposals.flatMap((proposal) =>
      proposal.history.map((item) => ({
        description: item.error || `${proposal.clientName} · ${item.subject}`,
        id: item.id,
        isMock: false,
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
  const activityItems = recentActivityFromClients.length
    ? recentActivityFromClients
    : createMockActivityItems()
  const estimatedProposalAmount = usingMockDashboardData
    ? mockFollowUpCards.reduce((total, card) => total + card.proposalAmount, 0)
    : openProposals.reduce((total, proposal) => total + proposal.proposalValue, 0)
  const kpiCards = [
    {
      helper: usingMockDashboardData ? 'Demo queue until your first client is saved' : 'Scheduled for today',
      label: 'Follow-ups due today',
      value: String(usingMockDashboardData ? 6 : dueTodayClients.length),
    },
    {
      helper: usingMockDashboardData ? 'Demo overdue opportunities' : 'Need attention before they go cold',
      label: 'Overdue follow-ups',
      tone: 'danger',
      value: String(usingMockDashboardData ? 2 : overdueClients.length),
    },
    {
      helper: usingMockDashboardData
        ? 'Demo proposal pipeline'
        : `${dueProposalFollowUps.length} proposal follow-ups due now`,
      label: 'Active proposals',
      value: String(usingMockDashboardData ? 7 : openProposals.length),
    },
    {
      helper: usingMockDashboardData
        ? 'Demo estimate only'
        : 'Open sent and pending proposals',
      label: 'Estimated proposal value',
      tone: 'accent',
      value: formatCurrency(estimatedProposalAmount),
    },
  ]
  const proposalPipeline = [
    {
      count: usingMockDashboardData ? 4 : sentProposals.length,
      label: 'Sent',
      value: usingMockDashboardData
        ? '$48K'
        : formatCurrency(sentProposals.reduce((total, proposal) => total + proposal.proposalValue, 0)),
    },
    {
      count: usingMockDashboardData ? 2 : pendingProposals.length,
      label: 'Pending',
      tone: 'warning',
      value: `${dueTodayProposals.length + overdueProposals.length} need next step`,
    },
    {
      count: usingMockDashboardData ? 1 : approvedProposals.length,
      label: 'Approved',
      tone: 'success',
      value: formatCurrency(
        approvedProposals.reduce((total, proposal) => total + proposal.proposalValue, 0),
      ),
    },
    {
      count: usingMockDashboardData ? 1 : declinedProposals.length,
      label: 'Declined',
      tone: 'danger',
      value: formatCurrency(
        declinedProposals.reduce((total, proposal) => total + proposal.proposalValue, 0),
      ),
    },
  ]

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
              className={item.href === 'dashboard' ? 'sidebar-nav-item sidebar-nav-item-active' : 'sidebar-nav-item'}
              key={item.href}
              onClick={() => scrollToDashboardSection(item.href)}
              type="button"
            >
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-summary">
          <span>Workspace health</span>
          <strong>{activeClients.length || (usingMockDashboardData ? 7 : 0)} active</strong>
          <small>
            {usingMockDashboardData
              ? 'Demo data is visible until you save your first client.'
              : `${appState.stats.total} total clients tracked.`}
          </small>
        </div>
      </aside>

      <div className="dashboard-workspace">
        <header className="dashboard-topbar">
          <label className="dashboard-search">
            <span>Search</span>
            <input
              onChange={(event) => setDashboardSearch(event.target.value)}
              placeholder="Search clients, proposals, follow-ups..."
              type="search"
              value={dashboardSearch}
            />
          </label>

          <button
            className="primary-button dashboard-new-client"
            onClick={() => scrollToDashboardSection('new-client')}
            type="button"
          >
            New Client
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

        <section className="dashboard-overview" id="dashboard">
          <div className="dashboard-heading">
            <div>
              <span className="eyebrow">Hessa Enterprises</span>
              <h1>Follow-up dashboard</h1>
              <p>
                Track client next steps, proposal momentum, and ready-to-open email drafts from one
                focused workspace.
              </p>
            </div>

            {usingMockDashboardData ? (
              <span className="demo-data-badge">Demo data shown until first client</span>
            ) : (
              <span className="demo-data-badge live-data-badge">Live workspace data</span>
            )}
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
        </section>

        <section className="dashboard-primary-grid">
          <article className="dashboard-card followup-dashboard-card" id="follow-ups">
            <div className="dashboard-card-header">
              <div>
                <span className="eyebrow">Follow-ups</span>
                <h2>Follow-ups due today</h2>
              </div>
              <button
                className="secondary-button compact-action"
                disabled={isProcessingQueue || usingMockDashboardData}
                onClick={() => void handleProcessQueue()}
                type="button"
              >
                {isProcessingQueue ? 'Opening...' : 'Open next draft'}
              </button>
            </div>

            {filteredDashboardCards.length === 0 ? (
              <div className="dashboard-empty-state">
                <h3>No follow-ups match this view</h3>
                <p>Try clearing search or create a new client sequence.</p>
              </div>
            ) : (
              <div className="followup-card-list">
                {filteredDashboardCards.map((card) => {
                  const isBusy = card.clientId ? busyClientId === card.clientId : false

                  return (
                    <article className="followup-client-card" key={card.id}>
                      <div className="followup-client-top">
                        <div>
                          <div className="identity-row">
                            <span className={`priority-badge priority-${card.priority.toLowerCase()}`}>
                              {card.priority} priority
                            </span>
                            {card.isMock ? <span className="mock-data-pill">UI demo</span> : null}
                          </div>
                          <h3>{card.clientName}</h3>
                          <p>{card.projectName}</p>
                        </div>
                        <strong className="proposal-value">{card.proposalValue}</strong>
                      </div>

                      <div className="followup-detail-grid">
                        <div>
                          <span>Current status</span>
                          <strong>{card.status}</strong>
                        </div>
                        <div>
                          <span>Last contact</span>
                          <strong>{formatDateTime(card.lastContactDate)}</strong>
                        </div>
                        <div>
                          <span>Next follow-up</span>
                          <strong>{formatDateTime(card.nextFollowUpDate)}</strong>
                        </div>
                      </div>

                      <p className="followup-summary">{card.summary}</p>

                      <div className="followup-action-row">
                        <button
                          className="primary-button"
                          disabled={card.isMock || isBusy || !card.clientId}
                          onClick={() => {
                            if (card.clientId) {
                              void handleSendClient(card.clientId)
                            }
                          }}
                          type="button"
                        >
                          {isBusy
                            ? gmailConnection?.connected
                              ? 'Sending...'
                              : 'Opening...'
                            : gmailConnection?.connected
                              ? 'Send Email'
                              : 'Open Draft'}
                        </button>
                        <button
                          className="ghost-button"
                          onClick={() =>
                            setNotice({
                              tone: 'info',
                              message:
                                'Open Draft records the current follow-up. Manual Mark Done can be connected when proposal tracking has database fields.',
                            })
                          }
                          title="Manual completion will be available once proposal tracking has a database field."
                          type="button"
                        >
                          Mark Done
                        </button>
                        <button
                          className="secondary-button"
                          disabled={card.isMock}
                          onClick={() =>
                            scrollToDashboardSection(card.clientId ? `client-record-${card.clientId}` : 'clients')
                          }
                          type="button"
                        >
                          View Client
                        </button>
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </article>

          <div className="dashboard-side-stack">
            <article className="dashboard-card">
              <div className="dashboard-card-header">
                <div>
                  <span className="eyebrow">Pipeline</span>
                  <h2>Proposal pipeline</h2>
                </div>
                {usingMockDashboardData ? <span className="mock-data-pill">Demo</span> : null}
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
                disabled={isProcessingProposalQueue || usingMockDashboardData}
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
                {activityItems.some((item) => item.isMock) ? <span className="mock-data-pill">Demo</span> : null}
              </div>

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
            </article>
          </div>
        </section>

        <section className="dashboard-card proposal-workspace-card" id="proposals">
          <div className="dashboard-card-header">
            <div>
              <span className="eyebrow">Proposals</span>
              <h2>Proposal follow-up workspace</h2>
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
                    ? 'Send due proposal'
                    : 'Open due draft'}
              </button>
            </div>
          </div>

          <p className="dashboard-card-copy">
            Add proposals that have already been sent, schedule the next check-in, and send those
            proposal follow-up emails from the connected Gmail account when they are due.
          </p>

          <div className="proposal-workspace-grid">
            <article className="proposal-intake-card">
              <div className="studio-heading">
                <span className="section-index">02</span>
                <div>
                  <span className="eyebrow">Sent proposal</span>
                  <h3>Add proposal to follow up</h3>
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

                <label className="field">
                  <span>Project / proposal name</span>
                  <input
                    onChange={(event) =>
                      setProposalForm((current) => ({
                        ...current,
                        projectName: event.target.value,
                      }))
                    }
                    placeholder="Commercial roof replacement"
                    required
                    type="text"
                    value={proposalForm.projectName}
                  />
                </label>

                <div className="field-row">
                  <label className="field">
                    <span>Proposal value</span>
                    <input
                      inputMode="decimal"
                      min="0"
                      onChange={(event) =>
                        setProposalForm((current) => ({
                          ...current,
                          proposalValue: event.target.value,
                        }))
                      }
                      placeholder="24500"
                      type="number"
                      value={proposalForm.proposalValue}
                    />
                  </label>

                  <label className="field">
                    <span>Status</span>
                    <select
                      className="select-input"
                      onChange={(event) =>
                        setProposalForm((current) => ({
                          ...current,
                          status: event.target.value as ProposalStatus,
                        }))
                      }
                      value={proposalForm.status}
                    >
                      <option value="sent">Sent</option>
                      <option value="pending">Pending</option>
                      <option value="approved">Approved</option>
                      <option value="declined">Declined</option>
                    </select>
                  </label>
                </div>

                <div className="field-row">
                  <label className="field">
                    <span>Proposal sent date</span>
                    <input
                      onChange={(event) =>
                        setProposalForm((current) => ({
                          ...current,
                          sentDate: event.target.value,
                        }))
                      }
                      required
                      type="date"
                      value={proposalForm.sentDate}
                    />
                  </label>

                  <label className="field">
                    <span>Next follow-up date</span>
                    <input
                      disabled={
                        proposalForm.status === 'approved' || proposalForm.status === 'declined'
                      }
                      onChange={(event) =>
                        setProposalForm((current) => ({
                          ...current,
                          nextFollowUpDate: event.target.value,
                        }))
                      }
                      required={proposalForm.status === 'sent' || proposalForm.status === 'pending'}
                      type="date"
                      value={proposalForm.nextFollowUpDate}
                    />
                  </label>
                </div>

                <div className="composer-topline">
                  <label className="field compact-field">
                    <span>Follow-ups</span>
                    <select
                      className="select-input"
                      onChange={(event) => updateProposalSchedule(Number(event.target.value))}
                      value={proposalForm.targetFollowUps}
                    >
                      {Array.from({ length: MAX_CONTACTS }, (_, index) => {
                        const option = index + 1
                        return (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        )
                      })}
                    </select>
                  </label>

                  <label className="field compact-field">
                    <span>Next send time</span>
                    <input
                      disabled={
                        proposalForm.status === 'approved' || proposalForm.status === 'declined'
                      }
                      onChange={(event) =>
                        setProposalForm((current) => ({
                          ...current,
                          nextFollowUpTime: event.target.value,
                        }))
                      }
                      required={proposalForm.status === 'sent' || proposalForm.status === 'pending'}
                      type="time"
                      value={proposalForm.nextFollowUpTime}
                    />
                  </label>
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
                  <span>Internal proposal notes</span>
                  <textarea
                    onChange={(event) =>
                      setProposalForm((current) => ({ ...current, notes: event.target.value }))
                    }
                    placeholder="Decision maker, objections, proposal terms, next steps..."
                    rows={4}
                    value={proposalForm.notes}
                  />
                </label>

                <button className="primary-button full-width" disabled={isSubmittingProposal} type="submit">
                  {isSubmittingProposal ? 'Saving proposal...' : 'Save proposal'}
                </button>
              </form>
            </article>

            <div className="proposal-directory-list">
              {filteredProposals.length === 0 ? (
                <article className="dashboard-empty-state">
                  <h3>No proposals tracked yet</h3>
                  <p>Add a sent proposal to start a dedicated follow-up sequence.</p>
                </article>
              ) : (
                filteredProposals.map((proposal) => {
                  const isBusy = busyProposalId === proposal.id
                  const isClosed =
                    proposal.status === 'approved' || proposal.status === 'declined'
                  const isComplete = proposal.sentFollowUps >= proposal.targetFollowUps
                  const priority = getProposalPriority(proposal)
                  const attemptStatuses = createProposalAttemptStatuses(proposal)

                  return (
                    <article className="proposal-directory-card" key={proposal.id}>
                      <div className="client-directory-head">
                        <div>
                          <div className="identity-row">
                            <span className={`proposal-status proposal-status-${proposal.status}`}>
                              {getProposalStatusLabel(proposal.status)}
                            </span>
                            {!isClosed ? (
                              <span className={`priority-badge priority-${priority.toLowerCase()}`}>
                                {priority} priority
                              </span>
                            ) : null}
                          </div>
                          <h3>{proposal.projectName}</h3>
                          <p className="client-subtitle">
                            {proposal.clientName} · {proposal.company || 'No company'} ·{' '}
                            {proposal.email}
                          </p>
                        </div>

                        <div className="next-window">
                          <span>{isClosed ? 'Closed' : 'Next proposal email'}</span>
                          <strong>
                            {isClosed
                              ? getProposalStatusLabel(proposal.status)
                              : formatRelativeDue(proposal.nextFollowUpAt)}
                          </strong>
                          <small>
                            {isClosed
                              ? formatDateTime(proposal.approvedAt || proposal.declinedAt)
                              : formatDateTime(proposal.nextFollowUpAt)}
                          </small>
                        </div>
                      </div>

                      <div className="followup-detail-grid">
                        <div>
                          <span>Proposal value</span>
                          <strong>{formatCurrency(proposal.proposalValue)}</strong>
                        </div>
                        <div>
                          <span>Sent date</span>
                          <strong>{formatDateTime(proposal.sentAt)}</strong>
                        </div>
                        <div>
                          <span>Last follow-up</span>
                          <strong>{formatDateTime(proposal.lastFollowUpAt)}</strong>
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
                        <button
                          className="primary-button"
                          disabled={isBusy || isClosed || isComplete}
                          onClick={() => void handleSendProposal(proposal.id)}
                          type="button"
                        >
                          {isBusy
                            ? gmailConnection?.connected
                              ? 'Sending...'
                              : 'Opening...'
                            : gmailConnection?.connected
                              ? 'Send Proposal Email'
                              : 'Open Proposal Draft'}
                        </button>
                        <button
                          className="secondary-button"
                          disabled={isBusy || proposal.status === 'approved'}
                          onClick={() => void handleUpdateProposalStatus(proposal, 'approved')}
                          type="button"
                        >
                          Mark Approved
                        </button>
                        <button
                          className="ghost-button"
                          disabled={isBusy || proposal.status === 'declined'}
                          onClick={() => void handleUpdateProposalStatus(proposal, 'declined')}
                          type="button"
                        >
                          Mark Declined
                        </button>
                        {isClosed ? (
                          <button
                            className="secondary-button"
                            disabled={isBusy}
                            onClick={() => void handleUpdateProposalStatus(proposal, 'pending')}
                            type="button"
                          >
                            Reopen Pending
                          </button>
                        ) : null}
                        <button
                          className="danger-button"
                          disabled={isBusy}
                          onClick={() => void handleDeleteProposal(proposal)}
                          type="button"
                        >
                          Delete
                        </button>
                      </div>
                    </article>
                  )
                })
              )}
            </div>
          </div>
        </section>

        <section className="dashboard-operations-grid">
          <article className="dashboard-card" id="email-drafts">
            <div className="dashboard-card-header">
              <div>
                <span className="eyebrow">Email drafts</span>
                <h2>{gmailConnection?.connected ? 'Gmail sending' : 'Draft queue'}</h2>
              </div>
              <span className={`section-count ${gmailConnection?.connected ? 'gmail-connected-count' : ''}`}>
                {gmailConnection?.connected ? 'Gmail' : appState.stats.dueNow + dueProposalFollowUps.length}
              </span>
            </div>

            <p className="dashboard-card-copy">
              {gmailConnection?.connected
                ? `Connected as ${gmailConnection.email}. Client and proposal follow-ups send through Gmail API from that account.`
                : 'Email sending stays exactly as before: the app opens prepared `mailto:` drafts for client and proposal follow-ups until Gmail is connected.'}
            </p>

            <div className="email-action-stack">
              <button
                className="primary-button full-width"
                disabled={isProcessingQueue}
                onClick={() => void handleProcessQueue()}
                type="button"
              >
                {isProcessingQueue
                  ? gmailConnection?.connected
                    ? 'Sending client follow-up...'
                    : 'Opening client draft...'
                  : gmailConnection?.connected
                    ? 'Send next client email'
                    : 'Open next client draft'}
              </button>
              <button
                className="secondary-button full-width"
                disabled={isProcessingProposalQueue}
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
            </div>
          </article>

          <article className="dashboard-card" id="settings">
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
                    ? `Emails will be sent from ${gmailConnection.email}. Due client and proposal follow-ups send automatically while this dashboard is open.`
                    : 'Let users authorize Gmail once so client and proposal follow-up emails can send automatically from their own account.'}
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

        <section className="dashboard-card" id="clients">
          <div className="dashboard-card-header">
            <div>
              <span className="eyebrow">Clients</span>
              <h2>Client workspace</h2>
            </div>
            <span className="section-count">{filteredDirectoryClients.length}</span>
          </div>

          <div className="client-workspace-grid">
            <article className="client-intake-card" id="new-client">
              <div className="studio-heading">
                <span className="section-index">01</span>
                <div>
                  <span className="eyebrow">Intake</span>
                  <h3>Create a new sequence</h3>
                </div>
              </div>

              <form className="stack-form" onSubmit={handleClientSubmit}>
                <label className="field">
                  <span>Client name</span>
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
                    <span>Max touchpoints</span>
                    <select
                      className="select-input"
                      onChange={(event) => updateClientSchedule(Number(event.target.value))}
                      value={clientForm.targetContacts}
                    >
                      {Array.from({ length: MAX_CONTACTS }, (_, index) => {
                        const option = index + 1
                        return (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        )
                      })}
                    </select>
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
                  {isSubmittingClient ? 'Saving client...' : 'Save client'}
                </button>
              </form>
            </article>

            <div className="client-directory-list">
              {filteredDirectoryClients.length === 0 ? (
                <article className="dashboard-empty-state">
                  <h3>No saved clients yet</h3>
                  <p>Create your first client sequence to replace the demo cards above.</p>
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
                          <span>{isPaused ? 'Paused on' : 'Next draft'}</span>
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
                          <span className="meta-label">Completed</span>
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
                              Pause client
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
                            {isBusy ? 'Rescheduling...' : 'Resume client'}
                          </button>
                        ) : null}

                        {isFinished ? (
                          <button
                            className="danger-button"
                            disabled={isBusy}
                            onClick={() => void handleDeleteClient(client)}
                            type="button"
                          >
                            {isBusy ? 'Deleting...' : 'Delete client'}
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

        <section className="dashboard-card" id="templates">
          <div className="dashboard-card-header">
            <div>
              <span className="eyebrow">Templates</span>
              <h2>Email copy by touchpoint</h2>
            </div>
            <span className="section-count">{settingsForm.templates.length}</span>
          </div>

          <div className="template-stack">
            {settingsForm.templates.map((template, index) => (
              <div className="template-editor" key={template.id}>
                <div className="template-editor-head">
                  <strong>{`Touchpoint ${index + 1}`}</strong>
                  <span>Email copy</span>
                </div>

                <label className="field">
                  <span>Subject line</span>
                  <input
                    onChange={(event) =>
                      setSettingsForm((current) =>
                        current
                          ? {
                              ...current,
                              templates: current.templates.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, subject: event.target.value } : item,
                              ),
                            }
                          : current,
                      )
                    }
                    type="text"
                    value={template.subject}
                  />
                </label>

                <label className="field">
                  <span>Body</span>
                  <textarea
                    onChange={(event) =>
                      setSettingsForm((current) =>
                        current
                          ? {
                              ...current,
                              templates: current.templates.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, body: event.target.value } : item,
                              ),
                            }
                          : current,
                      )
                    }
                    rows={7}
                    value={template.body}
                  />
                </label>
              </div>
            ))}
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
