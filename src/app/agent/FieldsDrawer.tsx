"use client";

// Chunk 35: the "Fields" drawer on the Agent page. The PC worker's observer
// records the application form's controls as a numbered list and sends it in
// the job's `observed` timeline event; this renders that list (label, type,
// required, options, which frame) and the full-page screenshot. Presentational
// only — it takes the observer JSON and a signed screenshot URL as props, so it
// renders under node:test (tests/fieldsDrawer).

export type ObserverOption = { value?: string; label?: string };

export type ObserverElement = {
  index: number;
  role: string;
  type?: string | null;
  label?: string;
  name?: string | null;
  required?: boolean;
  visible?: boolean;
  frame_path?: string;
  selector?: string;
  options?: ObserverOption[];
};

export type ObserverData = {
  url?: string;
  title?: string;
  login_wall?: boolean;
  captcha?: boolean;
  wall_reason?: string | null;
  counts?: Record<string, number>;
  field_count?: number;
  truncated?: boolean;
  elements?: ObserverElement[];
};

function metaLine(el: ObserverElement): string {
  const bits: string[] = [el.role];
  if (el.type) bits.push(el.type);
  if (el.required) bits.push("required");
  if (el.options && el.options.length > 0) bits.push(`${el.options.length} options`);
  if (el.frame_path) bits.push("in an embedded frame");
  if (el.visible === false) bits.push("hidden");
  return bits.join(" · ");
}

export function FieldsDrawer({
  observer,
  screenshotUrl,
}: {
  observer: ObserverData | null;
  screenshotUrl?: string | null;
}) {
  if (!observer) {
    return (
      <p className="cvHelp" data-fields-empty>
        No field list yet — the worker hasn&apos;t read this page.
      </p>
    );
  }
  const elements = observer.elements ?? [];
  const count = observer.field_count ?? elements.length;
  return (
    <div className="agentFields" data-fields-drawer>
      {(observer.login_wall || observer.captcha) && (
        <p className="agentFields__wall" role="status" data-fields-wall>
          {observer.wall_reason ||
            (observer.captcha
              ? "This page has a captcha — a human needs to take over."
              : "This page needs a sign-in — a human needs to take over.")}
        </p>
      )}

      {screenshotUrl && (
        <a href={screenshotUrl} target="_blank" rel="noopener noreferrer" className="agentFields__shotLink">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="agentFields__shot" src={screenshotUrl} alt="Screenshot of the application page" />
        </a>
      )}

      <p className="cvHelp" data-fields-count>
        {count} {count === 1 ? "field" : "fields"} found
        {observer.truncated ? ` (showing the first ${elements.length})` : ""}.
      </p>

      {elements.length === 0 ? (
        <p className="cvHelp">No form controls were found on the page.</p>
      ) : (
        <ol className="agentFields__list">
          {elements.map((el) => (
            <li key={el.index} data-field-index={el.index} data-field-role={el.role}>
              <span className="agentFields__fieldLabel">{el.label || el.name || "(no label)"}</span>
              <span className="agentFields__fieldMeta">{metaLine(el)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default FieldsDrawer;
