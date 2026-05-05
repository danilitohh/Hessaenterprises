import { assertAllowedRedirect } from '../_shared/env.ts'
import { createGoogleAuthUrl, createOAuthCodeVerifier, createOAuthState } from '../_shared/google.ts'
import { handleOptions, jsonResponse } from '../_shared/http.ts'
import {
  createAdminClient,
  getAuthenticatedUser,
  getUserPrimaryAccountId,
} from '../_shared/supabase.ts'

Deno.serve(async (req) => {
  const optionsResponse = handleOptions(req)

  if (optionsResponse) {
    return optionsResponse
  }

  try {
    const user = await getAuthenticatedUser(req)
    const { redirectTo } = await req.json()

    if (typeof redirectTo !== 'string') {
      throw new Error('Missing redirect URL.')
    }

    const safeRedirectTo = assertAllowedRedirect(redirectTo)
    const state = createOAuthState()
    const codeVerifier = createOAuthCodeVerifier()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()
    const supabase = createAdminClient()
    const accountId = await getUserPrimaryAccountId(supabase, user.id)

    await supabase.from('gmail_oauth_states').delete().lt('expires_at', new Date().toISOString())

    const { error } = await supabase.from('gmail_oauth_states').insert({
      account_id: accountId,
      code_verifier: codeVerifier,
      expires_at: expiresAt,
      redirect_to: safeRedirectTo,
      state,
      user_id: user.id,
    })

    if (error) {
      throw new Error(error.message)
    }

    const authUrl = await createGoogleAuthUrl(state, codeVerifier)

    return jsonResponse({ authUrl })
  } catch (error) {
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : 'Unable to start Gmail connection.',
      },
      { status: 400 },
    )
  }
})
