"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { MAX_FEEDBACK_CHARS } from "@/lib/limits";
import Button from "@/components/ui/Button";
import Textarea from "@/components/ui/Textarea";
import FormField from "@/components/ui/FormField";
import StatusText from "@/components/ui/StatusText";

const MAX_MESSAGE = MAX_FEEDBACK_CHARS;
const COUNTER_THRESHOLD = MAX_MESSAGE - 200; // only show the counter near the cap

// Pages that get the widget. The landing page and the auth screens don't:
// a signed-in visitor to "/" was getting a feedback card under the marketing
// footer, in a different container width.
const APP_ROUTES = ["/app", "/customize", "/settings", "/applications"];

// Mounted once in the root layout. Self-checks the session (client-side
// getSession() is fine here — the project's "always getClaims()" rule is for
// Route Handlers, not client components) rather than threading auth state
// through layout.tsx, which stays a plain server component with no auth logic.
export default function FeedbackWidget() {
  const pathname = usePathname();
  const [signedIn, setSignedIn] = useState(false);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const sentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSignedIn(session !== null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(session !== null);
    });
    return () => {
      sub.subscription.unsubscribe();
      if (sentTimer.current) clearTimeout(sentTimer.current);
    };
  }, []);

  async function handleSubmit() {
    if (!message.trim() || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not submit your feedback. Try again.");
        return;
      }
      setMessage("");
      setSent(true);
      if (sentTimer.current) clearTimeout(sentTimer.current);
      sentTimer.current = setTimeout(() => setSent(false), 3000);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const onAppRoute = APP_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`));
  if (!signedIn || !onAppRoute) return null;

  return (
    <section className="feedbackWidget" aria-labelledby="feedback-label">
      <FormField label={<span id="feedback-label">Feedback</span>} htmlFor="feedback-message" help="Bugs, ideas, anything — goes straight to the team.">
        <Textarea
          id="feedback-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="What's working, what's not, what you'd like to see…"
          rows={3}
          maxLength={MAX_MESSAGE}
        />
        {message.length >= COUNTER_THRESHOLD && (
          <p className="charCount" aria-live="polite">
            {message.length}/{MAX_MESSAGE}
          </p>
        )}
      </FormField>
      <div className="actions">
        <Button
          type="button"
          onClick={handleSubmit}
          disabled={!message.trim() || submitting}
          variant="secondary"
        >
          {submitting ? "Sending…" : "Send feedback"}
        </Button>
        {sent && <StatusText as="span" tone="success" role="status">Thanks — got it.</StatusText>}
        {error && <StatusText as="span" role="alert">{error}</StatusText>}
      </div>
    </section>
  );
}
