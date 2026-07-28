'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
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

  function switchMode(next: Mode) {
    setMode(next)
    setError(null)
    setCheckInbox(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()

    if (mode === 'login') {
      const { error: err } = await supabase.auth.signInWithPassword({ email, password })
      if (err) {
        setError(friendlyError(err.code, err.message))
        setLoading(false)
        return
      }
      router.refresh()
      router.push('/app')
      return
    }

    // signup
    const { data, error: err } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // Used when email confirmation is ON — Supabase sends a link back to this route
        emailRedirectTo: `${window.location.origin}/auth/callback`,
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
      router.push('/app')
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
        redirectTo: `${window.location.origin}/auth/callback`,
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

  // ─── "Check your inbox" screen ──────────────────────────────────────────────
  if (checkInbox) {
    return (
      <main className="authPage">
        <div className="authCard">
          <Wordmark />
          <p className="authEyebrow">Almost there</p>
          <h1 className="authTitle">Check your inbox</h1>
          <p className="authMuted">
            We sent a confirmation link to <strong style={{ color: 'var(--text)' }}>{email}</strong>.
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

        {/* Mode toggle */}
        <div className="authToggle">
          <button
            className={mode === 'login' ? 'active' : ''}
            onClick={() => switchMode('login')}
            type="button"
          >
            Sign in
          </button>
          <button
            className={mode === 'signup' ? 'active' : ''}
            onClick={() => switchMode('signup')}
            type="button"
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

          {error && (
            <StatusText role="alert" style={{ marginTop: 'var(--space-3)' }}>{error}</StatusText>
          )}

          <Button
            type="submit"
            disabled={loading || !email || !password}
            block
            style={{ marginTop: 'var(--space-5)' }}
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
  return (
    <div className="authWordmark">
      CV<span className="dot">.</span>Tailor
    </div>
  )
}
