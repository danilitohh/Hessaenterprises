import { handleOptions, jsonResponse } from '../_shared/http.ts'
import { createAdminClient, getAuthenticatedUser } from '../_shared/supabase.ts'

const MASTER_SUPER_ADMIN_EMAILS = new Set([
  'kevin.hessam@gmail.com',
  'danilitohhh@gmail.com',
])

type AccountPlan = 'basic' | 'business' | 'free' | 'pro'
type AccountStatus = 'active' | 'suspended'
type SubscriptionStatus = 'active' | 'cancelled' | 'free' | 'past_due' | 'suspended' | 'trial'
type UserRole = 'admin' | 'owner' | 'staff' | 'super_admin' | 'viewer'

type AuthUserSummary = {
  created_at?: string
  email?: string
  id: string
  raw_user_meta_data?: Record<string, unknown>
  user_metadata?: Record<string, unknown>
}

type AccountRecord = {
  createdAt: string
  id: string
  name: string
  ownerUserId: string
  plan: AccountPlan
  status: AccountStatus
  subscriptionEndsAt: string | null
  subscriptionStartedAt: string | null
  subscriptionStatus: SubscriptionStatus
  trialEndsAt: string | null
  updatedAt: string
}

type AccountUserRecord = {
  accountId: string
  email: string
  joinedAt: string
  name: string
  role: UserRole
  userId: string
}

type PlanPricingRecord = {
  annualPriceCents: number
  currency: string
  discountPercent: number
  isComingSoon: boolean
  monthlyPriceCents: number
  plan: AccountPlan
  updatedAt: string
}

const planOptions: AccountPlan[] = ['free', 'basic', 'pro', 'business']

function nowIso() {
  return new Date().toISOString()
}

function isSchemaUnavailable(error: unknown) {
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

function normalizePlan(value: unknown): AccountPlan {
  return value === 'basic' || value === 'pro' || value === 'business' ? value : 'free'
}

function normalizeStatus(value: unknown): AccountStatus {
  return value === 'suspended' ? 'suspended' : 'active'
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

function normalizeRole(value: unknown, email = ''): UserRole {
  if (MASTER_SUPER_ADMIN_EMAILS.has(email.toLowerCase())) {
    return 'super_admin'
  }

  return value === 'owner' || value === 'admin' || value === 'staff' || value === 'viewer'
    ? value
    : 'owner'
}

function getUserName(user: AuthUserSummary) {
  const metadata = user.user_metadata ?? user.raw_user_meta_data ?? {}
  const name =
    typeof metadata.name === 'string'
      ? metadata.name
      : typeof metadata.full_name === 'string'
        ? metadata.full_name
        : ''

  return name.trim() || user.email?.split('@')[0] || 'Hessa user'
}

function normalizeMoneyCents(value: unknown) {
  const amount = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount) : 0
}

function normalizeDiscountPercent(value: unknown) {
  const amount = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(amount) ? Math.min(100, Math.max(0, Math.round(amount))) : 0
}

function createFallbackAccount(user: AuthUserSummary): AccountRecord {
  const createdAt = user.created_at ?? nowIso()

  return {
    createdAt,
    id: `account-${user.id}`,
    name: `${getUserName(user)} Workspace`,
    ownerUserId: user.id,
    plan: 'free',
    status: 'active',
    subscriptionEndsAt: null,
    subscriptionStartedAt: null,
    subscriptionStatus: 'free',
    trialEndsAt: null,
    updatedAt: createdAt,
  }
}

function mapAccount(row: Record<string, unknown>): AccountRecord {
  return {
    createdAt: typeof row.created_at === 'string' ? row.created_at : nowIso(),
    id: typeof row.id === 'string' ? row.id : crypto.randomUUID(),
    name: typeof row.name === 'string' ? row.name : 'Hessa Workspace',
    ownerUserId: typeof row.owner_user_id === 'string' ? row.owner_user_id : '',
    plan: normalizePlan(row.plan),
    status: normalizeStatus(row.status),
    subscriptionEndsAt:
      typeof row.subscription_ends_at === 'string' ? row.subscription_ends_at : null,
    subscriptionStartedAt:
      typeof row.subscription_started_at === 'string' ? row.subscription_started_at : null,
    subscriptionStatus: normalizeSubscriptionStatus(row.subscription_status),
    trialEndsAt: typeof row.trial_ends_at === 'string' ? row.trial_ends_at : null,
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : nowIso(),
  }
}

function mapAccountUser(row: Record<string, unknown>): AccountUserRecord {
  const email = typeof row.email === 'string' ? row.email.toLowerCase() : ''

  return {
    accountId: typeof row.account_id === 'string' ? row.account_id : '',
    email,
    joinedAt: typeof row.joined_at === 'string' ? row.joined_at : nowIso(),
    name: typeof row.full_name === 'string' ? row.full_name : email,
    role: normalizeRole(row.role, email),
    userId: typeof row.user_id === 'string' ? row.user_id : crypto.randomUUID(),
  }
}

function mapPlanPricing(row: Record<string, unknown>): PlanPricingRecord {
  return {
    annualPriceCents: normalizeMoneyCents(row.annual_price_cents),
    currency: typeof row.currency === 'string' ? row.currency.toUpperCase() : 'USD',
    discountPercent: normalizeDiscountPercent(row.discount_percent),
    isComingSoon: row.is_coming_soon !== false,
    monthlyPriceCents: normalizeMoneyCents(row.monthly_price_cents),
    plan: normalizePlan(row.plan),
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : nowIso(),
  }
}

function createDefaultPlanPricing(plan: AccountPlan): PlanPricingRecord {
  return {
    annualPriceCents: 0,
    currency: 'USD',
    discountPercent: 0,
    isComingSoon: true,
    monthlyPriceCents: 0,
    plan,
    updatedAt: nowIso(),
  }
}

async function selectRows(supabase: ReturnType<typeof createAdminClient>, tableName: string) {
  const { data, error } = await supabase.from(tableName).select('*')

  if (error) {
    if (isSchemaUnavailable(error)) {
      return []
    }

    throw new Error(error.message)
  }

  return (data ?? []) as Array<Record<string, unknown>>
}

async function listAllAuthUsers(supabase: ReturnType<typeof createAdminClient>) {
  const users: AuthUserSummary[] = []
  let page = 1
  const perPage = 1000

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage,
    })

    if (error) {
      throw new Error(error.message)
    }

    users.push(...((data.users ?? []) as AuthUserSummary[]))

    if (!data.users || data.users.length < perPage) {
      break
    }

    page += 1
  }

  return users
}

function countRowsByAccount(rows: Array<Record<string, unknown>>) {
  return rows.reduce((counts, row) => {
    if (typeof row.account_id === 'string') {
      counts.set(row.account_id, (counts.get(row.account_id) ?? 0) + 1)
    }

    return counts
  }, new Map<string, number>())
}

Deno.serve(async (req) => {
  const optionsResponse = handleOptions(req)

  if (optionsResponse) {
    return optionsResponse
  }

  try {
    const requester = await getAuthenticatedUser(req)
    const requesterEmail = requester.email?.toLowerCase() ?? ''

    if (!MASTER_SUPER_ADMIN_EMAILS.has(requesterEmail)) {
      return jsonResponse(
        {
          error: 'Only master super admins can view the full platform user list.',
        },
        { status: 403 },
      )
    }

    const supabase = createAdminClient()
    const [
      authUsers,
      accountRows,
      accountUserRows,
      planPricingRows,
      appointmentRows,
      proposalRows,
      emailEventRows,
      gmailSendRows,
    ] = await Promise.all([
      listAllAuthUsers(supabase),
      selectRows(supabase, 'accounts'),
      selectRows(supabase, 'account_users'),
      selectRows(supabase, 'plan_pricing'),
      selectRows(supabase, 'appointments'),
      selectRows(supabase, 'proposals'),
      selectRows(supabase, 'email_events'),
      selectRows(supabase, 'gmail_send_logs'),
    ])
    const accountsById = new Map(accountRows.map((row) => {
      const account = mapAccount(row)
      return [account.id, account] as const
    }))
    const membershipsByUserId = new Map(
      accountUserRows.map((row) => {
        const membership = mapAccountUser(row)
        return [membership.userId, membership] as const
      }),
    )
    const users = authUsers.map((user) => {
      const email = user.email?.toLowerCase() ?? ''
      const membership = membershipsByUserId.get(user.id)
      const account = membership
        ? accountsById.get(membership.accountId) ?? createFallbackAccount(user)
        : createFallbackAccount(user)

      accountsById.set(account.id, account)

      return {
        accountId: account.id,
        email,
        joinedAt: membership?.joinedAt ?? user.created_at ?? nowIso(),
        name: membership?.name || getUserName(user),
        role: normalizeRole(membership?.role, email),
        userId: user.id,
      }
    })
    const appointmentCounts = countRowsByAccount(appointmentRows)
    const proposalCounts = countRowsByAccount(proposalRows)
    const emailCounts = countRowsByAccount([...emailEventRows, ...gmailSendRows])
    const accounts = Array.from(accountsById.values()).map((account) => {
      const accountUsers = users.filter((user) => user.accountId === account.id)

      return {
        ...account,
        activeUsers: accountUsers.length,
        appointmentCount: appointmentCounts.get(account.id) ?? 0,
        emailCount: emailCounts.get(account.id) ?? 0,
        proposalCount: proposalCounts.get(account.id) ?? 0,
        users: accountUsers,
      }
    })
    const planPricing = planOptions.map((plan) => {
      const pricing = planPricingRows.map(mapPlanPricing).find((item) => item.plan === plan)
      return pricing ?? createDefaultPlanPricing(plan)
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

    return jsonResponse({
      accounts,
      metrics,
      planPricing,
    })
  } catch (error) {
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : 'Unable to load platform users.',
      },
      { status: 500 },
    )
  }
})
