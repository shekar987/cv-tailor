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

    try {
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
    } catch {
      setStatus(s => ({ ...s, [provider]: "error" }));
      setSlotErrors(e => ({ ...e, [provider]: "Connection error. Please try again." }));
    }
  }

  async function handleRemove(provider: Provider) {
    setStatus(s => ({ ...s, [provider]: "saving" }));
    setSlotErrors(e => ({ ...e, [provider]: "" }));

    try {
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
    } catch {
      setStatus(s => ({ ...s, [provider]: "error" }));
      setSlotErrors(e => ({ ...e, [provider]: "Connection error. Please try again." }));
    }
  }

  function cancelReplace(provider: Provider) {
    setShowInput(si => ({ ...si, [provider]: false }));
    setInputValues(v => ({ ...v, [provider]: "" }));
    setSlotErrors(e => ({ ...e, [provider]: "" }));
    setStatus(st => ({ ...st, [provider]: "idle" }));
  }

  if (!loaded) {
    return (
      <main className="page">
        <div className="container">
          <p className="cvHelp">Loading your keys…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <div className="container">
        <header className="header">
          <div className="appBar">
            <div className="wordmark">CV<span className="dot">.</span>Tailor</div>
            <Link href="/app" className="customizeLink">← Back to app</Link>
          </div>
          <h1 className="settingsHeading">API Keys</h1>
          <p className="tagline">
            Add your own AI provider keys to keep tailoring after your free credits run out.
            Keys are encrypted before storage and are never shown in full after saving.
          </p>
        </header>

        <div className="keyList">
          {SLOTS.map((slot) => {
            const saved = savedKeys[slot.provider];
            const isBusy = status[slot.provider] === "saving";
            const err = slotErrors[slot.provider];
            const isReplacing = showInput[slot.provider];
            const showInputField = !saved || isReplacing;

            return (
              <section key={slot.provider} className="inputCard">
                {/* Card header — slot label + masked badge */}
                <div className="keyCardHeader">
                  <span className="keyLabel">{slot.label}</span>
                  {saved && !isReplacing && (
                    <span className="savedBadge">✓ Saved ••••{saved.hint}</span>
                  )}
                </div>

                {/* Collapsible how-to — provider name only appears here */}
                <details className="keyDetails">
                  <summary className="keySummary">
                    How to get this key ({slot.providerDisplay}) →
                  </summary>
                  <div className="keyHowTo">
                    <ol className="howToList">
                      {slot.howToSteps.map((step, i) => (
                        <li key={i} className="howToItem">{step}</li>
                      ))}
                    </ol>
                    <a
                      href={slot.linkUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="howToLink"
                    >
                      {slot.linkText}
                    </a>
                  </div>
                </details>

                {/* Key input — visible when no key saved yet, or during Replace */}
                {showInputField && (
                  <div className="keyInputRow">
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
                      aria-label={`${slot.providerDisplay} API key`}
                      className="keyInput"
                    />
                    <div className="actions">
                      <button
                        onClick={() => handleSave(slot.provider)}
                        disabled={isBusy || !inputValues[slot.provider].trim()}
                        className="cta"
                      >
                        {isBusy ? "Saving…" : "Save key"}
                      </button>
                      {isReplacing && (
                        <button
                          onClick={() => cancelReplace(slot.provider)}
                          disabled={isBusy}
                          className="cta ghost"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Replace / Remove actions — only when key is saved and not replacing */}
                {saved && !isReplacing && (
                  <div className="actions">
                    <button
                      onClick={() => setShowInput(si => ({ ...si, [slot.provider]: true }))}
                      disabled={isBusy}
                      className="cta secondary"
                    >
                      Replace
                    </button>
                    <button
                      onClick={() => handleRemove(slot.provider)}
                      disabled={isBusy}
                      className="cta ghost keyRemove"
                    >
                      {isBusy ? "Removing…" : "Remove"}
                    </button>
                  </div>
                )}

                {/* Per-slot error */}
                {err && (
                  <p role="alert" className="keyError">{err}</p>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </main>
  );
}
