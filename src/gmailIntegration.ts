import { getSupabaseClient } from './supabaseClient'

export type GmailConnectionStatus = {
  connected: boolean
  connectedAt: string | null
  email: string | null
  mode: 'draft' | 'gmail'
}

type GmailOAuthStartResponse = {
  authUrl: string
}

function getCurrentRedirectUrl() {
  const url = new URL(window.location.href)
  url.searchParams.set('gmail', 'connected')
  url.searchParams.delete('error')
  url.hash = ''
  return url.toString()
}

export async function getGmailConnectionStatus(): Promise<GmailConnectionStatus> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase.functions.invoke<GmailConnectionStatus>('gmail-status')

  if (error) {
    throw new Error(error.message)
  }

  return (
    data ?? {
      connected: false,
      connectedAt: null,
      email: null,
      mode: 'draft',
    }
  )
}

export async function connectGmailAccount() {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase.functions.invoke<GmailOAuthStartResponse>(
    'gmail-oauth-start',
    {
      body: {
        redirectTo: getCurrentRedirectUrl(),
      },
    },
  )

  if (error) {
    if (error.message.includes('Failed to send a request to the Edge Function')) {
      throw new Error(
        'Gmail Edge Functions are not deployed yet. Deploy gmail-oauth-start and the related Gmail functions in Supabase, then try again.',
      )
    }

    throw new Error(error.message)
  }

  if (!data?.authUrl) {
    throw new Error('Gmail connection did not return an authorization URL.')
  }

  window.location.href = data.authUrl
}

export async function disconnectGmailAccount() {
  const supabase = getSupabaseClient()
  const { error } = await supabase.functions.invoke('gmail-disconnect', {
    body: {},
  })

  if (error) {
    throw new Error(error.message)
  }
}
