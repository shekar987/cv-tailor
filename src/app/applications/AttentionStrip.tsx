"use client";

// What needs attention, in one strip (4 Nov 2026, Chunk 13). It replaces the banner,
// the referral block and the two chips: each card is a button that filters the table,
// and urgency is an icon and words as well as a colour.
import Icon from "@/components/ui/Icon";
import { fixLabel, type AttentionCounts, type ReferralCard } from "@/lib/applicationStage";
import type { DueTodayCount } from "@/lib/followupsDue";
import { formatDate } from "@/lib/formatDate";

export type AttentionFilter = "due" | "today" | "followups" | "fix" | "referrals" | "cold";

function formatDay(iso: string): string {
  return formatDate(iso, { year: false }) || iso;
}

// While the full list is on its way (`loading`), the two cards that need every row show a
// placeholder instead of a number counted from one page; the follow-ups card's number
// comes from the server's counts and is already right.
function Pending() {
  return <span className="attnPending" aria-label="Counting">…</span>;
}

export default function AttentionStrip({
  counts, dueToday, coldNoFollowup = 0, loading = false, dueLabel, referral, active, onFilter, onOpenReferral,
}: {
  counts: AttentionCounts;
  // "Follow-ups due today" (lib/followupsDue, Chunk 23): today or earlier, sent, live, no
  // ending waiting. From the server's counts until the full list is in.
  dueToday: DueTodayCount;
  // Cold emails logged from Gmail with no follow-up date (lib/coldEmails), shown only when there are some.
  coldNoFollowup?: number;
  loading?: boolean;
  dueLabel: string;
  referral: ReferralCard | null;
  active: AttentionFilter | null;
  onFilter: (filter: AttentionFilter) => void;
  onOpenReferral: (id: string) => void;
}) {
  return (
    <section className="attnStrip" aria-label="Needs attention" data-cards={4 + (referral ? 1 : 0) + (!loading && coldNoFollowup > 0 ? 1 : 0)} data-attention>
      <button
        type="button"
        className="attnCard"
        data-tone={!loading && counts.dueSoon > 0 ? "red" : undefined}
        aria-pressed={active === "due"}
        onClick={() => onFilter("due")}
        data-attn="due"
      >
        <span className="attnNumber">
          {loading ? <Pending /> : <>
            {counts.dueSoon > 0 && <Icon name="alert" />}
            {counts.dueSoon}
          </>}
        </span>
        <span className="attnLabel">{dueLabel}</span>
      </button>
      <button
        type="button"
        className="attnCard"
        data-tone={dueToday.total > 0 ? "amber" : undefined}
        aria-pressed={active === "today"}
        onClick={() => onFilter("today")}
        data-attn="today"
        data-due-today={dueToday.today}
        data-due-earlier={dueToday.earlier}
      >
        <span className="attnNumber">{dueToday.total}</span>
        <span className="attnLabel">Follow-ups due today</span>
        {dueToday.earlier > 0 && <span className="attnDetail">{dueToday.today} dated today · {dueToday.earlier} overdue</span>}
      </button>
      <button
        type="button"
        className="attnCard"
        data-tone={counts.followups > 0 ? "amber" : undefined}
        aria-pressed={active === "followups"}
        onClick={() => onFilter("followups")}
        data-attn="followups"
      >
        <span className="attnNumber">{counts.followups}</span>
        <span className="attnLabel">Follow-ups due this week</span>
      </button>
      <button
        type="button"
        className="attnCard"
        data-tone={!loading && counts.dataToFix > 0 ? "amber" : undefined}
        aria-pressed={active === "fix"}
        onClick={() => onFilter("fix")}
        data-attn="fix"
      >
        <span className="attnNumber">{loading ? <Pending /> : counts.dataToFix}</span>
        <span className="attnLabel">{loading ? "Applications to fix" : fixLabel(counts)}</span>
      </button>
      {/* The cold-email count needs every row too: no card until the full list is here. */}
      {!loading && coldNoFollowup > 0 && (
        <button
          type="button"
          className="attnCard"
          data-tone="amber"
          aria-pressed={active === "cold"}
          onClick={() => onFilter("cold")}
          data-attn="cold"
        >
          <span className="attnNumber">{coldNoFollowup}</span>
          <span className="attnLabel">Cold emails missing a follow-up date</span>
        </button>
      )}
      {referral && (
        <div className="attnCard attnCard--referral" data-attn="referral">
          <button type="button" className="attnReferralOpen" onClick={() => onOpenReferral(referral.id)} title={referral.title} data-attn-referral-open>
            <span className="attnLabel">Referral · since {formatDay(referral.since)}</span>
            <span className="attnReferralTitle">{referral.title}</span>
          </button>
          {referral.more > 0 && (
            <button type="button" className="inlineLink attnReferralMore" aria-pressed={active === "referrals"} onClick={() => onFilter("referrals")} data-attn-referral-more>
              +{referral.more} more
            </button>
          )}
        </div>
      )}
    </section>
  );
}
