"use client";

import { Sankey, Tooltip } from "recharts";
import { ResponsiveChart } from "@/components/analytics/ResponsiveChart";
import type { SankeyNodeProps } from "recharts";
import { formatMoney } from "@/lib/analytics/currency";

const FLOW_COLOR = "hsl(221,83%,53%)";

const tooltipStyle = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "8px",
  fontSize: "12px",
};

export interface FlowSankeyProps {
  nodes: { name: string }[];
  links: { source: number; target: number; value: number }[];
  currency?: string;
}

// Custom node renderer: recharts' default Sankey node is an unlabeled
// rectangle, so we draw the bar plus a name label. Sink nodes (no outgoing
// links, i.e. the rightmost partner column) get their label to the left to
// avoid clipping outside the chart; every other node labels to the right.
function FlowNode({ x, y, width, height, payload }: SankeyNodeProps) {
  const isSink = payload.sourceLinks.length === 0;
  const labelX = isSink ? x - 6 : x + width + 6;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={FLOW_COLOR} fillOpacity={0.9} />
      <text
        x={labelX}
        y={y + height / 2}
        dy="0.35em"
        textAnchor={isSink ? "end" : "start"}
        fontSize={11}
        fill="hsl(var(--foreground))"
      >
        {payload.name}
      </text>
    </g>
  );
}

/** Client -> Buying House -> Partner money-flow Sankey. Parent tab/card wraps this. */
export function FlowSankey({ nodes, links, currency }: FlowSankeyProps) {
  if (links.length === 0) {
    return <p className="py-12 text-center text-sm text-muted-foreground">No flow data</p>;
  }

  return (
    <ResponsiveChart width="100%" height={360}>
      <Sankey
        data={{ nodes, links }}
        nodePadding={24}
        node={FlowNode}
        link={{ stroke: FLOW_COLOR, strokeOpacity: 0.2, fill: FLOW_COLOR, fillOpacity: 0.15 }}
        margin={{ top: 8, right: 96, bottom: 8, left: 96 }}
      >
        <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => formatMoney(value, currency)} />
      </Sankey>
    </ResponsiveChart>
  );
}
