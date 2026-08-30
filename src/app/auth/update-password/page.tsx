'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Button from '@/components/ui/Button'
import Input from '@/components/ui/Input'
import StatusText from '@/components/ui/StatusText'

// Where the password-recovery email lands (after /auth/callback exchanges the
// code for a session): the user picks a new password. Also reachable while
// signed in normally, which simply changes the password.
//
// proxy.ts guards this path, so a visit without a session is redirected to
// login before render; the "no session" branch below is the belt to that
// brace for the moment a recovery link has expired mid-flight.

const MIN_PASSWORD = 8

export default function UpdatePasswordPage() {
  const router = useRouter()
  const [session, setSession] = useState<'checking' | 'ok' | 'none'>('checking')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const redirectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(({ data: { session: s } }) => setSession(s ? 'ok' : 'none'))
    return () => { if (redirectTimer.current) clearTimeout(redirectTimer.current) }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return
    if (password.length < MIN_PASSWORD) {
      setError(`Use at least ${MIN_PASSWORD} characters.`)
      return
    }
    if (password !== confirm) {
      setError("Those two passwords don't match.")
      return
    }
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const { error: err } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (err) {
      setError(
        err.code === 'same_password'
          ? 'That is already your password — choose a different one.'
          : err.code === 'weak_password'
            ? 'Password is too weak. Use at least 8 characters with a mix of letters and numbers.'
            : err.message || 'Could not update your password. Please try again.'
      )
      return
    }
    setDone(true)
    redirectTimer.current = setTimeout(() => router.push('/app'), 1500)
  }

  if (session === 'none') {
    return (
      <main className="authPage">
        <div className="authCard danger">
          <Link href="/" className="authWordmark authWordmarkLink">Jobhuntz</Link>
          <p className="authEyebrow danger">Link expired</p>
          <h1 className="authTitle">This reset link no longer works</h1>
          <p className="authMuted">
            Recovery links are single-use and expire after a short while. Request a new one from the
            sign-in page.
          </p>
          <Button href="/auth/login">Back to sign in</Button>
        </div>
      </main>
    )
  }

  if (done) {
    return (
      <main className="authPage">
        <div className="authCard">
          <Link href="/" className="authWordmark authWordmarkLink">Jobhuntz</Link>
          <p className="authEyebrow">Password updated</p>
          <h1 className="authTitle">You&apos;re all set</h1>
          <p className="authMuted">Your new password is saved. Taking you to the app…</p>
          <Button href="/app">Open the app</Button>
        </div>
      </main>
    )
  }

  return (
    <main className="authPage">
      <div className="authCard">
        <Link href="/" className="authWordmark authWordmarkLink">Jobhuntz</Link>
        <p className="authEyebrow">Password reset</p>
        <h1 className="authTitle">Choose a new password</h1>
        <p className="authMuted">At least {MIN_PASSWORD} characters. You&apos;ll stay signed in on this device.</p>

        <form onSubmit={handleSubmit} noValidate>
          <label className="authLabel">
            New password
            <Input
              variant="auth"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={`At least ${MIN_PASSWORD} characters`}
              required
              autoComplete="new-password"
              disabled={session === 'checking' || loading}
            />
          </label>
          <label className="authLabel">
            Confirm new password
            <Input
              variant="auth"
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              required
              autoComplete="new-password"
              disabled={session === 'checking' || loading}
            />
          </label>

          {error && <StatusText role="alert" className="msgBelow">{error}</StatusText>}

          <Button
            type="submit"
            block
            className="authSubmit"
            disabled={session !== 'ok' || loading || !password || !confirm}
          >
            {loading ? 'Saving…' : 'Save new password'}
          </Button>
        </form>
      </div>
    </main>
  )
}
