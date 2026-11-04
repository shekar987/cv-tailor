"use client";

// What needs attention, in one strip (4 Nov 2026, Chunk 13). It replaces the banner,
// the referral block and the two chips: each card is a button that filters the table,
// and urgency is an icon and words as well as a colour.
import Icon from "@/components/ui/Icon";
import type { AttentionCounts, ReferralCard } from "@/lib/applicationStage";

export type AttentionFilter = "due" | "followups" | "fix" | "referrals";

function formatDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

export default function AttentionStrip({
  counts, dueLabel, referral, active, onFilter, onOpenReferral,
}: {
  counts: AttentionCounts;
  dueLabel: string;
  referral: ReferralCard | null;
  active: AttentionFilter | null;
  onFilter: (filter: AttentionFilter) => void;
  onOpenReferral: (id: string) => void;
}) {
  return (
    <section className="attnStrip" aria-label="Needs attention" data-cards={referral ? 4 : 3} data-attention>
      <button
        type="button"
        className="attnCard"
        data-tone={counts.dueSoon > 0 ? "red" : undefined}
        aria-pressed={active === "due"}
        onClick={() => onFilter("due")}
        data-attn="due"
      >
        <span className="attnNumber">
          {counts.dueSoon > 0 && <Icon name="alert" />}
          {counts.dueSoon}
        </span>
        <span className="attnLabel">{dueLabel}</span>
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
        <span className="attnLabel">Follow-ups due</span>
      </button>
      <button
        type="button"
        className="attnCard"
        data-tone={counts.dataToFix > 0 ? "amber" : undefined}
        aria-pressed={active === "fix"}
        onClick={() => onFilter("fix")}
        data-attn="fix"
      >
        <span className="attnNumber">{counts.dataToFix}</span>
        <span className="attnLabel">Data to fix · {counts.statusToFix} status, {counts.attachmentsToFix} JD/CV</span>
      </button>
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
