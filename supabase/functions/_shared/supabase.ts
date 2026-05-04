import { createClient } from 'npm:@supabase/supabase-js@2'
import { getRequiredEnv } from './env.ts'

function getSupabaseAdminKey() {
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SECRET_KEY')

  if (!key) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY.')
  }

  return key
}

function getSupabasePublicKey() {
  const key = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')

  if (!key) {
    throw new Error('Missing SUPABASE_ANON_KEY or SUPABASE_PUBLISHABLE_KEY.')
  }

  return key
}

export function createAdminClient() {
  return createClient(getRequiredEnv('SUPABASE_URL'), getSupabaseAdminKey(), {
    auth: {
      persistSession: false,
    },
  })
}

export async function getAuthenticatedUser(req: Request) {
  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.replace('Bearer ', '').trim()

  if (!token) {
    throw new Error('Missing Supabase authorization token.')
  }

  const supabase = createClient(getRequiredEnv('SUPABASE_URL'), getSupabasePublicKey(), {
    auth: {
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: authHeader,
      },
    },
  })

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token)

  if (error || !user) {
    throw new Error(error?.message ?? 'Unable to verify the current user.')
  }

  return user
}
