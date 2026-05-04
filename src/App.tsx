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
  RegisterInput,
  SettingsInput,
  SettingsState,
} from './types'
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

type SettingsFormState = {
  autoOpenDraftOnCreate: boolean
  fromEmail: string
  fromName: string
  intervalDays: string
  templates: EmailTemplate[]
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

function formatDateTime(isoDate: string | null) {
  if (!isoDate) {
    return 'Pending'
  }

  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(isoDate))
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

function App() {
  const diagnosticIdRef = useRef(0)
  const [session, setSession] = useState<AuthSession | null>(null)
  const [appState, setAppState] = useState<AppState | null>(null)
  const [clientForm, setClientForm] = useState<ClientInput>(() => createInitialClientForm())
  const [authForm, setAuthForm] = useState<AuthFormState>(() => createInitialAuthForm())
  const [settingsForm, setSettingsForm] = useState<SettingsFormState | null>(null)
  const [authMode, setAuthMode] = useState<AuthMode>('login')
  const [notice, setNotice] = useState<Notice | null>(null)
  const [diagnostics, setDiagnostics] = useState<DiagnosticEntry[]>([])
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [isAuthenticating, setIsAuthenticating] = useState(false)
  const [isGoogleAuthenticating, setIsGoogleAuthenticating] = useState(false)
  const [isSubmittingClient, setIsSubmittingClient] = useState(false)
  const [isSavingSettings, setIsSavingSettings] = useState(false)
  const [isProcessingQueue, setIsProcessingQueue] = useState(false)
  const [busyClientId, setBusyClientId] = useState<string | null>(null)

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
        setNotice({
          tone: 'success',
          message: result.message,
        })

        if (result.session) {
          setSession(result.session)
        } else {
          setAuthMode('login')
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

  function handleLandingAuthCta(nextMode: AuthMode) {
    setAuthMode(nextMode)
    window.setTimeout(() => {
      document.getElementById('account-access')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    }, 0)
  }

  async function handleLogout() {
    try {
      await webApp.logout()
      setSession(null)
      setAppState(null)
      setSettingsForm(null)
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
      const response = await webApp.createClient(clientForm)
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
      const response = await webApp.processDueFollowUps()
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

  async function handleSendClient(clientId: string) {
    setBusyClientId(clientId)

    try {
      const response = await webApp.sendClientFollowUp(clientId)
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

            {authMode === 'reset-password' ? null : (
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
            )}

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

              {authMode === 'reset-password' ? null : (
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
              )}

              {authMode === 'forgot-password' ? null : (
                <label className="field">
                  <span>{authMode === 'reset-password' ? 'New password' : 'Password'}</span>
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

              {authMode === 'forgot-password' || authMode === 'reset-password' ? (
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
  const finishedClients = appState.clients.filter((client) => client.status === 'finished')
  const canceledClients = appState.clients.filter((client) => client.status === 'canceled')
  const statCards = [
    { label: 'Total clients', value: appState.stats.total },
    { label: 'Active sequences', value: appState.stats.active },
    { label: 'Due now', value: appState.stats.dueNow, tone: 'accent' },
    { label: 'Completed', value: appState.stats.finished },
    { label: 'With errors', value: appState.stats.withErrors },
  ]

  return (
    <main className="crm-shell">
      {diagnosticsPanel}
      <header className="workspace-topbar">
        <div className="workspace-brand">
          <span className="eyebrow">Hessa Follow Up</span>
          <p>
            Signed in as <strong>{appState.currentUser.name}</strong> · {appState.currentUser.email}
          </p>
        </div>

        <button className="ghost-button" onClick={() => void handleLogout()} type="button">
          Log out
        </button>
      </header>

      <section className="hero-grid">
        <article className="panel brand-stage">
          <div className="brand-stage-header">
            <span className="eyebrow">Hessa Enterprises</span>
            <span className="stage-chip">Private workspace</span>
          </div>

          <div className="brand-stage-visual">
            <div className="brand-glow"></div>
            <img alt="Hessa Enterprises" className="brand-wordmark" src={logoWordmark} />
          </div>

          <div className="brand-stage-footer">
            <span className="brand-caption">Client follow-up workspace</span>
            <h2>Built for clean, structured outbound follow-up.</h2>
            <p>
              Manage clients, schedule each outreach touchpoint, and open ready-to-send
              drafts from one organized workspace.
            </p>
          </div>
        </article>

        <article className="panel hero-brief">
          <span className="eyebrow">Follow-up operations</span>
          <h1>A minimal workspace for thoughtful sales follow-up.</h1>
          <p className="lede">
            Track every client, control timing, and keep each next step visible without
            the clutter of a traditional dashboard.
          </p>

          <div className="hero-action-bar">
            <button
              className="primary-button"
              disabled={isProcessingQueue}
              onClick={() => void handleProcessQueue()}
              type="button"
            >
              {isProcessingQueue ? 'Opening next draft...' : 'Open next draft'}
            </button>

            <p className="action-note">
              Opens the next scheduled email as a draft in your default mail app.
            </p>
          </div>
        </article>
      </section>

      <div className="notice notice-info">
        This web version stores its data in <code>localStorage</code> and opens each
        email as a draft. If you want fully automated sending later, the next step is a
        backend or an email provider integration.
      </div>

      {notice ? <div className={`notice notice-${notice.tone}`}>{notice.message}</div> : null}

      <section className="metric-ribbon">
        {statCards.map((card) => (
          <article
            className={`panel metric-card ${card.tone === 'accent' ? 'metric-card-accent' : ''}`}
            key={card.label}
          >
            <span className="metric-label">{card.label}</span>
            <strong>{card.value}</strong>
          </article>
        ))}
      </section>

      <section className="workspace-grid">
        <div className="control-column">
          <article className="panel studio-card">
            <div className="studio-heading">
              <span className="section-index">01</span>
              <div>
                <span className="eyebrow">Intake</span>
                <h2>Create a new sequence</h2>
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

          <article className="panel studio-card">
            <div className="studio-heading">
              <span className="section-index">02</span>
              <div>
                <span className="eyebrow">Settings</span>
                <h2>Brand and workflow settings</h2>
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

                <div className="composer-note">
                  <span>Draft delivery</span>
                  <strong>Handled by your browser</strong>
                  <small>The final sending account depends on the mail app you open.</small>
                </div>
              </div>

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

              <button className="secondary-button full-width" disabled={isSavingSettings} type="submit">
                {isSavingSettings ? 'Saving settings...' : 'Save settings'}
              </button>
            </form>
          </article>

          <article className="panel studio-card">
            <div className="studio-heading">
              <span className="section-index">03</span>
              <div>
                <span className="eyebrow">Templates</span>
                <h2>Edit email copy by touchpoint</h2>
              </div>
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
                                  itemIndex === index
                                    ? { ...item, subject: event.target.value }
                                    : item,
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
          </article>
        </div>

        <div className="board-column">
          <article className="panel board-stage">
            <div className="board-stage-copy">
              <span className="eyebrow">Pipeline</span>
              <h2>Your follow-up queue, completed sequences, and paused work.</h2>
              <p>
                Every client stays visible in a simple structure so you can focus on
                timing, copy, and next actions instead of navigating clutter.
              </p>
            </div>
          </article>

          <section className="board-section">
            <div className="section-banner">
              <div>
                <span className="eyebrow">Live queue</span>
                <h3>Active follow-up queue</h3>
              </div>
              <span className="section-count">{activeClients.length}</span>
            </div>

            {activeClients.length === 0 ? (
              <article className="panel empty-state">
                <h3>No active clients yet</h3>
                <p>New client sequences will appear here as soon as you create them.</p>
              </article>
            ) : (
              <div className="board-list">
                {activeClients.map((client) => {
                  const attemptStatuses = createAttemptStatuses(client)
                  const isBusy = busyClientId === client.id
                  const isLastAttempt = client.sentContacts === client.targetContacts - 1

                  return (
                    <article className="panel inbox-card" key={client.id}>
                      <div className="inbox-card-top">
                        <div>
                          <div className="identity-row">
                            <span className="status-pill pill-active">
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
                          <span>Next draft</span>
                          <strong>{formatRelativeDue(client.nextContactAt)}</strong>
                          <small>{formatDateTime(client.nextContactAt)}</small>
                        </div>
                      </div>

                      {isLastAttempt ? (
                        <div className="final-attempt-banner">
                          This client is moving into the final scheduled touchpoint.
                        </div>
                      ) : null}

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
                          <span className="meta-label">Completed</span>
                          <strong>{client.sentContacts}</strong>
                        </div>
                        <div className="meta-card">
                          <span className="meta-label">Last draft</span>
                          <strong>{formatDateTime(client.lastContactAt)}</strong>
                        </div>
                        <div className="meta-card">
                          <span className="meta-label">Created</span>
                          <strong>{formatDateTime(client.createdAt)}</strong>
                        </div>
                      </div>

                      {client.lastError ? <div className="error-box">{client.lastError}</div> : null}
                      {client.notes ? <p className="client-note">{client.notes}</p> : null}

                      <div className="action-row">
                        <button
                          className="primary-button"
                          disabled={isBusy}
                          onClick={() => void handleSendClient(client.id)}
                          type="button"
                        >
                          {isBusy ? 'Opening...' : 'Open draft'}
                        </button>

                        <button
                          className="ghost-button"
                          disabled={isBusy}
                          onClick={() => void handleToggleClient(client)}
                          type="button"
                        >
                          Pause client
                        </button>
                      </div>

                      <div className="history-stack">
                        <div className="history-header">
                          <span className="eyebrow">Recent activity</span>
                        </div>

                        {client.history.length === 0 ? (
                          <p className="history-empty">
                            No drafts have been opened for this client yet.
                          </p>
                        ) : (
                          client.history.slice(0, 4).map((item) => (
                            <div className="history-row" key={item.id}>
                              <div className="history-main">
                                <strong>
                                  {`Touchpoint ${item.contactNumber}`} ·{' '}
                                  {item.status === 'prepared' ? 'Draft opened' : 'Error'}
                                </strong>
                                <span>{item.subject}</span>
                              </div>
                              <div className="history-side">
                                <span>{formatDateTime(item.happenedAt)}</span>
                                <small>{item.error || item.preview}</small>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </section>

          <section className="board-section">
            <div className="section-banner">
              <div>
                <span className="eyebrow">Completed</span>
                <h3>Completed sequences</h3>
              </div>
              <span className="section-count">{finishedClients.length}</span>
            </div>

            {finishedClients.length === 0 ? (
              <article className="panel empty-state">
                <h3>No completed sequences yet</h3>
                <p>Clients that finish every planned touchpoint will appear here.</p>
              </article>
            ) : (
              <div className="board-list">
                {finishedClients.map((client) => {
                  const isBusy = busyClientId === client.id

                  return (
                    <article className="panel archive-card" key={client.id}>
                      <div className="archive-top">
                        <div>
                          <div className="identity-row">
                            <span className="status-pill pill-finished">Completed</span>
                            <span className="meta-pill">{getClientStageLabel(client)}</span>
                          </div>
                          <h3>{client.name}</h3>
                          <p className="client-subtitle">
                            Sequence completed with {client.sentContacts} of {client.targetContacts}{' '}
                            touchpoints.
                          </p>
                        </div>
                      </div>

                      <div className="archive-highlight">
                        <strong>Sequence successfully closed</strong>
                        <span>Keep this record for reference or remove it from the workspace.</span>
                      </div>

                      <div className="meta-grid">
                        <div className="meta-card">
                          <span className="meta-label">Completed on</span>
                          <strong>{formatDateTime(client.finishedAt)}</strong>
                        </div>
                        <div className="meta-card">
                          <span className="meta-label">Last draft</span>
                          <strong>{formatDateTime(client.lastContactAt)}</strong>
                        </div>
                        <div className="meta-card">
                          <span className="meta-label">Company</span>
                          <strong>{client.company || 'No company'}</strong>
                        </div>
                      </div>

                      <button
                        className="danger-button"
                        disabled={isBusy}
                        onClick={() => void handleDeleteClient(client)}
                        type="button"
                      >
                        {isBusy ? 'Deleting...' : 'Delete client'}
                      </button>
                    </article>
                  )
                })}
              </div>
            )}
          </section>

          {canceledClients.length > 0 ? (
            <section className="board-section">
              <div className="section-banner">
                <div>
                  <span className="eyebrow">Paused</span>
                  <h3>Paused clients</h3>
                </div>
                <span className="section-count">{canceledClients.length}</span>
              </div>

              <div className="board-list">
                {canceledClients.map((client) => {
                  const isBusy = busyClientId === client.id

                  return (
                    <article className="panel paused-card" key={client.id}>
                      <div className="inbox-card-top">
                        <div>
                          <div className="identity-row">
                            <span className="status-pill pill-canceled">
                              {getClientStatusLabel(client.status)}
                            </span>
                            <span className="meta-pill">{getClientStageLabel(client)}</span>
                          </div>
                          <h3>{client.name}</h3>
                          <p className="client-subtitle">
                            {client.company || 'No company'} · {client.email}
                          </p>
                        </div>

                        <div className="next-window muted-window">
                          <span>Paused on</span>
                          <strong>{formatDateTime(client.canceledAt)}</strong>
                          <small>Ready to resume</small>
                        </div>
                      </div>

                      <button
                        className="secondary-button"
                        disabled={isBusy}
                        onClick={() => void handleToggleClient(client)}
                        type="button"
                      >
                        {isBusy ? 'Rescheduling...' : 'Resume client'}
                      </button>
                    </article>
                  )
                })}
              </div>
            </section>
          ) : null}
        </div>
      </section>
    </main>
  )
}

export default App
