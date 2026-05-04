import { handleOptions, jsonResponse } from '../_shared/http.ts'
import { createAdminClient, getAuthenticatedUser } from '../_shared/supabase.ts'

Deno.serve(async (req) => {
  const optionsResponse = handleOptions(req)

  if (optionsResponse) {
    return optionsResponse
  }

  try {
    const user = await getAuthenticatedUser(req)
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('gmail_connections')
      .select('email,connected_at,revoked_at')
      .eq('user_id', user.id)
      .is('revoked_at', null)
      .maybeSingle()

    if (error) {
      throw new Error(error.message)
    }

    return jsonResponse({
      connected: Boolean(data),
      connectedAt: data?.connected_at ?? null,
      email: data?.email ?? null,
      mode: data ? 'gmail' : 'draft',
    })
  } catch (error) {
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : 'Unable to read Gmail connection.',
      },
      { status: 400 },
    )
  }
})
