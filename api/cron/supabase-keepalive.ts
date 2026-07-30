declare const process: {
  env: Record<string, string | undefined>
}

// Vercel cron endpoint that keeps the Supabase project warm.
const LOCKED_SUPABASE_URL = 'https://eaocwrgbqeakyycmtbah.supabase.co'

export const config = {
  runtime: 'edge',
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
}

function getSupabaseUrl() {
  return (
    process.env.SUPABASE_URL?.trim() ||
    process.env.VITE_SUPABASE_URL?.trim() ||
    LOCKED_SUPABASE_URL
  ).replace(/\/$/, '')
}

function getSupabaseServiceKey() {
  return (
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    ''
  )
}

// Validate the cron secret and perform a lightweight authenticated ping.
export default async function handler(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim()
  const serviceKey = getSupabaseServiceKey()

  if (!cronSecret) {
    return jsonResponse({ error: 'CRON_SECRET is required.' }, { status: 500 })
  }

  if (!serviceKey) {
    return jsonResponse(
      { error: 'SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY is required.' },
      { status: 500 },
    )
  }

  if (request.method !== 'GET' && request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, { status: 405 })
  }

  if (request.headers.get('Authorization') !== `Bearer ${cronSecret}`) {
    return jsonResponse({ error: 'Unauthorized.' }, { status: 401 })
  }

  const response = await fetch(`${getSupabaseUrl()}/rest/v1/plan_pricing?select=plan&limit=1`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Prefer: 'return=minimal',
    },
    method: 'GET',
  })

  if (!response.ok) {
    const detail = await response.text()

    return jsonResponse(
      {
        error: 'Supabase keepalive ping failed.',
        status: response.status,
        detail,
      },
      { status: response.status },
    )
  }

  return jsonResponse({
    ok: true,
    pingedAt: new Date().toISOString(),
    status: response.status,
  })
}
