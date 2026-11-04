"use client";

// The stage tabs (4 Nov 2026, Chunk 13): a real tablist, arrow keys and all. No tab
// reads as selected while an attention card is filtering across them.
import { useEffect, useRef } from "react";
import { TAB_LABELS, type TabKey } from "@/lib/applicationStage";

export type TabChoice = TabKey | "all";

export default function StageTabs({
  tabs, counts, total, selected, panelId, onSelect,
}: {
  tabs: readonly TabChoice[];
  counts: Record<TabKey, number>;
  total: number;
  selected: TabChoice | null;
  panelId?: string;
  onSelect: (tab: TabChoice) => void;
}) {
  const refs = useRef(new Map<TabChoice, HTMLButtonElement>());
  const focusable = selected && tabs.includes(selected) ? selected : tabs[0];

  // On a phone the row scrolls: the selected tab is never left off the edge. Moves only
  // the row, never the page.
  useEffect(() => {
    const el = selected ? refs.current.get(selected) : null;
    const row = el?.parentElement;
    if (!el || !row) return;
    if (el.offsetLeft < row.scrollLeft) row.scrollLeft = el.offsetLeft;
    else if (el.offsetLeft + el.offsetWidth > row.scrollLeft + row.clientWidth) row.scrollLeft = el.offsetLeft + el.offsetWidth - row.clientWidth;
  }, [selected]);

  function move(from: TabChoice, delta: number) {
    const next = tabs[(tabs.indexOf(from) + delta + tabs.length) % tabs.length];
    onSelect(next);
    refs.current.get(next)?.focus();
  }

  return (
    <div className="stageTabs" role="tablist" aria-label="Applications by stage" data-stage-tabs>
      {tabs.map((tab) => (
        <button
          key={tab}
          ref={(el) => {
            if (el) refs.current.set(tab, el);
            else refs.current.delete(tab);
          }}
          type="button"
          role="tab"
          id={`stage-tab-${tab}`}
          aria-selected={selected === tab}
          aria-controls={panelId}
          tabIndex={tab === focusable ? 0 : -1}
          className="stageTab"
          onClick={() => onSelect(tab)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") { e.preventDefault(); move(tab, 1); }
            if (e.key === "ArrowLeft") { e.preventDefault(); move(tab, -1); }
          }}
          data-stage-tab={tab}
        >
          {tab === "all" ? "All" : TAB_LABELS[tab]} <span className="stageTabCount">{tab === "all" ? total : counts[tab]}</span>
        </button>
      ))}
    </div>
  );
}
