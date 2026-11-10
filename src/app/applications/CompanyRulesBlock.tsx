"use client";
// A company's rules about applying again, in a row's Notes panel (10 Nov 2026, Chunk 21;
// lib/companyRules). Three parts: what these notes say that is not saved yet ("Your notes
// say: …" with one click to save it, a date to pick for "this intake year"), the rules
// saved for this company (each can be switched off, never deleted), and a short form to
// add one by hand. JD triage on /app reads them before any credit is spent.
import { useState } from "react";
import { companyNamesMatch } from "../../lib/companyMatch";
import {
  RULE_TYPES,
  RULE_TYPE_LABELS,
  describeRule,
  nextSeptember,
  readCooldowns,
  ruleExists,
  type CompanyRule,
  type CooldownRow,
  type RuleDraft,
  type RuleType,
} from "../../lib/companyRules";

type Props = {
  applicationId: string;
  company: string;
  role: string;
  notes: string | null;
  rules: CompanyRule[] | null;
  needsMigration: boolean;
  rows: readonly CooldownRow[];
  today: string;
  onSaved: (rule: CompanyRule) => void;
};

async function send(method: "POST" | "PUT", body: Record<string, unknown>): Promise<{ rule?: CompanyRule; error?: string }> {
  try {
    const res = await fetch("/api/company-rules", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: typeof data.error === "string" ? data.error : "Could not save that rule." };
    return { rule: data.rule as CompanyRule };
  } catch {
    return { error: "Connection error. The rule was not saved." };
  }
}

function valueOf(d: RuleDraft, role: string, date: string): string {
  return d.value ?? (d.needs === "role" ? role : d.needs === "date" ? date : "");
}

export default function CompanyRulesBlock({ applicationId, company, role, notes, rules, needsMigration, rows, today, onSaved }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [dates, setDates] = useState<Record<number, string>>({});
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<{ type: RuleType; value: string; source: string }>({ type: "reapply_after_days", value: "", source: "" });

  if (needsMigration) {
    return <p className="cvHelp" data-company-rules="needs-migration">Reapply rules need migration 20261110120000_safe_notes_cooldowns_deadlines.sql in the Supabase SQL editor.</p>;
  }
  if (!rules) return null;
  const saved = rules.filter((r) => companyNamesMatch(company, r.company_name));
  const suggestions = readCooldowns(notes, null).filter((d) => {
    const value = valueOf(d, role, "");
    return !(value && ruleExists(saved, { company_name: company, rule_type: d.rule_type, value }));
  });

  async function save(key: string, body: Record<string, unknown>) {
    setBusy(key);
    setError("");
    const { rule, error: failed } = await send("POST", { company_name: company, application_id: applicationId, ...body });
    setBusy(null);
    if (failed || !rule) {
      setError(failed ?? "Could not save that rule.");
      return false;
    }
    onSaved(rule);
    return true;
  }

  async function toggle(rule: CompanyRule) {
    if (!rule.id) return;
    setBusy(rule.id);
    setError("");
    const { rule: changed, error: failed } = await send("PUT", { id: rule.id, dismissed: !rule.dismissed_at });
    setBusy(null);
    if (failed || !changed) setError(failed ?? "Could not change that rule.");
    else onSaved(changed);
  }

  return (
    <div className="companyRules" data-company-rules={saved.length}>
      <span className="label">Reapply rules for {company}</span>
      {suggestions.map((d, i) => {
        const date = dates[i] ?? d.suggested ?? nextSeptember(today);
        const value = valueOf(d, role, date);
        return (
          <div key={`${d.rule_type}-${i}`} className="companyRules__suggestion" data-rule-suggestion={d.rule_type}>
            <p className="cvHelp">
              Your notes say: &ldquo;{d.source_text}&rdquo;
            </p>
            <div className="actions">
              {d.needs === "date" && (
                <label className="deadlineEditor__field">
                  <span className="cvHelp">No new applications until (check the email)</span>
                  <input type="date" className="textInput" value={date} onChange={(e) => setDates((all) => ({ ...all, [i]: e.target.value }))} data-rule-date />
                </label>
              )}
              <button
                type="button"
                className="appsActionBtn"
                disabled={!value || busy === `s${i}`}
                onClick={() => void save(`s${i}`, { rule_type: d.rule_type, value, anchor_date: d.anchor_date, source_text: d.source_text, source: "notes" })}
                data-rule-save
              >
                {busy === `s${i}` ? "Saving…" : d.rule_type === "reapply_after_days" ? `Save: wait ${d.value} days` : d.rule_type === "same_role_block" ? `Save: not ${role || "this role"} again` : "Save this rule"}
              </button>
            </div>
          </div>
        );
      })}
      {saved.length > 0 && (
        <ul className="companyRules__list">
          {saved.map((r) => {
            const { line, inForce } = describeRule(r, rows, today);
            return (
              <li key={r.id ?? `${r.rule_type}-${r.value}`} data-rule={r.rule_type} data-rule-off={r.dismissed_at ? "true" : undefined}>
                <span className={r.dismissed_at ? "cvHelp companyRules__off" : undefined}>
                  {line}
                  {r.dismissed_at ? " (switched off)" : inForce ? "" : " (ended)"}
                </span>
                {r.source_text ? <span className="cvHelp"> &ldquo;{r.source_text}&rdquo;</span> : null}{" "}
                <button type="button" className="inlineLink" disabled={busy === r.id} onClick={() => void toggle(r)} data-rule-toggle>
                  {r.dismissed_at ? "Switch on" : "Switch off"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {!adding ? (
        <button type="button" className="inlineLink" onClick={() => { setAdding(true); setForm({ type: "reapply_after_days", value: "", source: "" }); }} data-rule-add>
          Add a reapply rule
        </button>
      ) : (
        <form
          className="companyRules__form"
          onSubmit={async (e) => {
            e.preventDefault();
            const value = form.type === "same_role_block" ? form.value || role : form.value;
            if (await save("form", { rule_type: form.type, value, source_text: form.source })) setAdding(false);
          }}
        >
          <select className="appsCellSelect" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as RuleType, value: "" })} aria-label="Kind of rule">
            {RULE_TYPES.map((t) => <option key={t} value={t}>{RULE_TYPE_LABELS[t]}</option>)}
          </select>
          {form.type === "reapply_after_days" && (
            <input type="number" min={1} max={3650} className="textInput" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} placeholder="Days, e.g. 365" aria-label="Days to wait" />
          )}
          {form.type === "no_reapply_until" && <input type="date" className="textInput" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} aria-label="No new applications until" />}
          {form.type === "same_role_block" && <input type="text" className="textInput" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} placeholder={role || "The role"} aria-label="The role" />}
          <input type="text" className="textInput" maxLength={500} value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder="What they said, e.g. wait at least one year" aria-label="What they said" />
          <button type="submit" className="appsActionBtn" disabled={busy === "form"}>{busy === "form" ? "Saving…" : "Save rule"}</button>
          <button type="button" className="inlineLink" onClick={() => setAdding(false)}>Cancel</button>
        </form>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
