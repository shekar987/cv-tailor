'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

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
      <main style={styles.page}>
        <div style={styles.card}>
          <Wordmark />
          <p style={styles.cardEyebrow}>Almost there</p>
          <h1 style={styles.cardTitle}>Check your inbox</h1>
          <p style={{ ...styles.muted, marginBottom: 24 }}>
            We sent a confirmation link to <strong style={{ color: 'var(--text)' }}>{email}</strong>.
            Click it to activate your account and sign in.
          </p>
          <button
            style={styles.linkBtn}
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
    <main style={styles.page}>
      <div style={styles.card}>
        <Wordmark />

        {/* Mode toggle */}
        <div style={styles.toggle}>
          <button
            style={mode === 'login' ? styles.toggleActive : styles.toggleInactive}
            onClick={() => switchMode('login')}
            type="button"
          >
            Sign in
          </button>
          <button
            style={mode === 'signup' ? styles.toggleActive : styles.toggleInactive}
            onClick={() => switchMode('signup')}
            type="button"
          >
            Create account
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <label style={styles.label}>
            Email
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
              style={styles.input}
            />
          </label>

          <label style={{ ...styles.label, marginTop: 14 }}>
            Password
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={mode === 'signup' ? 'At least 8 characters' : ''}
              required
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              style={styles.input}
            />
          </label>

          {error && (
            <p role="alert" style={styles.error}>{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !email || !password}
            style={{ ...styles.cta, marginTop: 20 }}
          >
            {loading
              ? (mode === 'login' ? 'Signing in…' : 'Creating account…')
              : (mode === 'login' ? 'Sign in' : 'Create account')}
          </button>
        </form>

        {/* ── Social login placeholder — wired up in Step 6 ─────────────────── */}
        <div style={styles.dividerRow}>
          <span style={styles.dividerLine} />
          <span style={styles.dividerText}>or continue with</span>
          <span style={styles.dividerLine} />
        </div>

        <div style={styles.socialRow}>
          <button
            type="button"
            onClick={() => handleOAuth('google')}
            disabled={loading || socialLoading !== null}
            style={{
              ...styles.socialBtn,
              opacity: loading || socialLoading !== null ? 0.6 : 1,
              cursor: loading || socialLoading !== null ? 'wait' : 'pointer',
              color: 'var(--text)',
            }}
          >
            {socialLoading === 'google' ? 'Redirecting…' : 'Google'}
          </button>
          <button
            type="button"
            onClick={() => handleOAuth('github')}
            disabled={loading || socialLoading !== null}
            style={{
              ...styles.socialBtn,
              opacity: loading || socialLoading !== null ? 0.6 : 1,
              cursor: loading || socialLoading !== null ? 'wait' : 'pointer',
              color: 'var(--text)',
            }}
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
    <div style={{ marginBottom: 28 }}>
      <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>
        CV<span style={{ color: 'var(--amber)' }}>.</span>Tailor
      </span>
    </div>
  )
}

// ─── Styles (uses CSS variables from globals.css) ────────────────────────────

const styles = {
  page: {
    minHeight: '100vh',
    background: 'var(--bg)',
    color: 'var(--text)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '40px 24px',
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  } as React.CSSProperties,

  card: {
    width: '100%',
    maxWidth: 420,
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 16,
    padding: '32px 32px 28px',
  } as React.CSSProperties,

  cardEyebrow: {
    fontSize: 12,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    color: 'var(--amber)',
    marginBottom: 8,
    fontWeight: 600,
  } as React.CSSProperties,

  cardTitle: {
    fontSize: 22,
    fontWeight: 700,
    letterSpacing: '-0.02em',
    marginBottom: 12,
  } as React.CSSProperties,

  toggle: {
    display: 'flex',
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: 3,
    marginBottom: 24,
    gap: 3,
  } as React.CSSProperties,

  toggleActive: {
    flex: 1,
    padding: '7px 0',
    fontSize: 14,
    fontWeight: 600,
    background: 'var(--surface-2)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    color: 'var(--text)',
    cursor: 'pointer',
    transition: 'background 0.15s',
  } as React.CSSProperties,

  toggleInactive: {
    flex: 1,
    padding: '7px 0',
    fontSize: 14,
    fontWeight: 400,
    background: 'transparent',
    border: '1px solid transparent',
    borderRadius: 8,
    color: 'var(--muted)',
    cursor: 'pointer',
    transition: 'color 0.15s',
  } as React.CSSProperties,

  label: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
    fontSize: 13,
    color: 'var(--muted)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
  } as React.CSSProperties,

  input: {
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    color: 'var(--text)',
    padding: '10px 12px',
    fontSize: 15,
    fontFamily: 'inherit',
    outline: 'none',
    width: '100%',
  } as React.CSSProperties,

  error: {
    color: '#E5736B',
    fontSize: 13,
    lineHeight: 1.5,
    marginTop: 12,
    padding: '10px 12px',
    background: 'rgba(229,115,107,0.08)',
    borderRadius: 8,
    border: '1px solid rgba(229,115,107,0.2)',
  } as React.CSSProperties,

  cta: {
    width: '100%',
    background: 'var(--amber)',
    color: '#1A1206',
    border: 'none',
    borderRadius: 10,
    padding: '11px 0',
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'background 0.15s',
    opacity: 1,
  } as React.CSSProperties,

  dividerRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    margin: '24px 0 16px',
  } as React.CSSProperties,

  dividerLine: {
    flex: 1,
    height: 1,
    background: 'var(--border)',
    display: 'block',
  } as React.CSSProperties,

  dividerText: {
    fontSize: 12,
    color: 'var(--muted)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    whiteSpace: 'nowrap' as const,
  } as React.CSSProperties,

  socialRow: {
    display: 'flex',
    gap: 10,
  } as React.CSSProperties,

  socialBtn: {
    flex: 1,
    padding: '10px 0',
    fontSize: 14,
    fontWeight: 500,
    background: 'transparent',
    border: '1px solid var(--border)',
    borderRadius: 9,
    color: 'var(--text)',
    fontFamily: 'inherit',
    transition: 'border-color 0.15s',
  } as React.CSSProperties,

  muted: {
    fontSize: 14,
    color: 'var(--muted)',
    lineHeight: 1.6,
  } as React.CSSProperties,

  linkBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--amber)',
    fontSize: 14,
    cursor: 'pointer',
    padding: 0,
    fontFamily: 'inherit',
    textDecoration: 'underline',
  } as React.CSSProperties,
} as const
