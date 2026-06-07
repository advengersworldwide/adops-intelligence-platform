import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import {
  useGetClient, useListAllBillingRecords, useListPlatforms, useListBuyingHouses,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { computeRow } from "@/lib/computeRow";

function fmtPkr(n: number) {
  return "PKR " + n.toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtNum(n: number | null | undefined, d = 0) {
  if (n == null || isNaN(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

const TH = ({ children }: { children?: React.ReactNode }) =>
  <th className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground whitespace-nowrap">{children}</th>;

const TD = ({ children, bold, className }: { children?: React.ReactNode; bold?: boolean; className?: string }) =>
  <td className={cn("px-3 py-2 text-xs whitespace-nowrap", bold && "font-semibold", className)}>{children}</td>;

export default function ClientDetailPage({ id }: { id: number }) {
  const { data: client, isLoading: clientLoading } = useGetClient(id);

  const { data: billingRecords, isLoading: recordsLoading } = useListAllBillingRecords(
    client?.id != null ? { clientId: client.id } : {}
  );

  const { data: platforms } = useListPlatforms();
  const { data: buyingHouses } = useListBuyingHouses();

  const platformNameMap = Object.fromEntries((platforms ?? []).map(p => [p.id, p.name]));
  const buyingHouseNameMap = Object.fromEntries((buyingHouses ?? []).map(bh => [bh.id, bh.name]));

  const computed = (billingRecords ?? []).map(r => ({
    ...r,
    platformName: platformNameMap[r.platformId] ?? null,
    buyingHouseName: r.buyingHouseName ?? buyingHouseNameMap[r.buyingHouseId] ?? null,
    ...computeRow({
      appsflyerPins: r.appsflyerPins,
      fraudPins: r.fraudPins,
      payoutRate: r.payoutRate ?? 0,
      marginPct: r.marginPct ?? 0,
      forexSellingRate: r.forexSellingRate ?? 0,
      forexBuyingRate: r.forexBuyingRate ?? 0,
      salesTaxPct: r.salesTaxPct ?? 0,
      remittanceTaxPct: r.remittanceTaxPct ?? 0,
      withholdingTaxPct: r.withholdingTaxPct ?? 0,
      bulkDiscountPct: r.bulkDiscountPct ?? 0,
      platformBulkDiscountPct: r.platformBulkDiscountPct ?? 0,
    }),
  }));

  if (clientLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-16 rounded-2xl" />
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
      <div className="rounded-2xl border border-border bg-card shadow-sm p-5 grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-muted-foreground">Name</p>
          <p className="text-sm font-medium mt-0.5">{client.name}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Buying House</p>
          <p className="text-sm font-medium mt-0.5">{client.buyingHouseName ?? "—"}</p>
        </div>
      </div>

      {/* Data */}
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-muted/30">
          <h2 className="text-sm font-semibold text-foreground">Data</h2>
        </div>
        {recordsLoading ? (
          <div className="p-5 space-y-2">
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}
          </div>
        ) : !computed.length ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">No billing records yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <TH>Period</TH>
                  <TH>Via (BH)</TH>
                  <TH>Platform</TH>
                  <TH>MMP Pins</TH>
                  <TH>Fraud Pins</TH>
                  <TH>Actual Pins</TH>
                  <TH>Receivable (PKR)</TH>
                  <TH>Net Margin (PKR)</TH>
                </tr>
              </thead>
              <tbody>
                {computed.map(r => (
                  <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <TD bold>{r.period}</TD>
                    <TD>{r.buyingHouseName ?? "—"}</TD>
                    <TD>{r.platformName ?? "—"}</TD>
                    <TD>{fmtNum(r.appsflyerPins)}</TD>
                    <TD>{fmtNum(r.fraudPins)}</TD>
                    <TD>{fmtNum(r.actualPins)}</TD>
                    <TD className={r.receivablePkr < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}>
                      {fmtPkr(r.receivablePkr)}
                    </TD>
                    <TD bold className={r.netMarginPkr < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}>
                      {fmtPkr(r.netMarginPkr)}
                    </TD>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
