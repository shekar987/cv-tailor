"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AppHeader from "@/components/ui/AppHeader";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import Skeleton from "@/components/ui/Skeleton";
import StatusText from "@/components/ui/StatusText";
import { ROUNDS, type InterviewType } from "@/lib/interviewTypes";

// /interviews — every mock interview and every prep pack across the tracker,
// in one place (30 Sep audit, Phase 7). Both are made from a tracker row, so
// each line links back to that row's prep or interview page. Two free reads,
// no model call.

const PAGE_TAGLINE =
  "Every mock interview you have done and every prep pack you have built, across all your applications. Start a new one from the tracker's Prep and Interview buttons.";

type InterviewRow = {
  id: string;
  application_id: string;
  type: string;
  status: string;
  created_at: string;
  finished_at: string | null;
  readout: { band: string; label: string; passed?: number; total?: number } | null;
  application: { company_name: string; role: string } | { company_name: string; role: string }[] | null;
};
type PrepRow = { id: string; company_name: string; role: string; status: string; prep_generated_at?: string | null };

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function appOf(row: InterviewRow): { company_name: string; role: string } | null {
  const a = row.application;
  if (!a) return null;
  return Array.isArray(a) ? a[0] ?? null : a;
}

export default function InterviewsPage() {
  const [interviews, setInterviews] = useState<InterviewRow[] | null>(null);
  const [packs, setPacks] = useState<PrepRow[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    async function run() {
      try {
        const [ivRes, appRes] = await Promise.all([fetch("/api/interview"), fetch("/api/applications")]);
        const iv = await ivRes.json().catch(() => ({}));
        const apps = await appRes.json().catch(() => ({}));
        if (!active) return;
        if (ivRes.status === 401 || appRes.status === 401) {
          setError("Your session has expired — sign in again to see your interviews.");
          return;
        }
        if (!ivRes.ok) setError(iv.error || "Could not load your interviews.");
        else {
          setInterviews(Array.isArray(iv.interviews) ? (iv.interviews as InterviewRow[]) : []);
          if (iv.errorType === "needs_migration" && typeof iv.warning === "string") setNotice(iv.warning);
        }
        if (appRes.ok) {
          const rows = Array.isArray(apps.applications) ? (apps.applications as PrepRow[]) : [];
          setPacks(rows.filter((r) => !!r.prep_generated_at).sort((a, b) => (b.prep_generated_at ?? "").localeCompare(a.prep_generated_at ?? "")));
        } else setPacks([]);
      } catch {
        if (active) setError("Couldn't reach the server. Check your connection and try again.");
      }
    }
    void run();
    return () => {
      active = false;
    };
  }, []);

  const loading = interviews === null && !error;

  return (
    <main className="page">
      <div className="container">
        <AppHeader title="Interviews" tagline={PAGE_TAGLINE} />
        {error && <StatusText role="alert">{error}</StatusText>}
        {notice && <div className="limitNotice" role="status">{notice}</div>}

        <Card data-interviews-list>
          <div className="label">Mock interviews</div>
          {loading ? (
            <Skeleton lines={3} label="Loading your interviews" />
          ) : !interviews || interviews.length === 0 ? (
            <EmptyState title="No mock interviews yet" actions={<Button href="/applications">Open the tracker</Button>}>
              Each tracker row has an Interview button: pick the UK round, and an interviewer built from that job and your CV asks
              the questions out loud. One tailor credit each.
            </EmptyState>
          ) : (
            <ul className="interviewPast" data-interview-rows>
              {interviews.map((iv) => {
                const app = appOf(iv);
                const round = ROUNDS[iv.type as InterviewType]?.label ?? iv.type;
                return (
                  <li key={iv.id}>
                    <span>
                      <strong>{app ? `${app.company_name} — ${app.role}` : "Application deleted"}</strong> · {round} · {formatDate(iv.created_at)}
                    </span>
                    {iv.readout ? (
                      <span className="interviewBand" data-band={iv.readout.band}>{iv.readout.label}</span>
                    ) : (
                      <span className="cvHelp">{iv.status === "active" ? "Not finished" : "No feedback"}</span>
                    )}
                    <Link href={`/applications/${iv.application_id}/interview`} className="inlineLink">
                      Open
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card data-prep-list>
          <div className="label">Prep packs</div>
          {packs === null && !error ? (
            <Skeleton lines={3} label="Loading your prep packs" />
          ) : !packs || packs.length === 0 ? (
            <EmptyState title="No prep packs yet" actions={<Button href="/applications">Open the tracker</Button>}>
              Each tracker row has a Prep button: the likely questions for that job with answers built only from your CV, each line
              traced back to it.
            </EmptyState>
          ) : (
            <ul className="interviewPast" data-prep-rows>
              {packs.map((p) => (
                <li key={p.id}>
                  <span>
                    <strong>{p.company_name} — {p.role}</strong> · built {formatDate(p.prep_generated_at)} · {p.status}
                  </span>
                  <Link href={`/applications/${p.id}/prep`} className="inlineLink">
                    Open
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </main>
  );
}
