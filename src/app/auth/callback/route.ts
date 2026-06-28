import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const oauthError = searchParams.get('error')
  // 'next' lets the login page say where to send the user after auth
  const next = searchParams.get('next') ?? '/app'

  // OAuth provider explicitly sent an error (user denied, app not approved, etc.)
  if (oauthError) {
    const params = new URLSearchParams({ error: oauthError })
    return NextResponse.redirect(`${origin}/auth/error?${params}`)
  }

  if (code) {
    const supabase = await createClient()
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)

    if (!exchangeError) {
      // Only allow redirecting within our own origin to prevent open-redirect attacks
      const safeNext = next.startsWith('/') ? next : '/app'
      return NextResponse.redirect(`${origin}${safeNext}`)
    }

    const params = new URLSearchParams({ error: exchangeError.message })
    return NextResponse.redirect(`${origin}/auth/error?${params}`)
  }

  // No code and no error — malformed callback URL
  return NextResponse.redirect(`${origin}/auth/error?error=missing_code`)
}
