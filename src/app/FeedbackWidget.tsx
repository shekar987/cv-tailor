"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Button from "@/components/ui/Button";
import Textarea from "@/components/ui/Textarea";
import FormField from "@/components/ui/FormField";
import StatusText from "@/components/ui/StatusText";

const MAX_MESSAGE = 2000;
const COUNTER_THRESHOLD = MAX_MESSAGE - 200; // only show the counter near the cap

// Mounted once in the root layout, so it appears at the bottom of every page.
// Self-checks the session (client-side getSession() is fine here — the
// project's "always getClaims()" rule is for Route Handlers, not client
// components) rather than threading auth state through layout.tsx, which
// stays a plain server component with no auth logic. Renders nothing for a
// signed-out visitor: no route-based special-casing needed, since /auth/*
// and the pre-login landing page all naturally have no session.
export default function FeedbackWidget() {
  const [signedIn, setSignedIn] = useState(false);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSignedIn(session !== null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(session !== null);
    });
    return () => sub.subscription.unsubscribe();
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
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not submit your feedback. Try again.");
        return;
      }
      setMessage("");
      setSent(true);
      setTimeout(() => setSent(false), 3000);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!signedIn) return null;

  return (
    <section className="feedbackWidget">
      <FormField label="Feedback" help="Bugs, ideas, anything — goes straight to the team.">
        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="What's working, what's not, what you'd like to see…"
          rows={3}
          maxLength={MAX_MESSAGE}
        />
        {message.length >= COUNTER_THRESHOLD && (
          <p className="cvHelp" style={{ marginBottom: 0, marginTop: "var(--space-1)" }}>
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
