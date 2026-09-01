'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { safeNextPath } from '@/lib/safeNext'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import StatusText from '@/components/ui/StatusText'

type Mode = 'login' | 'signup'

function friendlyError(code: string | undefined, message: string): string {
  switch (code) {
    case 'invalid_credentials':
      return 'Incorrect email or password.'
    case 'user_already_exists':
    case 'email_exists':
      return 'An account with this email already exists — try signing in instead.'
    case 'weak_password':
      return 'Password is too weak. Use at least 8 characters with a mix of letters and numbers.'
    case 'email_not_confirmed':
      return 'Please confirm your email address before signing in.'
    case 'signup_disabled':
      return 'New sign-ups are temporarily disabled. Please try again later.'
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return 'Too many attempts. Please wait a minute and try again.'
    case 'email_address_invalid':
      return 'Please enter a valid email address.'
    default:
      return message || 'Something went wrong. Please try again.'
  }
}

export default function LoginPage() {
  const router = useRouter()
  const [mode, setMode]               = useState<Mode>('login')
  const [email, setEmail]             = useState('')
  const [password, setPassword]       = useState('')
  const [loading, setLoading]         = useState(false)
  const [socialLoading, setSocialLoading] = useState<'google' | 'github' | null>(null)
  const [error, setError]             = useState<string | null>(null)
  const [checkInbox, setCheckInbox]   = useState(false)
  const [resetLoading, setResetLoading] = useState(false)
  const [resetSent, setResetSent]     = useState(false)

  function switchMode(next: Mode) {
    setMode(next)
    setError(null)
    setCheckInbox(false)
    setResetSent(false)
  }

  // Password recovery. Supabase emails a link that comes back through
  // /auth/callback (PKCE code exchange) and then lands on /auth/update-password
  // with a session, where the new password is set.
  async function handleForgotPassword() {
    if (loading || resetLoading) return
    if (!email.trim()) {
      setError('Enter your email address above first, then choose "Forgot password?".')
      return
    }
    setError(null)
    setResetLoading(true)
    const supabase = createClient()
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent('/auth/update-password')}`,
    })
    setResetLoading(false)
    if (err) {
      setError(friendlyError(err.code, err.message))
      return
    }
    setResetSent(true)
  }

  // Where to send the user after a successful sign-in. Set by proxy.ts when it
  // bounces an unauthenticated visit to a protected page (?next=/customize),
  // so logging in returns them there instead of always landing on /app.
  // Read directly from window.location rather than useSearchParams() so this
  // page can stay statically prerendered (useSearchParams needs a Suspense
  // boundary; this value is only needed inside event handlers, not on render).
  // Only a same-origin path is honoured — anyone can craft this link.
  function getSafeNext(): string {
    return safeNextPath(new URLSearchParams(window.location.search).get('next'))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    // The submit button is disabled while loading, but Enter in a field still
    // submits the form — repeated presses were tripping Supabase's rate limit.
    if (loading || socialLoading) return
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const safeNext = getSafeNext()

    if (mode === 'login') {
      const { error: err } = await supabase.auth.signInWithPassword({ email, password })
      if (err) {
        setError(friendlyError(err.code, err.message))
        setLoading(false)
        return
      }
      router.refresh()
      router.push(safeNext)
      return
    }

    // signup
    const { data, error: err } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // Used when email confirmation is ON — Supabase sends a link back to this route
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(safeNext)}`,
      },
    })

    if (err) {
      setError(friendlyError(err.code, err.message))
      setLoading(false)
      return
    }

    if (data.session) {
      // Email confirmation is OFF — user is immediately signed in
      router.refresh()
      router.push(safeNext)
      return
    }

    // Email confirmation is ON — session is null until the user clicks the link
    setCheckInbox(true)
    setLoading(false)
  }

  async function handleOAuth(provider: 'google' | 'github') {
    setSocialLoading(provider)
    setError(null)
    const supabase = createClient()
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        // Supabase redirects here after exchanging the OAuth code.
        // This URL must be in: Supabase Dashboard → Auth → URL Configuration → Redirect URLs
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(getSafeNext())}`,
      },
    })
    // If we reach this point the browser redirect didn't fire — provider not
    // configured in Supabase, or some other immediate error.
    if (err) {
      setError(`Could not sign in with ${provider === 'google' ? 'Google' : 'GitHub'}. Please try email instead.`)
      setSocialLoading(null)
    }
    // On success the browser navigates away — no cleanup needed.
  }

  // ─── "Reset link sent" screen ───────────────────────────────────────────────
  if (resetSent) {
    return (
      <main className="authPage">
        <div className="authCard">
          <Wordmark />
          <p className="authEyebrow">Password reset</p>
          <h1 className="authTitle">Check your inbox</h1>
          <p className="authMuted">
            If an account exists for <strong className="authStrong">{email}</strong>, we&apos;ve sent a
            link to choose a new password. It expires after a short while, so use it soon.
          </p>
          <button
            className="authLinkBtn"
            type="button"
            onClick={() => { setResetSent(false); setMode('login') }}
          >
            Back to sign in
          </button>
        </div>
      </main>
    )
  }

  // ─── "Check your inbox" screen ──────────────────────────────────────────────
  if (checkInbox) {
    return (
      <main className="authPage">
        <div className="authCard">
          <Wordmark />
          <p className="authEyebrow">Almost there</p>
          <h1 className="authTitle">Check your inbox</h1>
          <p className="authMuted">
            We sent a confirmation link to <strong className="authStrong">{email}</strong>.
            Click it to activate your account and sign in.
          </p>
          <button
            className="authLinkBtn"
            onClick={() => { setCheckInbox(false); setMode('login') }}
          >
            Back to sign in
          </button>
        </div>
      </main>
    )
  }

  // ─── Main form ──────────────────────────────────────────────────────────────
  return (
    <main className="authPage">
      <div className="authCard">
        <Wordmark />
        <h1 className="authTitle">{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
        <p className="authMuted">
          {mode === 'login'
            ? 'Sign in to pick up your master CV and applications.'
            : 'Free to start — three tailored CVs on us, then bring your own key.'}
        </p>

        {/* Mode toggle */}
        <div className="authToggle" role="group" aria-label="Sign in or create an account">
          <button
            className={mode === 'login' ? 'active' : ''}
            onClick={() => switchMode('login')}
            type="button"
            aria-pressed={mode === 'login'}
          >
            Sign in
          </button>
          <button
            className={mode === 'signup' ? 'active' : ''}
            onClick={() => switchMode('signup')}
            type="button"
            aria-pressed={mode === 'signup'}
          >
            Create account
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <label className="authLabel">
            Email
            <Input
              variant="auth"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
            />
          </label>

          <label className="authLabel">
            Password
            <Input
              variant="auth"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={mode === 'signup' ? 'At least 8 characters' : ''}
              required
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </label>

          {mode === 'login' && (
            <div className="authForgotRow">
              <button
                type="button"
                className="authLinkBtn authForgot"
                onClick={handleForgotPassword}
                disabled={loading || resetLoading}
              >
                {resetLoading ? 'Sending reset link…' : 'Forgot password?'}
              </button>
            </div>
          )}

          {error && (
            <StatusText role="alert" className="msgBelow">{error}</StatusText>
          )}

          <Button
            type="submit"
            disabled={loading || !email || !password}
            block
            className="authSubmit"
          >
            {loading
              ? (mode === 'login' ? 'Signing in…' : 'Creating account…')
              : (mode === 'login' ? 'Sign in' : 'Create account')}
          </Button>
        </form>

        {/* ── Social login ───────────────────────────────────────────────────── */}
        <div className="authDivider">
          <span className="authDividerLine" />
          <span className="authDividerText">or continue with</span>
          <span className="authDividerLine" />
        </div>

        <div className="authSocialRow">
          <button
            type="button"
            onClick={() => handleOAuth('google')}
            disabled={loading || socialLoading !== null}
            className="authSocialBtn"
          >
            {socialLoading === 'google' ? 'Redirecting…' : 'Google'}
          </button>
          <button
            type="button"
            onClick={() => handleOAuth('github')}
            disabled={loading || socialLoading !== null}
            className="authSocialBtn"
          >
            {socialLoading === 'github' ? 'Redirecting…' : 'GitHub'}
          </button>
        </div>

      </div>
    </main>
  )
}

function Wordmark() {
  // A real link home — the auth screens previously had no way back to "/".
  return (
    <Link href="/" className="authWordmark authWordmarkLink">
      Jobhuntz
    </Link>
  )
}
