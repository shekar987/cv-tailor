import Link from 'next/link'

const ERROR_MESSAGES: Record<string, string> = {
  access_denied: 'You cancelled the login or the app doesn\'t have permission from the provider.',
  missing_code:  'The login link was incomplete or has already been used.',
}

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams
  const message = error
    ? (ERROR_MESSAGES[error] ?? `Login failed: ${error}`)
    : 'Something went wrong during sign-in. Please try again.'

  return (
    <main style={{
      minHeight: '100vh',
      background: 'var(--bg)',
      color: 'var(--text)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px 24px',
      fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    }}>
      <div style={{ maxWidth: 460, width: '100%' }}>

        <div style={{ marginBottom: 32 }}>
          <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>
            CV<span style={{ color: 'var(--amber)' }}>.</span>Tailor
          </span>
        </div>

        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderLeft: '3px solid #E5736B',
          borderRadius: 14,
          padding: '28px 28px',
        }}>
          <p style={{
            fontSize: 12,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: '#E5736B',
            marginBottom: 12,
            fontWeight: 600,
          }}>
            Sign-in error
          </p>

          <h1 style={{
            fontSize: 20,
            fontWeight: 700,
            letterSpacing: '-0.02em',
            marginBottom: 12,
          }}>
            We couldn&apos;t sign you in
          </h1>

          <p style={{
            fontSize: 14,
            lineHeight: 1.6,
            color: 'var(--muted)',
            marginBottom: 28,
          }}>
            {message}
          </p>

          <Link
            href="/auth/login"
            style={{
              display: 'inline-block',
              background: 'var(--amber)',
              color: '#1A1206',
              border: 'none',
              borderRadius: 10,
              padding: '10px 20px',
              fontSize: 14,
              fontWeight: 600,
              textDecoration: 'none',
              cursor: 'pointer',
            }}
          >
            Back to sign in
          </Link>
        </div>

        <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 20, textAlign: 'center' }}>
          If this keeps happening, make sure you&apos;re using the right account.
        </p>
      </div>
    </main>
  )
}
