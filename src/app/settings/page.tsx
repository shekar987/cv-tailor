"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getUsage, type Usage } from "@/lib/usage";
import AppHeader from "@/components/ui/AppHeader";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Badge from "@/components/ui/Badge";
import Skeleton from "@/components/ui/Skeleton";
import StatusText from "@/components/ui/StatusText";

const PAGE_TAGLINE =
  "Your account, your usage, and the provider keys that keep tailoring running after the free credits. Keys are encrypted before storage and are never shown in full after saving.";

type Provider = "gemini" | "openrouter";
type SlotStatus = "idle" | "saving" | "error";
type SavedKey = { hint: string; updatedAt: string };

// OpenRouter first: it is the key that actually runs tailoring (the tailor
// route's own-key path is OpenRouter-only). Gemini stays as an optional,
// visually muted slot so an already-saved key remains manageable, labelled
// honestly as not used for tailoring yet.
const SLOTS: {
  label: string;
  role: string;
  caveat: string;
  muted: boolean;
  provider: Provider;
  providerDisplay: string;
  howToSteps: string[];
  linkUrl: string;
  linkText: string;
}[] = [
  {
    label: "OpenRouter",
    role: "Runs your tailoring once your free credits are used. A free OpenRouter account is enough — its free tier handles full runs.",
    caveat:
      "Heads up: free OpenRouter models may use what you send for training. If that matters for your CV, check the privacy settings in your OpenRouter account.",
    muted: false,
    provider: "openrouter",
    providerDisplay: "OpenRouter",
    howToSteps: [
      "Go to openrouter.ai and sign in (or create a free account)",
      'Click your avatar in the top-right → "Keys"',
      'Click "Create key", give it a name (e.g. "Jobhuntz")',
      "Copy the key — it starts with sk-or-v1-",
      "Paste it in the field below",
    ],
    linkUrl: "https://openrouter.ai/keys",
    linkText: "Open OpenRouter →",
  },
  {
    label: "Google Gemini",
    role: "Optional — not used for tailoring yet. Gemini's free tier allows 5 requests a minute and a full run makes 8, so a run can't finish on it.",
    caveat: "",
    muted: true,
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
];

// "resets in 3h 20m" for the daily window; "" when unknown or already reset.
function resetsIn(iso: string | null): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.max(Math.round((ms % 3_600_000) / 60_000), 1);
  return h > 0 ? `resets in ${h}h ${m}m` : `resets in ${m}m`;
}

export default function SettingsPage() {
  const router = useRouter();
  const [loaded, setLoaded] = useState(false);
  const [email, setEmail] = useState("");
  // undefined = still loading; null = unavailable (the numbers hide, the page works)
  const [usage, setUsage] = useState<Usage | null | undefined>(undefined);
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
  // A failed read must not masquerade as "no keys saved" — that invites the
  // user to overwrite a key they already have.
  const [pageError, setPageError] = useState("");
  const [confirmRemove, setConfirmRemove] = useState<Provider | null>(null);

  useEffect(() => {
    async function init() {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.replace("/auth/login?next=/settings");
        return;
      }
      setEmail(session.user.email ?? "");
      // Fire-and-forget: null just hides the usage numbers.
      getUsage().then(setUsage);

      // SELECT only the non-revoked columns — key_enc is blocked at the column level
      const { data, error } = await supabase
        .from("user_api_keys")
        .select("provider, key_hint, updated_at");

      if (error) {
        setPageError("Couldn't load your saved keys. Refresh the page to try again.");
      } else if (data) {
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
    setConfirmRemove(null);
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
          <AppHeader title="Settings" tagline={PAGE_TAGLINE} />
          <div className="keyList">
            <Card><Skeleton lines={2} label="Loading your account" /></Card>
            <Card><Skeleton lines={3} label="Loading your keys" /></Card>
            <Card><Skeleton lines={3} label="Loading your keys" /></Card>
          </div>
        </div>
      </main>
    );
  }

  // What actually runs a tailor for this account right now — the honest
  // routing summary the two key cards used to leave implicit.
  const hasOpenRouter = savedKeys.openrouter !== null;
  const claudeLeft = usage ? Math.max(usage.claudeLimit - usage.claudeUsed, 0) : null;
  const routing = usage?.unlimited
    ? "This account runs without limits."
    : claudeLeft === null
      ? hasOpenRouter
        ? "After the free credits, tailoring runs on your OpenRouter key."
        : "After the free credits, an OpenRouter key keeps tailoring running."
      : claudeLeft > 0
        ? hasOpenRouter
          ? "Right now tailoring runs on us. When your free credits are used, your OpenRouter key takes over."
          : "Right now tailoring runs on us — no key needed yet. When your free credits are used, you'll need an OpenRouter key."
        : hasOpenRouter
          ? "Your free Claude credits are used — tailoring runs on your OpenRouter key."
          : "Your free Claude credits are used — add an OpenRouter key below to keep tailoring.";

  return (
    <main className="page">
      <div className="container">
        <AppHeader title="Settings" tagline={PAGE_TAGLINE} />

        {pageError && <p role="alert" className="keyError">{pageError}</p>}

        <div className="keyList">
          <Card>
            <div className="keyCardHeader">
              <span className="keyLabel">Account &amp; usage</span>
              {email && <Badge variant="pill">{email}</Badge>}
            </div>
            {usage === undefined ? (
              <Skeleton lines={2} label="Loading your usage" />
            ) : (
              <ul className="usageList">
                {usage && !usage.unlimited && (
                  <>
                    <li>
                      Free tailors today:{" "}
                      <strong>{Math.max(usage.dailyLimit - usage.dailyUsed, 0)} of {usage.dailyLimit}</strong> left
                      {resetsIn(usage.resetAt) && <> — {resetsIn(usage.resetAt)}</>}
                    </li>
                    <li>
                      Free Claude credits:{" "}
                      <strong>{Math.max(usage.claudeLimit - usage.claudeUsed, 0)} of {usage.claudeLimit}</strong> left (lifetime)
                    </li>
                  </>
                )}
                <li>{routing}</li>
              </ul>
            )}
          </Card>

          {SLOTS.map((slot) => {
            const saved = savedKeys[slot.provider];
            const isBusy = status[slot.provider] === "saving";
            const err = slotErrors[slot.provider];
            const isReplacing = showInput[slot.provider];
            const showInputField = !saved || isReplacing;

            return (
              <Card key={slot.provider} className={slot.muted ? "keyCardMuted" : undefined}>
                {/* Card header — provider name + masked badge */}
                <div className="keyCardHeader">
                  <span className="keyLabel">{slot.label}</span>
                  {saved && !isReplacing && (
                    <Badge variant="pill">✓ Saved ••••{saved.hint}</Badge>
                  )}
                </div>

                {/* What this key actually does for the account — no mystery slots */}
                <p className="keyRole">{slot.role}</p>

                {/* Collapsible how-to */}
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
                    <Input
                      variant="key"
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
                    />
                    <div className="actions">
                      <Button
                        onClick={() => handleSave(slot.provider)}
                        disabled={isBusy || !inputValues[slot.provider].trim()}
                      >
                        {isBusy ? "Saving…" : "Save key"}
                      </Button>
                      {isReplacing && (
                        <Button
                          onClick={() => cancelReplace(slot.provider)}
                          disabled={isBusy}
                          variant="ghost"
                        >
                          Cancel
                        </Button>
                      )}
                    </div>
                  </div>
                )}

                {/* Replace / Remove actions — only when key is saved and not replacing */}
                {saved && !isReplacing && (
                  <div className="actions">
                    {confirmRemove === slot.provider ? (
                      <>
                        {/* Two-step: this button sits beside Replace, and a
                            removed key can't be recovered. */}
                        <StatusText as="span">Remove this key?</StatusText>
                        <Button
                          onClick={() => handleRemove(slot.provider)}
                          disabled={isBusy}
                          variant="ghost"
                          className="keyRemove"
                        >
                          {isBusy ? "Removing…" : "Yes, remove"}
                        </Button>
                        <Button onClick={() => setConfirmRemove(null)} disabled={isBusy} variant="ghost">
                          Keep it
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          onClick={() => setShowInput(si => ({ ...si, [slot.provider]: true }))}
                          disabled={isBusy}
                          variant="secondary"
                        >
                          Replace
                        </Button>
                        <Button
                          onClick={() => setConfirmRemove(slot.provider)}
                          disabled={isBusy}
                          variant="ghost"
                          className="keyRemove"
                        >
                          Remove
                        </Button>
                      </>
                    )}
                  </div>
                )}

                {/* Per-slot error */}
                {err && (
                  <p role="alert" className="keyError">{err}</p>
                )}

                {slot.caveat && <p className="keyCaveat">{slot.caveat}</p>}
              </Card>
            );
          })}
        </div>
      </div>
    </main>
  );
}
