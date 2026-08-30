import Link from "next/link";
import Button from "@/components/ui/Button";

export default function NotFound() {
  return (
    <main className="authPage">
      <div className="authCard">
        <Link href="/" className="authWordmark authWordmarkLink">Jobhuntz</Link>
        <p className="authEyebrow">404</p>
        <h1 className="authTitle">That page doesn&apos;t exist</h1>
        <p className="authMuted">
          The link may be old or mistyped. Everything you need is one click away.
        </p>
        <div className="actions" style={{ marginTop: 0 }}>
          <Button href="/app">Open the app</Button>
          <Button variant="secondary" href="/">Home</Button>
        </div>
      </div>
    </main>
  );
}
