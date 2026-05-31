import { useState } from "react";
import { Trash2, Search, Download, AlertTriangle } from "lucide-react";
import { useListTransactions, useDeleteTransaction, getListTransactionsQueryKey, useListClients, useListPlatforms } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

function fmt(n: number) {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

export default function TransactionsPage() {
  const [search, setSearch] = useState("");
  const [clientFilter, setClientFilter] = useState("all");
  const [platformFilter, setPlatformFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const qc = useQueryClient();
  const { toast } = useToast();

  const params = {
    ...(clientFilter !== "all" ? { clientId: parseInt(clientFilter) } : {}),
    ...(platformFilter !== "all" ? { platformId: parseInt(platformFilter) } : {}),
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
  };

  const { data: transactions, isLoading } = useListTransactions(params);
  const { data: clients } = useListClients();
  const { data: platforms } = useListPlatforms();

  const deleteMutation = useDeleteTransaction({
    mutation: {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getListTransactionsQueryKey() }); toast({ title: "Transaction deleted" }); },
      onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
    },
  });

  const filtered = transactions?.filter(tx =>
    (tx.campaignName ?? "").toLowerCase().includes(search.toLowerCase()) ||
    (tx.clientName ?? "").toLowerCase().includes(search.toLowerCase()) ||
    (tx.platformName ?? "").toLowerCase().includes(search.toLowerCase())
  ) ?? [];

  const exportCSV = () => {
    if (!filtered.length) return;
    const headers = ["Date", "Campaign", "Client", "Platform", "Spend", "Cost", "Profit", "Margin %"];
    const rows = filtered.map(tx => [
      tx.date, tx.campaignName ?? "", tx.clientName ?? "", tx.platformName ?? "",
      tx.spend, tx.cost, tx.profit, tx.marginPct?.toFixed(2) ?? ""
    ]);
    const csv = [headers, ...rows].map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "transactions.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Transactions</h1>
          <p className="text-sm text-muted-foreground">{filtered.length} records</p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={exportCSV} data-testid="export-csv-btn">
          <Download className="h-3.5 w-3.5" /> Export CSV
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 text-sm" />
        </div>
        <Select value={clientFilter} onValueChange={setClientFilter}>
          <SelectTrigger className="w-40 text-sm"><SelectValue placeholder="All clients" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All clients</SelectItem>
            {clients?.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={platformFilter} onValueChange={setPlatformFilter}>
          <SelectTrigger className="w-40 text-sm"><SelectValue placeholder="All platforms" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All platforms</SelectItem>
            {platforms?.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-36 text-sm" placeholder="From" />
        <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-36 text-sm" placeholder="To" />
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5"><div className="h-3 w-3 rounded bg-red-200 dark:bg-red-900" /> Negative profit</div>
        <div className="flex items-center gap-1.5"><div className="h-3 w-3 rounded bg-amber-200 dark:bg-amber-900" /> Low margin (&lt;10%)</div>
      </div>

      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {["Date", "Campaign", "Client", "Platform", "Spend", "Cost", "Profit", "Margin %", ""].map(h => (
                <th key={h} className="px-5 py-3 text-left text-xs font-medium text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(5)].map((_, i) => (
                <tr key={i} className="border-b border-border">
                  {[...Array(9)].map((_, j) => <td key={j} className="px-5 py-3"><Skeleton className="h-4 w-16" /></td>)}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr><td colSpan={9} className="px-5 py-10 text-center text-sm text-muted-foreground">No transactions found</td></tr>
            ) : (
              filtered.map(tx => {
                const isNeg = tx.profit < 0;
                const isLow = !isNeg && (tx.marginPct ?? 100) < 10;
                return (
                  <tr key={tx.id} className={cn(
                    "border-b border-border last:border-0 transition-colors hover:bg-muted/20",
                    isNeg && "bg-red-50/60 dark:bg-red-950/25",
                    isLow && "bg-amber-50/60 dark:bg-amber-950/25"
                  )} data-testid={`transaction-row-${tx.id}`}>
                    <td className="px-5 py-3 text-xs text-muted-foreground">{tx.date}</td>
                    <td className="px-5 py-3 text-sm font-medium text-foreground">{tx.campaignName ?? "—"}</td>
                    <td className="px-5 py-3 text-xs text-muted-foreground">{tx.clientName ?? "—"}</td>
                    <td className="px-5 py-3 text-xs text-muted-foreground">{tx.platformName ?? "—"}</td>
                    <td className="px-5 py-3 text-sm font-medium">{fmt(tx.spend)}</td>
                    <td className="px-5 py-3 text-sm text-muted-foreground">{fmt(tx.cost)}</td>
                    <td className={cn("px-5 py-3 text-sm font-semibold", isNeg ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400")}>
                      {fmt(tx.profit)}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1">
                        {(isNeg || isLow) && <AlertTriangle className={cn("h-3 w-3", isNeg ? "text-red-500" : "text-amber-500")} />}
                        <span className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                          isNeg ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" :
                          isLow ? "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300" :
                          "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300"
                        )}>
                          {tx.marginPct != null ? `${tx.marginPct.toFixed(1)}%` : "—"}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <button onClick={() => deleteMutation.mutate({ id: tx.id })} className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" data-testid={`delete-tx-${tx.id}`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
