import Button from '@/components/ui/Button'

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
    <main className="authPage">
      <div style={{ maxWidth: 460, width: '100%' }}>
        <div className="authWordmark" style={{ marginBottom: 'var(--space-8)' }}>
          Jobhuntz
        </div>

        <div className="authCard danger" style={{ maxWidth: 'none' }}>
          <p className="authEyebrow danger">Sign-in error</p>
          <h1 className="authTitle">We couldn&apos;t sign you in</h1>
          <p className="authMuted">{message}</p>
          <Button href="/auth/login">
            Back to sign in
          </Button>
        </div>

        <p className="cvHelp" style={{ marginTop: 'var(--space-5)', textAlign: 'center' }}>
          If this keeps happening, make sure you&apos;re using the right account.
        </p>
      </div>
    </main>
  )
}
