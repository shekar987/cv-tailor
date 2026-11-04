"use client";

// The project pool as cards (4 Nov 2026, Chunk 14). How many projects go on a CV and in
// what order, saved per user; each project as a card with its dates, tech, label and pin.
// An old text pool is read into cards for the user to check, and stays the source until
// they confirm. The rules are lib/projectPool; this only edits.
import { useMemo, useState } from "react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import StatusText from "@/components/ui/StatusText";
import Textarea from "@/components/ui/Textarea";
import { parsePoolText } from "@/lib/poolParse";
import { POOL_COUNT_CHOICES, cardsToPoolText, hasDates, pinWarning, resolveCount, type PoolCard, type PoolCount, type PoolOrder, type PoolSettings } from "@/lib/projectPool";
import { MAX_POOL_CHARS } from "@/lib/limits";

function newCard(existing: readonly PoolCard[]): PoolCard {
  let n = existing.length + 1;
  while (existing.some((c) => c.id === `card-${n}`)) n++;
  return { id: `card-${n}`, name: "", start: "", end: "", ongoing: false, tech: [], body: "", label: "", links: [], pinned: false };
}

function CardEditor({
  card, links, disabled, onChange, onRemove,
}: {
  card: PoolCard;
  links: string;
  disabled: boolean;
  onChange: (patch: Partial<PoolCard>) => void;
  onRemove: () => void;
}) {
  const id = (field: string) => `pool-${card.id}-${field}`;
  return (
    <fieldset className="poolCard" data-pool-card={card.id}>
      <legend className="srOnly">{card.name || "New project"}</legend>
      <div className="poolCardHead">
        <label className="poolCardField poolCardName" htmlFor={id("name")}>
          <span className="label">Project name</span>
          <Input id={id("name")} value={card.name} maxLength={200} disabled={disabled} onChange={(e) => onChange({ name: e.target.value })} data-pool-name />
        </label>
        <label className="planRadio poolCardPin">
          <input type="checkbox" checked={card.pinned} disabled={disabled} onChange={(e) => onChange({ pinned: e.target.checked })} data-pool-pin />
          Always include
        </label>
      </div>
      <div className="poolCardRow">
        <label className="poolCardField" htmlFor={id("start")}>
          <span className="label">Start</span>
          <Input id={id("start")} value={card.start} placeholder="Jan 2025" maxLength={30} disabled={disabled} onChange={(e) => onChange({ start: e.target.value })} data-pool-start />
        </label>
        <label className="poolCardField" htmlFor={id("end")}>
          <span className="label">End</span>
          <Input id={id("end")} value={card.ongoing ? "" : card.end} placeholder={card.ongoing ? "Ongoing" : "Sep 2026"} maxLength={30} disabled={disabled || card.ongoing} onChange={(e) => onChange({ end: e.target.value })} data-pool-end />
        </label>
        <label className="planRadio poolCardOngoing">
          <input type="checkbox" checked={card.ongoing} disabled={disabled} onChange={(e) => onChange({ ongoing: e.target.checked, end: e.target.checked ? "" : card.end })} data-pool-ongoing />
          Ongoing
        </label>
      </div>
      {!hasDates(card) && <p className="fitEvidence" data-warn data-pool-no-dates>Add dates to sort by date.</p>}
      <label className="poolCardField" htmlFor={id("tech")}>
        <span className="label">Tech</span>
        <Input
          id={id("tech")}
          value={card.tech.join(", ")}
          placeholder="React, Node.js, PostgreSQL"
          disabled={disabled}
          onChange={(e) => onChange({ tech: e.target.value.split(",").map((t) => t.replace(/^\s+/, "")) })}
          data-pool-tech
        />
      </label>
      <label className="poolCardField" htmlFor={id("label")}>
        <span className="label">Label (optional)</span>
        <Input id={id("label")} value={card.label} placeholder="Personal portfolio project modelled on a real-world brief" maxLength={160} disabled={disabled} onChange={(e) => onChange({ label: e.target.value })} data-pool-label />
        <span className="fitEvidence">Printed on your CV every time, exactly as written.</span>
      </label>
      <label className="poolCardField" htmlFor={id("body")}>
        <span className="label">What you did, in your own words</span>
        <Textarea id={id("body")} rows={5} value={card.body} disabled={disabled} onChange={(e) => onChange({ body: e.target.value })} data-pool-body />
      </label>
      <p className="fitEvidence" data-pool-links>{links ? `Links: ${links}` : "No links yet."} Change them under Project links.</p>
      <div className="actions">
        <Button variant="ghost" className="keyRemove" disabled={disabled} onClick={onRemove} data-pool-remove>Remove this project</Button>
      </div>
    </fieldset>
  );
}

export default function ProjectPoolEditor({
  poolText, cards, settings, pageTarget, roles, oldText, saving, linksFor, onSaveSettings, onSaveCards,
}: {
  poolText: string;
  cards: readonly PoolCard[];
  settings: PoolSettings;
  pageTarget: 1 | 2;
  roles: number;
  /** The free text from before the cards, kept to look back at. */
  oldText: string;
  saving: boolean;
  linksFor: (name: string) => string;
  onSaveSettings: (settings: PoolSettings) => void;
  onSaveCards: (cards: PoolCard[]) => Promise<boolean>;
}) {
  const confirmed = cards.length > 0;
  const parsed = useMemo(() => (confirmed ? null : parsePoolText(poolText)), [confirmed, poolText]);
  const [draft, setDraft] = useState<PoolCard[] | null>(null);
  const [keepText, setKeepText] = useState(false);
  const [error, setError] = useState("");
  const [showOld, setShowOld] = useState(false);

  // What is on screen: edits in progress, else the saved cards, else what was read from the text.
  const shown: readonly PoolCard[] = draft ?? (confirmed ? cards : parsed?.cards ?? []);
  const reviewing = !confirmed && !!parsed && parsed.cards.length > 0;
  const editing = confirmed || draft !== null || (reviewing && !keepText);
  const count = resolveCount(settings, { pageTarget, roles }, shown.length);
  const warning = pinWarning(shown, settings, count);
  const autoCount = resolveCount({ ...settings, count: "auto" }, { pageTarget, roles }, shown.length);

  function update(id: string, patch: Partial<PoolCard>) {
    setDraft((current) => (current ?? [...shown]).map((c) => (c.id === id ? { ...c, ...patch } : c)));
    setError("");
  }

  async function save() {
    const next = (draft ?? [...shown]).map((c) => ({ ...c, tech: c.tech.map((t) => t.trim()).filter(Boolean) }));
    if (next.some((c) => !c.name.trim())) {
      setError("Give each project a name, or remove it.");
      return;
    }
    const size = cardsToPoolText(next).length;
    if (size > MAX_POOL_CHARS) {
      setError(`That is too long (${size.toLocaleString()} / ${MAX_POOL_CHARS.toLocaleString()} characters).`);
      return;
    }
    if (await onSaveCards(next)) setDraft(null);
  }

  return (
    <div className="poolEditor" data-pool-editor>
      <div className="poolSettings">
        <div className="poolSetting">
          <span className="label" id="poolCountLabel">Projects on the CV</span>
          <div className="appsSeg" role="group" aria-labelledby="poolCountLabel" data-pool-count={String(settings.count)}>
            {POOL_COUNT_CHOICES.map((choice: PoolCount) => (
              <button
                key={String(choice)}
                type="button"
                className={"appsSegBtn" + (settings.count === choice ? " active" : "")}
                aria-pressed={settings.count === choice}
                disabled={saving}
                onClick={() => onSaveSettings({ ...settings, count: choice })}
                data-pool-count-choice={String(choice)}
              >
                {choice === "auto" ? `Auto (${autoCount})` : choice}
              </button>
            ))}
          </div>
        </div>
        <div className="poolSetting">
          <span className="label" id="poolOrderLabel">Order</span>
          <div className="appsSeg" role="group" aria-labelledby="poolOrderLabel" data-pool-order={settings.order}>
            {(["relevance", "date"] as PoolOrder[]).map((choice) => (
              <button
                key={choice}
                type="button"
                className={"appsSegBtn" + (settings.order === choice ? " active" : "")}
                aria-pressed={settings.order === choice}
                disabled={saving}
                onClick={() => onSaveSettings({ ...settings, order: choice })}
                data-pool-order-choice={choice}
              >
                {choice === "relevance" ? "Most relevant first" : "Newest first"}
              </button>
            ))}
          </div>
        </div>
      </div>
      {warning && <StatusText role="status" className="msgBelow" data-pool-pin-warning>{warning}</StatusText>}
      {!confirmed && <p className="fitEvidence">These apply once your projects are saved as cards below. You can change them for one run on the tailoring page.</p>}

      {reviewing && !keepText && (
        <div className="limitNotice" role="status" data-pool-review>
          We found {parsed.cards.length} {parsed.cards.length === 1 ? "project" : "projects"}, check them. Your text stays in use until you confirm.{" "}
          <button type="button" className="inlineLink" onClick={() => { setKeepText(true); setDraft(null); }} data-pool-keep-text>Keep the text box for now</button>
        </div>
      )}
      {reviewing && !keepText && parsed.leftover.length > 0 && (
        <p className="fitEvidence" data-warn data-pool-leftover>
          These lines did not belong to a project, so they are not on a card: {parsed.leftover.join(" · ")}
        </p>
      )}
      {reviewing && keepText && (
        <p className="fitEvidence">
          We can read this into {parsed.cards.length} {parsed.cards.length === 1 ? "card" : "cards"}.{" "}
          <button type="button" className="inlineLink" onClick={() => setKeepText(false)} data-pool-check>Check them</button>
        </p>
      )}

      {editing && (
        <div className="poolCards">
          {shown.map((card) => (
            <CardEditor
              key={card.id}
              card={card}
              links={linksFor(card.name)}
              disabled={saving}
              onChange={(patch) => update(card.id, patch)}
              onRemove={() => setDraft((current) => (current ?? [...shown]).filter((c) => c.id !== card.id))}
            />
          ))}
        </div>
      )}
      {error && <StatusText className="msgBelow" role="alert">{error}</StatusText>}
      <div className="actions">
        {editing && (
          <Button disabled={saving || (confirmed && draft === null)} onClick={() => void save()} data-pool-save>
            {saving ? "Saving…" : confirmed ? "Save projects" : `Confirm ${shown.length} ${shown.length === 1 ? "project" : "projects"}`}
          </Button>
        )}
        <Button variant="secondary" disabled={saving} onClick={() => setDraft([...shown, newCard(shown)])} data-pool-add>Add a project</Button>
        {draft !== null && (
          <Button variant="ghost" disabled={saving} onClick={() => { setDraft(null); setError(""); }}>Discard changes</Button>
        )}
      </div>
      {confirmed && oldText && (
        <div className="poolOldText">
          <button type="button" className="inlineLink" aria-expanded={showOld} onClick={() => setShowOld((v) => !v)} data-pool-old-toggle>
            {showOld ? "Hide your original text" : "Show your original text"}
          </button>
          {showOld && <pre className="poolOldTextBody" data-pool-old>{oldText}</pre>}
        </div>
      )}
    </div>
  );
}
