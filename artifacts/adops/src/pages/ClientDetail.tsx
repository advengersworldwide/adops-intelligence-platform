import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { useGetClient, useListBuyingHouseBillingRecords } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

function fmtPkr(n: number) {
  return "PKR " + n.toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export default function ClientDetailPage({ id }: { id: number }) {
  const { data: client, isLoading: clientLoading } = useGetClient(id);

  const buyingHouseId = client?.buyingHouseId ?? null;
  const { data: billingRecords, isLoading: recordsLoading } = useListBuyingHouseBillingRecords(
    buyingHouseId ?? 0
  );

  if (clientLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (!client) return <div className="text-sm text-muted-foreground">Client not found.</div>;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/clients">
          <button className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent">
            <ArrowLeft className="h-4 w-4" />
          </button>
        </Link>
        <h1 className="text-xl font-bold text-foreground">{client.name}</h1>
        {client.buyingHouseName && (
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
            {client.buyingHouseName}
          </span>
        )}
      </div>

      {/* Client Info */}
      <div className="rounded-2xl border border-border bg-card shadow-sm p-5 grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <p className="text-xs text-muted-foreground">Name</p>
          <p className="text-sm font-medium mt-0.5">{client.name}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Buying House</p>
          <p className="text-sm font-medium mt-0.5">{client.buyingHouseName ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Pricing Model</p>
          <span className={cn(
            "inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold mt-0.5",
            client.pricingModel === "fixed"
              ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
              : "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300"
          )}>
            {client.pricingModel}
          </span>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Margin Value</p>
          <p className="text-sm font-medium mt-0.5">
            {client.marginValue != null
              ? client.pricingModel === "percentage" ? `${client.marginValue}%` : `$${client.marginValue}`
              : "—"}
          </p>
        </div>
      </div>

      {/* Billing History */}
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-muted/30">
          <h2 className="text-sm font-semibold text-foreground">Billing History</h2>
          {client.buyingHouseName && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Records for buying house: {client.buyingHouseName}
            </p>
          )}
        </div>
        {!buyingHouseId ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">
            No buying house assigned — no billing history available.
          </p>
        ) : recordsLoading ? (
          <div className="p-5 space-y-2">
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}
          </div>
        ) : !billingRecords?.length ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">No billing records yet.</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="px-5 py-2.5 text-left text-xs font-medium text-muted-foreground">Period</th>
                <th className="px-5 py-2.5 text-left text-xs font-medium text-muted-foreground">Platform</th>
                <th className="px-5 py-2.5 text-left text-xs font-medium text-muted-foreground">Actual Pins</th>
                <th className="px-5 py-2.5 text-left text-xs font-medium text-muted-foreground">Net Margin (PKR)</th>
              </tr>
            </thead>
            <tbody>
              {billingRecords.map(r => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <td className="px-5 py-3 text-sm font-medium">{r.period}</td>
                  <td className="px-5 py-3 text-sm text-muted-foreground">{r.platformName ?? "—"}</td>
                  <td className="px-5 py-3 text-sm">{r.actualPins.toLocaleString()}</td>
                  <td className={cn(
                    "px-5 py-3 text-sm font-medium",
                    r.netMarginPkr < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"
                  )}>
                    {fmtPkr(r.netMarginPkr)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
