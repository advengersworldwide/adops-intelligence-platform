"use client";

import { Treemap, Tooltip } from "recharts";
import { ResponsiveChart } from "@/components/analytics/ResponsiveChart";
import type { TreemapNode as RechartsTreemapNode, TreemapProps } from "recharts";
import { buildTreemap } from "@/lib/analytics/treemap";
import { formatMoney } from "@/lib/analytics/currency";

const tooltipStyle = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "8px",
  fontSize: "12px",
};

const STROKE = "hsl(var(--card))";
const CLIENT_FILL = "hsl(221,83%,53%)"; // top-level (depth 1) client tiles
const PARTNER_FILL = "hsl(221,70%,66%)"; // drill (depth 2, leaf) partner tiles — lighter

/**
 * Custom rect+label renderer. Recharts renders one node per depth (0 = the
 * invisible wrapper root, 1 = clients, 2 = partner leaves); we skip depth 0
 * and color 1/2 distinctly so the client→partner nesting reads visually,
 * separated by a card-colored stroke so tiles stay legible in both themes.
 */
function TreemapContent(props: RechartsTreemapNode) {
  const { x, y, width, height, name, depth } = props;
  if (depth === 0 || width <= 0 || height <= 0) {
    return <g />;
  }

  const fill = depth === 1 ? CLIENT_FILL : PARTNER_FILL;
  const showLabel = width > 42 && height > 18;

  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={fill} stroke={STROKE} strokeWidth={depth === 1 ? 2 : 1} />
      {showLabel ? (
        <text
          x={x + 6}
          y={y + 16}
          fontSize={depth === 1 ? 12 : 11}
          fontWeight={depth === 1 ? 600 : 400}
          fill="white"
        >
          {name}
        </text>
      ) : null}
    </g>
  );
}

export interface RevenueTreemapProps {
  cells: { client: string; partner: string; revenue: number }[];
  currency?: string;
}

/** Client -> partner revenue treemap. Reuses /analytics/matrix cell data — no new endpoint. */
export function RevenueTreemap({ cells, currency }: RevenueTreemapProps) {
  const data = buildTreemap(cells);

  if (data.length === 0) {
    return <p className="py-12 text-center text-sm text-muted-foreground">No data</p>;
  }

  return (
    <>
    <ResponsiveChart width="100%" height={340}>
      <Treemap
        // recharts' TreemapDataType requires an index signature our plain
        // { name, children } tree doesn't declare; cast at this boundary only.
        data={data as unknown as TreemapProps["data"]}
        dataKey="size"
        nameKey="name"
        type="flat"
        aspectRatio={4 / 3}
        stroke={STROKE}
        content={TreemapContent}
      >
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(value, name) => [formatMoney(Number(value), currency), String(name)]}
        />
      </Treemap>
    </ResponsiveChart>
    <div className="mt-2 flex flex-wrap justify-center gap-3 text-[10px] text-muted-foreground">
      <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ backgroundColor: "hsl(221,83%,53%)" }} /> Client</span>
      <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ backgroundColor: "hsl(221,70%,66%)" }} /> Partner</span>
    </div>
    </>
  );
}
