export type RuntimeInfo = {
  browser: string
  platform: 'web'
  storage: 'localStorage'
}

export type UserRole = 'admin' | 'owner' | 'staff' | 'super_admin' | 'viewer'
export type AccountPlan = 'basic' | 'business' | 'free' | 'pro'
export type SubscriptionStatus =
  | 'active'
  | 'cancelled'
  | 'free'
  | 'past_due'
  | 'suspended'
  | 'trial'
export type AccountStatus = 'active' | 'suspended'

export type AuthUser = {
  accountId: string
  id: string
  name: string
  email: string
  createdAt: string
  role: UserRole
}

export type AccountRecord = {
  id: string
  name: string
  ownerUserId: string
  plan: AccountPlan
  subscriptionStatus: SubscriptionStatus
  status: AccountStatus
  trialEndsAt: string | null
  subscriptionStartedAt: string | null
  subscriptionEndsAt: string | null
  createdAt: string
  updatedAt: string
}

export type PlanPricingRecord = {
  plan: AccountPlan
  currency: string
  monthlyPriceCents: number
  annualPriceCents: number
  discountPercent: number
  isComingSoon: boolean
  updatedAt: string
}

export type AccountUserRecord = {
  accountId: string
  email: string
  joinedAt: string
  name: string
  role: UserRole
  userId: string
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
export type ProposalStatus = 'active' | 'finished' | 'canceled'

export type EmailTemplate = {
  accountId: string
  id: string
  title: string
  subject: string
  body: string
}

export type FollowUpHistoryItem = {
  accountId: string
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
  accountId: string
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

export type ProposalRecord = {
  accountId: string
  id: string
  clientName: string
  email: string
  company: string
  notes: string
  status: ProposalStatus
  createdAt: string
  updatedAt: string
  canceledAt: string | null
  finishedAt: string | null
  nextFollowUpAt: string | null
  lastFollowUpAt: string | null
  lastError: string | null
  sentFollowUps: number
  targetFollowUps: number
  followUpScheduleTimes: string[]
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
  accountId: string
  sender: {
    fromEmail: string
    fromName: string
  }
  templates: EmailTemplate[]
  proposalTemplates: EmailTemplate[]
  automation: {
    intervalDays: number
    autoOpenDraftOnCreate: boolean
  }
}

export type AppState = {
  account: AccountRecord
  currentUser: AuthUser
  runtimeInfo: RuntimeInfo
  settings: SettingsState
  stats: DashboardStats
  clients: ClientRecord[]
  proposals: ProposalRecord[]
}

export type AdminAccountSummary = AccountRecord & {
  activeUsers: number
  appointmentCount: number
  emailCount: number
  proposalCount: number
  users: AccountUserRecord[]
}

export type AdminMetrics = {
  activeAccounts: number
  appointmentCount: number
  emailCount: number
  proposalCount: number
  suspendedAccounts: number
  totalAccounts: number
  totalUsers: number
}

export type AdminPlatformState = {
  accounts: AdminAccountSummary[]
  metrics: AdminMetrics
  planPricing: PlanPricingRecord[]
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

export type ProposalInput = {
  clientName: string
  email: string
  company: string
  notes: string
  targetFollowUps: number
  followUpScheduleTimes: string[]
}

export type SettingsInput = {
  sender: {
    fromEmail: string
    fromName: string
  }
  templates: EmailTemplate[]
  proposalTemplates: EmailTemplate[]
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
