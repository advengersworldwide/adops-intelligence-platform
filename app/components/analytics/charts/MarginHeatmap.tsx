"use client";

import type { MatrixResponse } from "@workspace/api-client-react";
import { formatMoney } from "@/lib/analytics/currency";

const KEY_SEP = "::";

/**
 * Diverging color scale for margin%, intensity scaled by magnitude:
 * <0 red, 0-15 amber, 15-30 light green, >30 emerald.
 */
function colorFor(marginPct: number): { background: string; text: string } {
  if (marginPct < 0) {
    const t = Math.min(Math.abs(marginPct), 40) / 40;
    const lightness = 90 - t * 35; // 90% (barely negative) -> 55% (deeply negative)
    return { background: `hsl(0, 84%, ${lightness}%)`, text: lightness < 68 ? "white" : "hsl(0, 70%, 25%)" };
  }
  if (marginPct < 15) {
    const t = marginPct / 15;
    const lightness = 90 - t * 18; // 90% -> 72%
    return { background: `hsl(45, 96%, ${lightness}%)`, text: "hsl(30, 80%, 20%)" };
  }
  if (marginPct < 30) {
    const t = (marginPct - 15) / 15;
    const lightness = 88 - t * 20; // 88% -> 68%
    return { background: `hsl(140, 60%, ${lightness}%)`, text: "hsl(140, 60%, 16%)" };
  }
  const t = Math.min((marginPct - 30) / 30, 1);
  const lightness = 72 - t * 27; // 72% -> 45%
  return { background: `hsl(160, 84%, ${lightness}%)`, text: lightness < 55 ? "white" : "hsl(160, 84%, 15%)" };
}

export function MarginHeatmap({ matrix, currency }: { matrix: MatrixResponse; currency?: string }) {
  if (!matrix || matrix.clients.length === 0) {
    return <p className="py-12 text-center text-sm text-muted-foreground">No data</p>;
  }

  const cellByKey = new Map(matrix.cells.map((c) => [`${c.client}${KEY_SEP}${c.partner}`, c]));

  return (
    <div>
      <div className="overflow-x-auto">
      <div
        className="grid w-fit min-w-full"
        style={{ gridTemplateColumns: `minmax(120px, 160px) repeat(${matrix.partners.length}, minmax(64px, 1fr))` }}
      >
        <div className="sticky left-0 border-b border-border bg-card" />
        {matrix.partners.map((partner) => (
          <div
            key={partner}
            title={partner}
            className="truncate border-b border-border px-2 py-2 text-center text-xs font-medium text-muted-foreground"
          >
            {partner}
          </div>
        ))}

        {matrix.clients.map((client) => (
          <div key={client} className="contents">
            <div
              title={client}
              className="sticky left-0 truncate border-b border-border bg-card px-2 py-2 text-xs font-medium text-foreground"
            >
              {client}
            </div>
            {matrix.partners.map((partner) => {
              const cell = cellByKey.get(`${client}${KEY_SEP}${partner}`);
              if (!cell) {
                return (
                  <div
                    key={partner}
                    title={`${client} × ${partner}: no data`}
                    className="flex min-h-9 items-center justify-center border-b border-border py-2 text-xs text-muted-foreground"
                  >
                    {"–"}
                  </div>
                );
              }
              const { background, text } = colorFor(cell.marginPct);
              return (
                <div
                  key={partner}
                  title={`${client} × ${partner}: ${cell.marginPct.toFixed(1)}% • ${formatMoney(cell.revenue, currency)}`}
                  className="flex min-h-9 items-center justify-center border-b border-border py-2 text-xs font-semibold"
                  style={{ backgroundColor: background, color: text }}
                >
                  {cell.marginPct.toFixed(0)}%
                </div>
              );
            })}
          </div>
        ))}
      </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-3 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1"><span className="h-2 w-3 rounded-sm" style={{ backgroundColor: "hsl(0,84%,72%)" }} /> Negative</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-3 rounded-sm" style={{ backgroundColor: "hsl(45,96%,80%)" }} /> 0–15%</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-3 rounded-sm" style={{ backgroundColor: "hsl(140,60%,78%)" }} /> 15–30%</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-3 rounded-sm" style={{ backgroundColor: "hsl(160,84%,55%)" }} /> &gt;30%</span>
      </div>
    </div>
  );
}
