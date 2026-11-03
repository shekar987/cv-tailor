"use client";

// The pipeline map: Applied → Screening → Interview → Assessment → Offer → Won, with
// what dropped where. Recharts is loaded only when this view opens (next/dynamic), so
// the plan's first paint never pays for it. Each node is a link to that stage on the
// tracker, by keyboard too, and the table below holds every figure without hovering.
import { useRouter } from "next/navigation";
import { ResponsiveContainer, Sankey, Tooltip } from "recharts";
import { funnelChartData, type Funnel, type FunnelChartNode as ChartNode } from "@/lib/plan";

const NODE_TOKEN: Record<string, string> = {
  applied: "var(--muted)",
  screening: "var(--stage-screening)",
  interview: "var(--stage-interview)",
  assessment: "var(--stage-assessment)",
  offer: "var(--stage-offer)",
  accepted: "var(--stage-won)",
  rejected: "var(--stage-rejected)",
  ghosted: "var(--stage-ghosted)",
};

type NodeProps = { x: number; y: number; width: number; height: number; payload: ChartNode };
type LinkProps = { sourceX: number; targetX: number; sourceY: number; targetY: number; sourceControlX: number; targetControlX: number; linkWidth: number; payload: { source: ChartNode; target: ChartNode; value: number } };

// The tracker's filter for a node: Won opens the accepted tab.
function stageHref(key: string): string {
  return `/applications?status=${encodeURIComponent(key)}`;
}

export default function PipelineChart({ funnel }: { funnel: Funnel }) {
  const router = useRouter();
  const data = funnelChartData(funnel);
  if (data.links.length === 0) return <p className="cvHelp">Nothing has moved past Applied yet, so there is nothing to map.</p>;

  function NodeShape(props: NodeProps) {
    const { x, y, width, height, payload } = props;
    const go = () => router.push(stageHref(payload.key));
    const drawn = Math.max(height, 4);
    return (
      <g
        className="pipeNode"
        role="link"
        tabIndex={0}
        aria-label={`${payload.name}: ${payload.total}. Show on the tracker.`}
        onClick={go}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } }}
        data-pipe-node={payload.key}
      >
        {/* A hit area wider than the mark. */}
        <rect x={x - 8} y={y - 6} width={width + 16} height={drawn + 12} fill="transparent" />
        <rect x={x} y={y} width={width} height={drawn} rx={2} fill={NODE_TOKEN[payload.key] ?? "var(--muted)"} />
        <text x={x + width + 8} y={y + drawn / 2} dominantBaseline="middle" className="pipeLabel">
          {payload.name} <tspan className="pipeValue">{payload.total}</tspan>
        </text>
      </g>
    );
  }

  function LinkShape(props: LinkProps) {
    const { sourceX, targetX, sourceY, targetY, sourceControlX, targetControlX, linkWidth, payload } = props;
    return (
      <path
        d={`M${sourceX},${sourceY} C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
        fill="none"
        stroke={NODE_TOKEN[payload.target.key] ?? "var(--muted)"}
        strokeOpacity={0.32}
        strokeWidth={Math.max(linkWidth, 1.5)}
        className="pipeLink"
      />
    );
  }

  return (
    <div className="pipeWrap" data-pipeline>
      <div className="pipeChart" style={{ height: 380 }}>
        <ResponsiveContainer width="100%" height="100%">
          <Sankey
            data={data}
            node={NodeShape as never}
            link={LinkShape as never}
            nodePadding={28}
            nodeWidth={10}
            sort={false}
            iterations={32}
            margin={{ top: 12, right: 112, bottom: 12, left: 8 }}
          >
            <Tooltip wrapperClassName="pipeTooltip" isAnimationActive={false} />
          </Sankey>
        </ResponsiveContainer>
      </div>
      <p className="cvHelp">
        Select a stage to see those applications on the tracker. Stages have been recorded only since 3 November 2026, so an earlier rejection counts at Applied whatever stage it reached.
        {funnel.excluded > 0 ? ` ${funnel.excluded} unsent or withdrawn ${funnel.excluded === 1 ? "application is" : "applications are"} not counted.` : ""}
      </p>
      <details className="pipeTableWrap">
        <summary className="inlineLink">As a table</summary>
        <table className="pipeTable" data-pipe-table>
          <thead>
            <tr><th scope="col">Stage</th><th scope="col">Reached</th><th scope="col">Here now</th><th scope="col">Rejected here</th><th scope="col">Ghosted here</th><th scope="col">Went further</th></tr>
          </thead>
          <tbody>
            {funnel.nodes.map((n) => (
              <tr key={n.key}>
                <th scope="row">{n.label}</th>
                <td>{n.count}</td>
                <td>{n.here}</td>
                <td>{n.rejected}</td>
                <td>{n.ghosted}</td>
                <td>{n.key === "accepted" ? "" : n.tooFew ? "Too few to judge" : `${Math.round((n.furtherRate ?? 0) * 100)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
