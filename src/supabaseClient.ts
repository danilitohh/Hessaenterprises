import { createClient } from '@supabase/supabase-js'

const LOCKED_SUPABASE_PROJECT_REF = 'eaocwrgbqeakyycmtbah'
const LOCKED_SUPABASE_URL = `https://${LOCKED_SUPABASE_PROJECT_REF}.supabase.co`

type SupabaseConfig = {
  anonKey: string
  error: string | null
  url: string
}

function createSupabaseConfig(): SupabaseConfig {
  const rawUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? ''
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? ''

  if (!rawUrl || !anonKey) {
    return {
      anonKey: '',
      error:
        'Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Vercel, then redeploy.',
      url: '',
    }
  }

  let url: URL

  try {
    url = new URL(rawUrl)
  } catch {
    return {
      anonKey: '',
      error: 'VITE_SUPABASE_URL is invalid. Use the locked Supabase project URL.',
      url: '',
    }
  }

  if (url.pathname !== '/' && url.pathname !== '') {
    return {
      anonKey: '',
      error: `VITE_SUPABASE_URL must be ${LOCKED_SUPABASE_URL}. Remove "${url.pathname}" from the end.`,
      url: '',
    }
  }

  if (url.origin !== LOCKED_SUPABASE_URL) {
    return {
      anonKey: '',
      error: `Supabase project is locked to ${LOCKED_SUPABASE_URL}. Do not change VITE_SUPABASE_URL without an intentional migration.`,
      url: '',
    }
  }

  if (
    anonKey.startsWith('sb_secret_') ||
    anonKey.startsWith('GOCSPX-') ||
    anonKey.startsWith('{') ||
    anonKey.includes('client_secret')
  ) {
    return {
      anonKey: '',
      error:
        'VITE_SUPABASE_ANON_KEY must be the Supabase publishable/anon public key, never a secret key or Google OAuth secret.',
      url: '',
    }
  }

  return {
    anonKey,
    error: null,
    url: url.origin,
  }
}

const supabaseConfig = createSupabaseConfig()

export const supabaseConfigError = supabaseConfig.error
export const isSupabaseConfigured = !supabaseConfigError
export const supabaseFunctionBaseUrl = `${LOCKED_SUPABASE_URL}/functions/v1`

export const supabase = isSupabaseConfigured
  ? createClient(supabaseConfig.url, supabaseConfig.anonKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true,
      },
    })
  : null

export function getSupabaseClient() {
  if (!supabase) {
    throw new Error(
      supabaseConfigError ||
        'Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Vercel, then redeploy.',
    )
  }

  return supabase
}
