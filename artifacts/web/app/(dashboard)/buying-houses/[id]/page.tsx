"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Building2 } from "lucide-react";
import {
  useGetBuyingHouse, useUpdateBuyingHouse, getGetBuyingHouseQueryKey,
  useGetBuyingHouseAnalytics,
  useListAllBillingRecords, useListPartners, useListClients,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";
import { computeRow } from "@/lib/compute-row";
import { useToast } from "@/hooks/use-toast";
import { useHasPermission } from "@/lib/auth/user-context";
import { KycFields, kycFromRecord, kycToPayload, type KycState, EMPTY_KYC } from "@/components/KycFields";
import { PermissionGuard } from "@/components/PermissionGuard";

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-bold text-foreground">{value}</p>
    </div>
  );
}

function fmtPkr(n: number) {
  return "PKR " + n.toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtNum(n: number | null | undefined, d = 2) {
  if (n == null || isNaN(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

const TH = ({ children }: { children?: React.ReactNode }) =>
  <th className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground whitespace-nowrap">{children}</th>;

const TD = ({ children, bold, className }: { children?: React.ReactNode; bold?: boolean; className?: string }) =>
  <td className={cn("px-3 py-2 text-xs whitespace-nowrap", bold && "font-semibold", className)}>{children}</td>;

function BuyingHouseDetailPage({ id }: { id: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const canEdit = useHasPermission("Edit Buying Houses");

  const { data: bh, isLoading: bhLoading } = useGetBuyingHouse(id);
  const { data: analytics, isLoading: analyticsLoading } = useGetBuyingHouseAnalytics(id);
  const { data: allRecords, isLoading: recordsLoading } = useListAllBillingRecords({ buyingHouseId: id });
  const { data: platforms } = useListPartners();
  const { data: clients } = useListClients();
  const updateBH = useUpdateBuyingHouse();

  const [kyc, setKyc] = useState<KycState>(EMPTY_KYC);
  const [bulkDiscountPct, setBulkDiscountPct] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!bh) return;
    setKyc(kycFromRecord(bh));
    setBulkDiscountPct(bh.bulkDiscountPct != null ? String(bh.bulkDiscountPct) : "");
  }, [bh]);

  async function handleSave() {
    if (!bh) return;
    setSaving(true);
    try {
      await updateBH.mutateAsync({ id, data: {
        name: bh.name,
        ...kycToPayload(kyc),
        bulkDiscountPct: bulkDiscountPct.trim() !== "" ? parseFloat(bulkDiscountPct) : null,
      }});
      await qc.invalidateQueries({ queryKey: getGetBuyingHouseQueryKey(id) });
      toast({ title: "Changes saved" });
    } catch { toast({ title: "Failed to save", variant: "destructive" }); }
    finally { setSaving(false); }
  }

  const platformNameMap = Object.fromEntries((platforms ?? []).map(p => [p.id, p.name]));
  const clientNameMap = Object.fromEntries((clients ?? []).map(c => [c.id, c.name]));

  const computed = (allRecords ?? []).map(r => ({
    ...r,
    platformName: platformNameMap[r.platformId] ?? null,
    clientName: r.clientId != null ? (clientNameMap[r.clientId] ?? null) : null,
    ...computeRow({
      appsflyerPins: r.appsflyerPins,
      fraudPins: r.fraudPins,
      payoutRate: String(r.payoutRate ?? 0),
      marginPct: String(r.marginPct ?? 0),
      forexSellingRate: String(r.forexSellingRate ?? 0),
      forexBuyingRate: String(r.forexBuyingRate ?? 0),
      salesTaxPct: String(r.salesTaxPct ?? 0),
      remittanceTaxPct: String(r.remittanceTaxPct ?? 0),
      withholdingTaxPct: String(r.withholdingTaxPct ?? 0),
      bulkDiscountPct: String(r.bulkDiscountPct ?? 0),
      platformBulkDiscountPct: String(r.platformBulkDiscountPct ?? 0),
    }),
  }));

  const bhTotals = computed.reduce((acc, r) => ({
    appsflyerPins: acc.appsflyerPins + r.appsflyerPins,
    fraudPins: acc.fraudPins + r.fraudPins,
    actualPins: acc.actualPins + r.actualPins,
    grossAmtPkr: acc.grossAmtPkr + r.grossAmtPkr,
    bulkDiscountAmt: acc.bulkDiscountAmt + r.bulkDiscountAmt,
    receivablePkr: acc.receivablePkr + r.receivablePkr,
  }), { appsflyerPins: 0, fraudPins: 0, actualPins: 0, grossAmtPkr: 0, bulkDiscountAmt: 0, receivablePkr: 0 });

  if (bhLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
        </div>
      </div>
    );
  }

  if (!bh) return <div className="text-sm text-muted-foreground">Buying house not found.</div>;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/buying-houses">
          <button className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent">
            <ArrowLeft className="h-4 w-4" />
          </button>
        </Link>
        <Building2 className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-xl font-bold text-foreground">{bh.name}</h1>
      </div>

      {/* Details — KYC + Bulk Discount */}
      <KycFields value={kyc} onChange={setKyc} disabled={!canEdit} />
      <div className="rounded-lg border border-border bg-card p-5 max-w-xs space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">Bulk Discount %</span>
        <Input type="number" step="0.01" value={bulkDiscountPct} disabled={!canEdit}
          onChange={e => setBulkDiscountPct(e.target.value)} placeholder="e.g. 5" />
      </div>
      {canEdit && (
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save Changes"}</Button>
        </div>
      )}

      {/* KPI Cards */}
      {analyticsLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard label="Total Receivable" value={fmtPkr(analytics?.totalReceivablePkr ?? 0)} />
          <KpiCard label="Total Payable" value={fmtPkr(analytics?.totalPayablePkr ?? 0)} />
          <KpiCard label="Net Margin" value={fmtPkr(analytics?.netMarginPkr ?? 0)} />
          <KpiCard label="Margin %" value={`${(analytics?.marginPct ?? 0).toFixed(1)}%`} />
        </div>
      )}

      {/* Monthly Trend Chart */}
      {analytics && analytics.monthlyTrend.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-foreground mb-4">Monthly Net Margin (PKR)</h2>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={analytics.monthlyTrend}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="period" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => (v / 1000).toFixed(0) + "K"} />
              <Tooltip formatter={(v: number) => fmtPkr(v)} />
              <Area type="monotone" dataKey="netMarginPkr" name="Net Margin"
                stroke="hsl(var(--primary))" fill="hsl(var(--primary) / 0.1)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Client List */}
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-muted/30">
          <h2 className="text-sm font-semibold text-foreground">Clients under this buying house</h2>
        </div>
        {analyticsLoading ? (
          <div className="p-5 space-y-2">
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}
          </div>
        ) : !analytics?.clients.length ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">No clients assigned yet</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="px-5 py-2.5 text-left text-xs font-medium text-muted-foreground">Client</th>
              </tr>
            </thead>
            <tbody>
              {analytics.clients.map(c => (
                <tr key={c.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <td className="px-5 py-3 text-sm font-medium text-foreground">{c.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* BH Data */}
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-muted/30">
          <h2 className="text-sm font-semibold text-foreground">Data</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Billing records for this buying house</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-max">
            <thead>
              <tr className="border-b border-border bg-muted/20">
                <TH>Client</TH><TH>Period</TH><TH>Partner</TH>
                <TH>MMP Pins</TH><TH>Fraud Pins</TH><TH>Actual Pins</TH>
                <TH>Gross Amt (PKR)</TH><TH>BH Discount</TH><TH>Receivable (PKR)</TH>
              </tr>
            </thead>
            <tbody>
              {recordsLoading ? (
                [...Array(3)].map((_, i) => (
                  <tr key={i} className="border-b border-border">
                    {[...Array(9)].map((_, j) => <td key={j} className="px-3 py-2"><Skeleton className="h-3 w-16" /></td>)}
                  </tr>
                ))
              ) : computed.length === 0 ? (
                <tr><td colSpan={9} className="px-5 py-10 text-center text-sm text-muted-foreground">No billing records</td></tr>
              ) : (
                <>
                  {computed.map(r => (
                    <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/20">
                      <TD bold>{r.clientName ?? "—"}</TD>
                      <TD bold>{r.period}</TD>
                      <TD>{r.platformName ?? "—"}</TD>
                      <TD>{r.appsflyerPins.toLocaleString()}</TD>
                      <TD>{r.fraudPins.toLocaleString()}</TD>
                      <TD bold>{r.actualPins.toLocaleString()}</TD>
                      <TD>{fmtNum(r.grossAmtPkr)}</TD>
                      <TD>{fmtNum(r.bulkDiscountAmt)}</TD>
                      <TD bold className={r.receivablePkr < 0 ? "text-red-600" : ""}>{fmtNum(r.receivablePkr)}</TD>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-border bg-muted/30">
                    <TD bold>Total</TD><TD></TD><TD></TD>
                    <TD bold>{bhTotals.appsflyerPins.toLocaleString()}</TD>
                    <TD bold>{bhTotals.fraudPins.toLocaleString()}</TD>
                    <TD bold>{bhTotals.actualPins.toLocaleString()}</TD>
                    <TD bold>{fmtNum(bhTotals.grossAmtPkr)}</TD>
                    <TD bold>{fmtNum(bhTotals.bulkDiscountAmt)}</TD>
                    <TD bold className={bhTotals.receivablePkr < 0 ? "text-red-600" : "text-emerald-600"}>{fmtNum(bhTotals.receivablePkr)}</TD>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function BuyingHouseDetailRoute() {
  const { id } = useParams<{ id: string }>();
  return (
    <PermissionGuard permission="View Buying Houses">
      <BuyingHouseDetailPage id={parseInt(id, 10)} />
    </PermissionGuard>
  );
}
