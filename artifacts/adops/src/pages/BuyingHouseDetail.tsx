import { Link } from "wouter";
import { ArrowLeft, Building2 } from "lucide-react";
import { useGetBuyingHouse, useGetBuyingHouseAnalytics } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";

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

export default function BuyingHouseDetailPage({ id }: { id: number }) {
  const { data: bh, isLoading: bhLoading } = useGetBuyingHouse(id);
  const { data: analytics, isLoading: analyticsLoading } = useGetBuyingHouseAnalytics(id);

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
              <Area
                type="monotone"
                dataKey="netMarginPkr"
                name="Net Margin"
                stroke="hsl(var(--primary))"
                fill="hsl(var(--primary) / 0.1)"
                strokeWidth={2}
              />
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
    </div>
  );
}
