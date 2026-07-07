"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type Provider = "gemini" | "openrouter";
type SlotStatus = "idle" | "saving" | "error";
type SavedKey = { hint: string; updatedAt: string };

const SLOTS: {
  label: string;
  provider: Provider;
  providerDisplay: string;
  howToSteps: string[];
  linkUrl: string;
  linkText: string;
}[] = [
  {
    label: "API Key 1",
    provider: "gemini",
    providerDisplay: "Google AI Studio (Gemini)",
    howToSteps: [
      "Open Google AI Studio at aistudio.google.com/app/apikey",
      "Sign in with your Google account",
      'Click "Create API key" and select a project (or create one)',
      "Copy the key — it typically starts with AIza… or AQ…",
      "Paste it in the field below",
    ],
    linkUrl: "https://aistudio.google.com/app/apikey",
    linkText: "Open Google AI Studio →",
  },
  {
    label: "API Key 2",
    provider: "openrouter",
    providerDisplay: "OpenRouter",
    howToSteps: [
      "Go to openrouter.ai and sign in (or create a free account)",
      'Click your avatar in the top-right → "Keys"',
      'Click "Create key", give it a name (e.g. "CV Tailor")',
      "Copy the key — it starts with sk-or-v1-",
      "Paste it in the field below",
    ],
    linkUrl: "https://openrouter.ai/keys",
    linkText: "Open OpenRouter →",
  },
];

export default function SettingsPage() {
  const router = useRouter();
  const [loaded, setLoaded] = useState(false);
  const [savedKeys, setSavedKeys] = useState<Record<Provider, SavedKey | null>>({
    gemini: null,
    openrouter: null,
  });
  const [inputValues, setInputValues] = useState<Record<Provider, string>>({
    gemini: "",
    openrouter: "",
  });
  const [showInput, setShowInput] = useState<Record<Provider, boolean>>({
    gemini: false,
    openrouter: false,
  });
  const [status, setStatus] = useState<Record<Provider, SlotStatus>>({
    gemini: "idle",
    openrouter: "idle",
  });
  const [slotErrors, setSlotErrors] = useState<Record<Provider, string>>({
    gemini: "",
    openrouter: "",
  });

  useEffect(() => {
    async function init() {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.replace("/auth/login");
        return;
      }
      // SELECT only the non-revoked columns — key_enc is blocked at the column level
      const { data, error } = await supabase
        .from("user_api_keys")
        .select("provider, key_hint, updated_at");

      if (!error && data) {
        const map: Record<Provider, SavedKey | null> = { gemini: null, openrouter: null };
        for (const row of data) {
          if (row.provider === "gemini" || row.provider === "openrouter") {
            map[row.provider as Provider] = { hint: row.key_hint, updatedAt: row.updated_at };
          }
        }
        setSavedKeys(map);
      }
      setLoaded(true);
    }
    init();
  }, [router]);

  async function handleSave(provider: Provider) {
    const key = inputValues[provider].trim();
    if (!key) return;

    setStatus(s => ({ ...s, [provider]: "saving" }));
    setSlotErrors(e => ({ ...e, [provider]: "" }));

    const res = await fetch("/api/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // key value goes in the request body; never logged or displayed
      body: JSON.stringify({ provider, key }),
    });
    const data = await res.json();

    if (!res.ok) {
      setStatus(s => ({ ...s, [provider]: "error" }));
      setSlotErrors(e => ({ ...e, [provider]: data.error || "Failed to save key." }));
      return;
    }

    setSavedKeys(s => ({ ...s, [provider]: { hint: data.key_hint, updatedAt: data.updated_at } }));
    setInputValues(v => ({ ...v, [provider]: "" }));
    setShowInput(si => ({ ...si, [provider]: false }));
    setStatus(s => ({ ...s, [provider]: "idle" }));
  }

  async function handleRemove(provider: Provider) {
    setStatus(s => ({ ...s, [provider]: "saving" }));
    setSlotErrors(e => ({ ...e, [provider]: "" }));

    const res = await fetch(`/api/keys?provider=${provider}`, { method: "DELETE" });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setStatus(s => ({ ...s, [provider]: "error" }));
      setSlotErrors(e => ({ ...e, [provider]: data.error || "Failed to remove key." }));
      return;
    }

    setSavedKeys(s => ({ ...s, [provider]: null }));
    setShowInput(si => ({ ...si, [provider]: false }));
    setInputValues(v => ({ ...v, [provider]: "" }));
    setStatus(s => ({ ...s, [provider]: "idle" }));
  }

  function cancelReplace(provider: Provider) {
    setShowInput(si => ({ ...si, [provider]: false }));
    setInputValues(v => ({ ...v, [provider]: "" }));
    setSlotErrors(e => ({ ...e, [provider]: "" }));
    setStatus(st => ({ ...st, [provider]: "idle" }));
  }

  if (!loaded) {
    return (
      <main style={st.page}>
        <p style={{ color: "var(--muted)", fontSize: 14 }}>Loading…</p>
      </main>
    );
  }

  return (
    <main style={st.page}>
      <div style={st.container}>
        {/* Nav bar */}
        <div style={st.nav}>
          <span style={st.wordmark}>
            CV<span style={{ color: "var(--amber)" }}>.</span>Tailor
          </span>
          <Link href="/app" style={st.navLink}>← Back to app</Link>
        </div>

        <h1 style={st.heading}>API Keys</h1>
        <p style={st.subtext}>
          Add your own AI provider keys to keep tailoring after your free credits run out.
          Keys are encrypted before storage and are never shown in full after saving.
        </p>

        <div style={st.slotList}>
          {SLOTS.map((slot) => {
            const saved = savedKeys[slot.provider];
            const isBusy = status[slot.provider] === "saving";
            const err = slotErrors[slot.provider];
            const isReplacing = showInput[slot.provider];
            const showInputField = !saved || isReplacing;

            return (
              <div key={slot.provider} style={st.card}>
                {/* Card header — slot label + masked badge */}
                <div style={st.cardHeader}>
                  <span style={st.slotLabel}>{slot.label}</span>
                  {saved && !isReplacing && (
                    <span style={st.savedBadge}>✓ Saved ••••{saved.hint}</span>
                  )}
                </div>

                {/* Collapsible how-to — provider name only appears here */}
                <details style={st.details}>
                  <summary style={st.summary}>
                    How to get this key ({slot.providerDisplay}) →
                  </summary>
                  <div style={st.howToBox}>
                    <ol style={st.howToList}>
                      {slot.howToSteps.map((step, i) => (
                        <li key={i} style={st.howToItem}>{step}</li>
                      ))}
                    </ol>
                    <a
                      href={slot.linkUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={st.howToLink}
                    >
                      {slot.linkText}
                    </a>
                  </div>
                </details>

                {/* Key input — visible when no key saved yet, or during Replace */}
                {showInputField && (
                  <div style={{ marginTop: 14 }}>
                    <input
                      type="password"
                      value={inputValues[slot.provider]}
                      onChange={e =>
                        setInputValues(v => ({ ...v, [slot.provider]: e.target.value }))
                      }
                      onKeyDown={e => { if (e.key === "Enter") handleSave(slot.provider); }}
                      placeholder="Paste your key here…"
                      disabled={isBusy}
                      autoComplete="off"
                      spellCheck={false}
                      style={st.input}
                    />
                    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                      <button
                        onClick={() => handleSave(slot.provider)}
                        disabled={isBusy || !inputValues[slot.provider].trim()}
                        style={{
                          ...st.ctaBtn,
                          opacity: isBusy || !inputValues[slot.provider].trim() ? 0.55 : 1,
                          cursor: isBusy || !inputValues[slot.provider].trim() ? "not-allowed" : "pointer",
                        }}
                      >
                        {isBusy ? "Saving…" : "Save key"}
                      </button>
                      {isReplacing && (
                        <button
                          onClick={() => cancelReplace(slot.provider)}
                          disabled={isBusy}
                          style={st.ghostBtn}
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Replace / Remove actions — only when key is saved and not replacing */}
                {saved && !isReplacing && (
                  <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                    <button
                      onClick={() => setShowInput(si => ({ ...si, [slot.provider]: true }))}
                      disabled={isBusy}
                      style={st.ghostBtn}
                    >
                      Replace
                    </button>
                    <button
                      onClick={() => handleRemove(slot.provider)}
                      disabled={isBusy}
                      style={{ ...st.ghostBtn, color: "#E5736B", borderColor: "rgba(229,115,107,0.3)" }}
                    >
                      {isBusy ? "Removing…" : "Remove"}
                    </button>
                  </div>
                )}

                {/* Per-slot error */}
                {err && (
                  <p role="alert" style={st.errText}>{err}</p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const st = {
  page: {
    minHeight: "100vh",
    background: "var(--bg)",
    color: "var(--text)",
    padding: "40px 24px 96px",
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  } as React.CSSProperties,

  container: {
    maxWidth: 560,
    margin: "0 auto",
  } as React.CSSProperties,

  nav: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 40,
  } as React.CSSProperties,

  wordmark: {
    fontSize: 22,
    fontWeight: 700,
    letterSpacing: "-0.02em",
  } as React.CSSProperties,

  navLink: {
    fontSize: 13,
    color: "var(--muted)" as string,
    textDecoration: "none",
  } as React.CSSProperties,

  heading: {
    fontSize: 26,
    fontWeight: 700,
    letterSpacing: "-0.02em",
    marginBottom: 10,
  } as React.CSSProperties,

  subtext: {
    fontSize: 14,
    color: "var(--muted)" as string,
    lineHeight: 1.6,
    marginBottom: 32,
  } as React.CSSProperties,

  slotList: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 16,
  } as React.CSSProperties,

  card: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 14,
    padding: "20px 22px",
  } as React.CSSProperties,

  cardHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  } as React.CSSProperties,

  slotLabel: {
    fontSize: 15,
    fontWeight: 600,
    color: "var(--text)" as string,
  } as React.CSSProperties,

  savedBadge: {
    fontSize: 13,
    fontWeight: 600,
    color: "#5FB783",
  } as React.CSSProperties,

  details: {
    marginTop: 2,
  } as React.CSSProperties,

  summary: {
    fontSize: 13,
    color: "var(--amber)" as string,
    cursor: "pointer",
    userSelect: "none" as const,
  } as React.CSSProperties,

  howToBox: {
    marginTop: 10,
    background: "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: 10,
    padding: "14px 16px",
  } as React.CSSProperties,

  howToList: {
    paddingLeft: 18,
    marginBottom: 10,
    display: "flex",
    flexDirection: "column" as const,
    gap: 4,
  } as React.CSSProperties,

  howToItem: {
    fontSize: 13,
    color: "var(--muted)" as string,
    lineHeight: 1.65,
  } as React.CSSProperties,

  howToLink: {
    fontSize: 13,
    color: "var(--amber)" as string,
    textDecoration: "none",
  } as React.CSSProperties,

  input: {
    width: "100%",
    background: "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    color: "var(--text)" as string,
    padding: "10px 12px",
    fontSize: 14,
    fontFamily: "inherit",
    outline: "none",
    letterSpacing: "0.04em",
  } as React.CSSProperties,

  ctaBtn: {
    background: "var(--amber)",
    color: "#1A1206",
    border: "none",
    borderRadius: 9,
    padding: "9px 18px",
    fontSize: 14,
    fontWeight: 600,
    fontFamily: "inherit",
    transition: "background 0.15s",
  } as React.CSSProperties,

  ghostBtn: {
    background: "transparent",
    border: "1px solid var(--border)",
    borderRadius: 9,
    color: "var(--muted)" as string,
    cursor: "pointer",
    fontSize: 13,
    padding: "8px 14px",
    fontFamily: "inherit",
    transition: "color 0.15s, border-color 0.15s",
  } as React.CSSProperties,

  errText: {
    color: "#E5736B",
    fontSize: 13,
    marginTop: 10,
    lineHeight: 1.5,
    padding: "8px 10px",
    background: "rgba(229,115,107,0.08)",
    borderRadius: 8,
    border: "1px solid rgba(229,115,107,0.2)",
  } as React.CSSProperties,
} as const;
