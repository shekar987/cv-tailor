"use client";

import { useEffect } from "react";
import Button from "@/components/ui/Button";

// Route-level error boundary. Every page is a client component doing async
// work; without this, a thrown render error shows Next's unbranded
// "Application error" screen with no way back.
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Page error:", error.message);
  }, [error]);

  return (
    <main className="authPage">
      <div className="authCard danger">
        <p className="authEyebrow danger">Something went wrong</p>
        <h1 className="authTitle">This page hit an error</h1>
        <p className="authMuted">
          Your saved CV and applications are safe — this only affects what&apos;s on screen. Try
          again, or head back to the app.
        </p>
        <div className="actions" style={{ marginTop: 0 }}>
          <Button onClick={reset}>Try again</Button>
          <Button variant="secondary" href="/app">Back to app</Button>
        </div>
      </div>
    </main>
  );
}
