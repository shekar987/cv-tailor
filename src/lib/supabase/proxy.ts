import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { supabaseUrl, supabasePublishableKey } from './env'

// Signed-in-only pages. /settings is included because it hosts the API-key
// form: guarding it here redirects before render, instead of letting the page
// mount and bounce from the client (which flashes the UI to a stranger).
// Matched per path segment, so '/app' guards /app and /app/… but not a future
// /apply or /appearance. /auth/update-password needs the session the recovery
// link's code exchange creates, so it is guarded too.
const PROTECTED_PREFIXES = ['/app', '/settings', '/customize', '/applications', '/auth/update-password']

function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    supabaseUrl(),
    supabasePublishableKey(),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // IMPORTANT: Do not add any code between createServerClient and getClaims().
  // Doing so can cause subtle session bugs that are very hard to debug.
  const { data } = await supabase.auth.getClaims()
  const user = data?.claims

  const { pathname } = request.nextUrl

  if (isProtectedPath(pathname) && !user) {
    const url = request.nextUrl.clone()
    // Preserve where the user was headed so login can send them back there
    // instead of always dropping them on /app.
    const dest = pathname + request.nextUrl.search
    url.pathname = '/auth/login'
    url.search = ''
    url.searchParams.set('next', dest)
    return NextResponse.redirect(url)
  }

  // IMPORTANT: return supabaseResponse as-is. Never replace it with a plain
  // NextResponse.next() — that would drop the refreshed session cookies and
  // randomly log users out.
  return supabaseResponse
}
