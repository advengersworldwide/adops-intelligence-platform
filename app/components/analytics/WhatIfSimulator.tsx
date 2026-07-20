"use client";

import { useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import { computeBilling, type ComputeBillingInput } from "@/lib/compute-billing";
import { formatMoney } from "@/lib/analytics/currency";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const BASELINE: ComputeBillingInput = {
  events: [{ eventCount: 1000, billableRate: 5, payoutRate: 3 }],
  forexSellingRate: 280,
  forexBuyingRate: 278,
  remittanceTaxPct: 1,
  salesTaxPct: 16,
  withholdingTaxPct: 4,
  bulkDiscountPct: 5,
  whtApplied: true,
};

export interface WhatIfSimulatorProps {
  initial?: Partial<ComputeBillingInput>;
}

/** Client-only what-if margin simulator: re-runs computeBilling as sliders/inputs change. No endpoint. */
export function WhatIfSimulator({ initial }: WhatIfSimulatorProps) {
  const [state, setState] = useState<ComputeBillingInput>(() => ({
    ...BASELINE,
    ...initial,
    events: initial?.events ?? BASELINE.events,
  }));

  const base = useMemo(() => computeBilling(BASELINE), []);
  const current = useMemo(() => computeBilling(state), [state]);

  const event = state.events[0];

  const updateEvent = (patch: Partial<ComputeBillingInput["events"][number]>) => {
    setState((prev) => ({
      ...prev,
      events: [{ ...prev.events[0], ...patch }],
    }));
  };

  const reset = () => setState(BASELINE);

  const marginDelta = current.netMargin - base.netMargin;
  const marginPctOfReceivable =
    current.netReceivable > 0 ? (current.netMargin / current.netReceivable) * 100 : 0;

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-foreground">What-If Margin Simulator</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Adjust FX, discount, and payout to see live margin impact
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" className="gap-1.5 text-xs text-muted-foreground" onClick={reset}>
          <RotateCcw className="h-3.5 w-3.5" />
          Reset
        </Button>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Controls */}
        <div className="space-y-5">
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="event-count" className="text-xs text-muted-foreground">
                Event Count
              </Label>
              <Input
                id="event-count"
                type="number"
                min={0}
                value={event.eventCount}
                onChange={(e) => updateEvent({ eventCount: Number(e.target.value) })}
                className="text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="billable-rate" className="text-xs text-muted-foreground">
                Billable Rate (USD)
              </Label>
              <Input
                id="billable-rate"
                type="number"
                min={0}
                step={0.01}
                value={event.billableRate}
                onChange={(e) => updateEvent({ billableRate: Number(e.target.value) })}
                className="text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="payout-rate" className="text-xs text-muted-foreground">
                Payout Rate (USD)
              </Label>
              <Input
                id="payout-rate"
                type="number"
                min={0}
                step={0.01}
                value={event.payoutRate}
                onChange={(e) => updateEvent({ payoutRate: Number(e.target.value) })}
                className="text-sm"
              />
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">Forex Selling Rate</Label>
                <span className="text-xs font-medium text-foreground">{state.forexSellingRate.toFixed(0)}</span>
              </div>
              <Slider
                value={[state.forexSellingRate]}
                min={200}
                max={320}
                step={1}
                onValueChange={([v]) => setState((prev) => ({ ...prev, forexSellingRate: v }))}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">Forex Buying Rate</Label>
                <span className="text-xs font-medium text-foreground">{state.forexBuyingRate.toFixed(0)}</span>
              </div>
              <Slider
                value={[state.forexBuyingRate]}
                min={200}
                max={320}
                step={1}
                onValueChange={([v]) => setState((prev) => ({ ...prev, forexBuyingRate: v }))}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">Bulk Discount %</Label>
                <span className="text-xs font-medium text-foreground">{state.bulkDiscountPct.toFixed(1)}%</span>
              </div>
              <Slider
                value={[state.bulkDiscountPct]}
                min={0}
                max={30}
                step={0.5}
                onValueChange={([v]) => setState((prev) => ({ ...prev, bulkDiscountPct: v }))}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">Payout Rate (USD)</Label>
                <span className="text-xs font-medium text-foreground">{event.payoutRate.toFixed(2)}</span>
              </div>
              <Slider
                value={[event.payoutRate]}
                min={0}
                max={10}
                step={0.1}
                onValueChange={([v]) => updateEvent({ payoutRate: v })}
              />
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Switch
              id="wht-applied"
              checked={state.whtApplied}
              onCheckedChange={(whtApplied) => setState((prev) => ({ ...prev, whtApplied }))}
            />
            <Label htmlFor="wht-applied" className="cursor-pointer text-xs text-muted-foreground">
              WHT Applied
            </Label>
          </div>
        </div>

        {/* Results */}
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-border bg-background p-3">
              <p className="text-xs font-medium text-muted-foreground">Net Receivable</p>
              <p className="mt-1 text-xl font-bold tracking-tight text-foreground">
                {formatMoney(current.netReceivable, "PKR")}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-background p-3">
              <p className="text-xs font-medium text-muted-foreground">Net Payable</p>
              <p className="mt-1 text-xl font-bold tracking-tight text-foreground">
                {formatMoney(current.netPayablePkr, "PKR")}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-background p-3">
              <p className="text-xs font-medium text-muted-foreground">Net Margin</p>
              <p
                className={cn(
                  "mt-1 text-xl font-bold tracking-tight",
                  current.netMargin >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
                )}
              >
                {formatMoney(current.netMargin, "PKR")}
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-background p-4">
            <p className="text-xs font-medium text-muted-foreground">Δ vs Baseline (Net Margin)</p>
            <div className="mt-1 flex items-baseline gap-2">
              <span
                className={cn(
                  "text-lg font-bold tracking-tight",
                  marginDelta >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
                )}
              >
                {marginDelta >= 0 ? "+" : ""}
                {formatMoney(marginDelta, "PKR")}
              </span>
              <span className="text-xs text-muted-foreground">
                {marginPctOfReceivable.toFixed(1)}% of receivable
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
