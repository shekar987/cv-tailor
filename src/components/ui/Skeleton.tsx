// Shimmering placeholder bars shown while a card's real content loads —
// replaces the "Loading…" sentences, which left the layout jumping when the
// content arrived. `lines` draws that many bars at decreasing widths.

export default function Skeleton({
  lines = 3,
  label = "Loading",
}: {
  lines?: number;
  label?: string;
}) {
  const widths = ["72%", "94%", "58%", "84%", "40%"];
  return (
    <div className="skeletonStack" role="status" aria-live="polite" aria-label={label}>
      {Array.from({ length: lines }).map((_, i) => (
        <span key={i} className="skeleton" style={{ width: widths[i % widths.length] }} aria-hidden="true" />
      ))}
    </div>
  );
}
