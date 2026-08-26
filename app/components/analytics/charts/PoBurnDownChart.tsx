"use client";

import type { PoPacing } from "@workspace/api-client-react";
import { formatMoney } from "@/lib/analytics/currency";

export function PoBurnDownChart({
  pos,
  currency,
  flat = false,
}: {
  pos: PoPacing[];
  currency?: string;
  flat?: boolean;
}) {
  if (!pos || pos.length === 0) {
    return <p className="py-8 text-center text-xs text-muted-foreground">No partner purchase orders for selected period</p>;
  }

  return (
    <div className={flat ? "space-y-4" : "rounded-2xl border border-border bg-card p-5 shadow-sm"}>
      {!flat && <h2 className="mb-2 text-sm font-semibold text-foreground">PO Burn-Down Pacing</h2>}
      <div className="mb-4 flex flex-wrap gap-3 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ backgroundColor: "hsl(160,84%,39%)" }} /> On pace</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ backgroundColor: "hsl(0,84%,60%)" }} /> Overpacing</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-3 w-px bg-foreground/60" /> Ideal to date</span>
      </div>
      <div className="space-y-5">
        {pos.map((po) => {
          const overpacing = po.overpacePct > 0;
          const fillColor = overpacing ? "hsl(0,84%,60%)" : "hsl(160,84%,39%)";
          const fillPct = po.budget > 0 ? Math.min(100, Math.max(0, (po.consumed / po.budget) * 100)) : 0;
          const idealPct = po.budget > 0 ? Math.min(100, Math.max(0, (po.idealToDate / po.budget) * 100)) : 0;

          return (
            <div key={po.poId}>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="font-medium text-foreground">{po.code}</span>
                <span className="text-muted-foreground">
                  {formatMoney(po.consumed, currency)} / {formatMoney(po.budget, currency)}
                </span>
              </div>
              <div className="relative h-3 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${fillPct}%`, backgroundColor: fillColor }}
                />
                <div
                  className="absolute top-0 h-full w-px bg-foreground/60"
                  style={{ left: `${idealPct}%` }}
                  title={`Ideal to date: ${formatMoney(po.idealToDate, currency)}`}
                />
              </div>
              <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>{po.pctConsumed.toFixed(0)}% consumed</span>
                {po.projectedExhaustion ? (
                  <span className={overpacing ? "text-amber-500" : "text-muted-foreground"}>
                    Proj. exhaustion: {po.projectedExhaustion}
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
