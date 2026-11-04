"use client";

import { useState } from "react";
import { POOL_COUNT_CHOICES, normalizePoolSettings, poolSummaryLine, type PoolCount, type PoolOrder, type PoolSettings } from "@/lib/projectPool";

// "Projects: Auto (2) · Most relevant", with a way to change one run without touching the defaults.
export default function PoolRunLine({ settings, count, onChange }: { settings: PoolSettings; count: number; onChange: (next: PoolSettings) => void }) {
  const [editing, setEditing] = useState(false);
  return (
    <span className="poolRunLine" data-pool-run>
      Projects: {poolSummaryLine(settings, count)}{" "}
      <button type="button" className="inlineLink" aria-expanded={editing} onClick={() => setEditing((v) => !v)} data-pool-run-edit>edit</button>
      {editing && (
        <span className="poolRunEdit">
          <select
            className="appsToolSelect"
            aria-label="Projects on this CV"
            value={String(settings.count)}
            onChange={(e) => onChange(normalizePoolSettings({ ...settings, count: e.target.value === "auto" ? "auto" : (Number(e.target.value) as PoolCount) }))}
            data-pool-run-count
          >
            {POOL_COUNT_CHOICES.map((c) => <option key={String(c)} value={String(c)}>{c === "auto" ? "Auto" : c}</option>)}
          </select>
          <select
            className="appsToolSelect"
            aria-label="Order of the projects on this CV"
            value={settings.order}
            onChange={(e) => onChange({ ...settings, order: e.target.value as PoolOrder })}
            data-pool-run-order
          >
            <option value="relevance">Most relevant first</option>
            <option value="date">Newest first</option>
          </select>
          <span className="cvHelp">For this run. Change the defaults on <a href="/customize#advanced" className="inlineLink">Customize</a>.</span>
        </span>
      )}
    </span>
  );
}
