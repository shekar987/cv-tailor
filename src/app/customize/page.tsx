"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  DEFAULT_SECTION_ORDER,
  SECTION_LABELS,
  resolveSectionOrder,
  isDefaultOrder,
  type SectionId,
} from "@/lib/sectionOrder";

// Reorder the CV's standard sections. Section ORDER only — bullet counts and
// content are untouched and still come from the tailoring run.
//
// No drag-and-drop library: this is a five-item single-column list, and the
// project's guidance is not to add dependencies for small problems. Native
// HTML5 drag handles the mouse; the ↑/↓ buttons cover keyboard, screen readers
// and touch, which drag alone would not.
export default function CustomizePage() {
  const router = useRouter();
  const [order, setOrder] = useState<SectionId[]>(DEFAULT_SECTION_ORDER);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedMsg, setSavedMsg] = useState("");
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      // The page is auth-gated by proxy.ts, but bounce defensively if the
      // session vanished between navigation and mount.
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.replace("/auth/login");
        return;
      }
      try {
        const res = await fetch("/api/section-order");
        const data = await res.json();
        if (!active) return;
        if (res.ok) setOrder(resolveSectionOrder(data.order));
      } catch {
        // Fall back to the default order — the page still works, and saving
        // will surface any real problem.
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, [router]);

  function move(from: number, to: number) {
    if (to < 0 || to >= order.length || from === to) return;
    setOrder((current) => {
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setSavedMsg("");
  }

  async function save() {
    setSaving(true);
    setError("");
    setSavedMsg("");
    try {
      const res = await fetch("/api/section-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not save. Please try again.");
      } else {
        setSavedMsg(
          isDefaultOrder(order)
            ? "Saved — you're back on the standard order."
            : "Saved. Every CV you tailor from now on uses this order."
        );
      }
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="page">
      <div className="container">
        <header className="header">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div className="wordmark">CV<span className="dot">.</span>Tailor</div>
            <Link href="/app" className="customizeLink">← Back to app</Link>
          </div>
          <p className="tagline">
            Choose the order your CV sections appear in. Saved once, applied to every future tailoring run.
          </p>
        </header>

        <section className="inputCard">
          <div className="label">Section order</div>
          <p className="cvHelp">
            Drag a section, or use the arrows. This changes the order only — how many bullets each
            section gets is still decided by the tailoring for each specific job.
          </p>

          {loading ? (
            <p className="cvHelp" style={{ color: "var(--muted)" }}>Loading your layout…</p>
          ) : (
            <>
              <ul className="orderList">
                {order.map((id, index) => (
                  <li
                    key={id}
                    className={
                      "orderItem" +
                      (dragIndex === index ? " dragging" : "") +
                      (overIndex === index && dragIndex !== index ? " dropTarget" : "")
                    }
                    draggable
                    onDragStart={() => setDragIndex(index)}
                    onDragOver={(e) => {
                      e.preventDefault(); // required for onDrop to fire
                      setOverIndex(index);
                    }}
                    onDragLeave={() => setOverIndex((i) => (i === index ? null : i))}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragIndex !== null) move(dragIndex, index);
                      setDragIndex(null);
                      setOverIndex(null);
                    }}
                    onDragEnd={() => { setDragIndex(null); setOverIndex(null); }}
                  >
                    <span className="orderGrip" aria-hidden="true">⋮⋮</span>
                    <span className="orderNum">{index + 1}</span>
                    {/* The real CV heading style, so what's being reordered is
                        recognisably the same thing that appears on the CV. */}
                    <span className="cvHead orderHead">{SECTION_LABELS[id]}</span>
                    <span className="orderBtns">
                      <button
                        type="button"
                        className="orderBtn"
                        onClick={() => move(index, index - 1)}
                        disabled={index === 0}
                        aria-label={`Move ${SECTION_LABELS[id]} up`}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="orderBtn"
                        onClick={() => move(index, index + 1)}
                        disabled={index === order.length - 1}
                        aria-label={`Move ${SECTION_LABELS[id]} down`}
                      >
                        ↓
                      </button>
                    </span>
                  </li>
                ))}
              </ul>

              <div className="actions">
                <button onClick={save} disabled={saving} className="cta">
                  {saving ? "Saving…" : "Save order"}
                </button>
                <button
                  onClick={() => { setOrder([...DEFAULT_SECTION_ORDER]); setSavedMsg(""); }}
                  disabled={saving || isDefaultOrder(order)}
                  className="cta ghost"
                >
                  Reset to standard
                </button>
              </div>

              {error && <p className="error" style={{ marginTop: 12 }} role="alert">{error}</p>}
              {savedMsg && <p className="savedMsg" style={{ marginTop: 12 }} role="status">{savedMsg}</p>}
            </>
          )}
        </section>

        <section className="inputCard">
          <div className="label">Not affected by this</div>
          <p className="cvHelp" style={{ marginBottom: 0 }}>
            Your name and contact details stay at the top. Certifications, Right to Work and any
            extra sections from your CV stay after the sections above, in that order.
          </p>
        </section>
      </div>
    </main>
  );
}
