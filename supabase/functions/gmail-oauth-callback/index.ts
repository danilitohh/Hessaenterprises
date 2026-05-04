import { encryptToken } from '../_shared/crypto.ts'
import { exchangeCodeForTokens, getGoogleUserInfo } from '../_shared/google.ts'
import { handleOptions, redirectResponse, redirectWithError } from '../_shared/http.ts'
import { createAdminClient } from '../_shared/supabase.ts'

Deno.serve(async (req) => {
  const optionsResponse = handleOptions(req)

  if (optionsResponse) {
    return optionsResponse
  }

  const requestUrl = new URL(req.url)
  const fallbackRedirect = Deno.env.get('APP_ORIGIN') ?? 'https://hessaenterprises.vercel.app'
  const code = requestUrl.searchParams.get('code')
  const state = requestUrl.searchParams.get('state')
  const oauthError = requestUrl.searchParams.get('error_description') ?? requestUrl.searchParams.get('error')

  if (!state) {
    return redirectWithError(fallbackRedirect, 'Missing Gmail OAuth state.')
  }

  const supabase = createAdminClient()
  const { data: storedState, error: stateError } = await supabase
    .from('gmail_oauth_states')
    .select('state,user_id,code_verifier,redirect_to,expires_at')
    .eq('state', state)
    .maybeSingle()

  if (stateError || !storedState) {
    return redirectWithError(fallbackRedirect, 'Gmail connection expired. Please try again.')
  }

  const redirectTo = storedState.redirect_to || fallbackRedirect

  try {
    if (oauthError) {
      throw new Error(oauthError)
    }

    if (!code) {
      throw new Error('Missing Gmail authorization code.')
    }

    if (new Date(storedState.expires_at).getTime() < Date.now()) {
      throw new Error('Gmail connection expired. Please try again.')
    }

    const tokens = await exchangeCodeForTokens(code, storedState.code_verifier)

    if (!tokens.refresh_token) {
      throw new Error('Google did not return a refresh token. Disconnect access in Google and try again.')
    }

    const profile = await getGoogleUserInfo(tokens.access_token)
    const encryptedRefreshToken = await encryptToken(tokens.refresh_token)

    const { error: upsertError } = await supabase.from('gmail_connections').upsert(
      {
        connected_at: new Date().toISOString(),
        email: profile.email,
        encrypted_refresh_token: encryptedRefreshToken,
        google_sub: profile.sub,
        revoked_at: null,
        scope: tokens.scope ?? 'https://www.googleapis.com/auth/gmail.send',
        updated_at: new Date().toISOString(),
        user_id: storedState.user_id,
      },
      { onConflict: 'user_id' },
    )

    if (upsertError) {
      throw new Error(upsertError.message)
    }

    await supabase.from('gmail_oauth_states').delete().eq('state', state)

    const successUrl = new URL(redirectTo)
    successUrl.searchParams.set('gmail', 'connected')
    successUrl.searchParams.delete('gmail_error')

    return redirectResponse(successUrl.toString())
  } catch (error) {
    await supabase.from('gmail_oauth_states').delete().eq('state', state)

    return redirectWithError(
      redirectTo,
      error instanceof Error ? error.message : 'Unable to finish Gmail connection.',
    )
  }
})
