export type RuntimeInfo = {
  browser: string
  platform: 'web'
  storage: 'localStorage'
}

export type AuthUser = {
  id: string
  name: string
  email: string
  createdAt: string
}

export type AuthSession = {
  user: AuthUser
}

export type AuthActionResult = {
  message: string
  session: AuthSession | null
}

export type FollowUpStatus = 'prepared' | 'failed'
export type ClientStatus = 'active' | 'finished' | 'canceled'

export type EmailTemplate = {
  id: string
  title: string
  subject: string
  body: string
}

export type FollowUpHistoryItem = {
  id: string
  contactNumber: number
  status: FollowUpStatus
  scheduledFor: string
  happenedAt: string
  subject: string
  preview: string
  error: string | null
}

export type ClientRecord = {
  id: string
  name: string
  email: string
  company: string
  notes: string
  status: ClientStatus
  createdAt: string
  updatedAt: string
  canceledAt: string | null
  finishedAt: string | null
  nextContactAt: string | null
  lastContactAt: string | null
  lastError: string | null
  sentContacts: number
  targetContacts: number
  contactScheduleTimes: string[]
  history: FollowUpHistoryItem[]
}

export type DashboardStats = {
  active: number
  canceled: number
  dueNow: number
  finished: number
  total: number
  withErrors: number
}

export type SettingsState = {
  sender: {
    fromEmail: string
    fromName: string
  }
  templates: EmailTemplate[]
  automation: {
    intervalDays: number
    autoOpenDraftOnCreate: boolean
  }
}

export type AppState = {
  currentUser: AuthUser
  runtimeInfo: RuntimeInfo
  settings: SettingsState
  stats: DashboardStats
  clients: ClientRecord[]
}

export type ProcessResult = {
  failed: number
  message: string
  processed: number
  sent: number
}

export type AppOperationResponse = AppState & {
  result?: ProcessResult
}

export type ClientInput = {
  name: string
  email: string
  company: string
  notes: string
  targetContacts: number
  contactScheduleTimes: string[]
}

export type SettingsInput = {
  sender: {
    fromEmail: string
    fromName: string
  }
  templates: EmailTemplate[]
  automation: {
    intervalDays: number
    autoOpenDraftOnCreate: boolean
  }
}

export type LoginInput = {
  email: string
  password: string
}

export type RegisterInput = {
  name: string
  email: string
  password: string
}

export type PasswordResetInput = {
  email: string
}

export type PasswordUpdateInput = {
  password: string
}
