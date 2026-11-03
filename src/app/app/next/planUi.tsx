// Small pieces the plan and the tracker's stage tabs share. A stage or kind is
// always an icon and a word as well as a colour (WCAG 1.4.1): blue and violet are
// the brief's stage colours and cannot be told apart under every colour-blindness.
import Icon, { type IconName } from "@/components/ui/Icon";
import { EVENT_KIND_LABELS, type EventKind } from "@/lib/plan";
import { normalizeStatus, statusLabel, type Status } from "@/lib/tracker";

const STAGE_ICONS: Record<Status, IconName> = {
  saved: "clipboard",
  applied: "mail",
  screening: "phone",
  interview: "users",
  assessment: "clipboard",
  offer: "flag",
  accepted: "trophy",
  rejected: "close",
  withdrawn: "close",
  ghosted: "clock",
};

export const KIND_ICONS: Record<EventKind, IconName> = {
  screening_call: "phone",
  interview: "users",
  assessment: "clipboard",
  take_home: "document",
  deadline: "clock",
  follow_up: "mail",
  offer_deadline: "flag",
  networking: "link",
};

export function StageChip({ status }: { status: string }) {
  const key = normalizeStatus(status);
  return (
    <span className="stageChip" data-stage={key ?? "unknown"}>
      {key && <Icon name={STAGE_ICONS[key]} />}
      {statusLabel(status)}
    </span>
  );
}

export function KindTag({ kind }: { kind: EventKind }) {
  return (
    <span className="kindTag">
      <Icon name={KIND_ICONS[kind]} />
      {EVENT_KIND_LABELS[kind]}
    </span>
  );
}

export function CompanyInitial({ name }: { name: string }) {
  const letter = name.trim().match(/\p{L}|\p{N}/u)?.[0]?.toUpperCase() ?? "·";
  return <span className="companyInitial" aria-hidden="true">{letter}</span>;
}

/** A browser's own zone, or London when it will not say. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/London";
  } catch {
    return "Europe/London";
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** A link only when it is one: anything else is a place, drawn as text. */
export function safeHttpUrl(value: string | null | undefined): string | null {
  const text = (value ?? "").trim();
  return /^https?:\/\/\S+$/i.test(text) ? text : null;
}
