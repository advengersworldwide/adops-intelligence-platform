import { useState, useCallback } from "react";
import { Upload, FileText, CheckCircle, XCircle, AlertCircle } from "lucide-react";
import { useUploadData, getListTransactionsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface ParsedRow {
  date: string;
  campaignName: string;
  spend: number;
  cost: number;
}

interface UploadResult {
  imported: number;
  skipped: number;
  errors: string[];
}

export default function UploadPage() {
  const [dragging, setDragging] = useState(false);
  const [parsedRows, setParsedRows] = useState<ParsedRow[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<UploadResult | null>(null);
  const qc = useQueryClient();
  const { toast } = useToast();

  const uploadMutation = useUploadData({
    mutation: {
      onSuccess: (data: UploadResult) => {
        setResult(data);
        qc.invalidateQueries({ queryKey: getListTransactionsQueryKey() });
      },
      onError: () => toast({ title: "Upload failed", variant: "destructive" }),
    },
  });

  const parseCSV = useCallback((text: string, name: string) => {
    setResult(null);
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) {
      toast({ title: "File has no data rows", variant: "destructive" });
      return;
    }
    const headers = lines[0].split(",").map(h => h.trim().toLowerCase().replace(/[^a-z]/g, ""));
    const dateIdx = headers.findIndex(h => h.includes("date"));
    const campaignIdx = headers.findIndex(h => h.includes("campaign"));
    const spendIdx = headers.findIndex(h => h.includes("spend") || h.includes("revenue"));
    const costIdx = headers.findIndex(h => h.includes("cost"));

    if ([dateIdx, campaignIdx, spendIdx, costIdx].some(i => i === -1)) {
      toast({ title: "Could not find required columns (date, campaign, spend, cost)", variant: "destructive" });
      return;
    }

    const rows: ParsedRow[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",");
      const spend = parseFloat(cols[spendIdx]?.replace(/[^0-9.-]/g, "") ?? "");
      const cost = parseFloat(cols[costIdx]?.replace(/[^0-9.-]/g, "") ?? "");
      if (!isNaN(spend) && !isNaN(cost)) {
        rows.push({
          date: cols[dateIdx]?.trim() ?? "",
          campaignName: cols[campaignIdx]?.trim() ?? "",
          spend,
          cost,
        });
      }
    }
    setParsedRows(rows);
    setFileName(name);
  }, [toast]);

  const handleFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = e => parseCSV(e.target?.result as string, file.name);
    reader.readAsText(file);
  }, [parseCSV]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const handleSubmit = () => {
    if (!parsedRows) return;
    uploadMutation.mutate({ data: { rows: parsedRows } });
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-xl font-bold text-foreground">Upload Data</h1>
        <p className="text-sm text-muted-foreground">Import CSV files with spend and cost data. Campaigns are auto-matched by name.</p>
      </div>

      {/* Expected format */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-foreground mb-3">Expected CSV Format</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                {["date", "campaignName", "spend", "cost"].map(h => (
                  <th key={h} className="px-3 py-2 text-left font-medium text-primary">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border">
                <td className="px-3 py-2 text-muted-foreground">2026-01-15</td>
                <td className="px-3 py-2 text-muted-foreground">Q1 Brand Awareness</td>
                <td className="px-3 py-2 text-muted-foreground">15000</td>
                <td className="px-3 py-2 text-muted-foreground">12000</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Campaign names must exactly match existing campaigns. Profit is calculated automatically.</p>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "relative rounded-2xl border-2 border-dashed p-12 text-center transition-all",
          dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30"
        )}
        data-testid="drop-zone"
      >
        <input type="file" accept=".csv,.txt" onChange={onFileInput} className="absolute inset-0 opacity-0 cursor-pointer" data-testid="file-input" />
        <div className="flex flex-col items-center gap-3">
          <div className="rounded-2xl bg-primary/10 p-4 text-primary">
            <Upload className="h-8 w-8" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Drag & drop your CSV file here</p>
            <p className="text-xs text-muted-foreground mt-1">or click to browse files</p>
          </div>
          <p className="text-xs text-muted-foreground">Supports CSV and TXT files</p>
        </div>
      </div>

      {/* Preview */}
      {parsedRows && parsedRows.length > 0 && !result && (
        <div className="rounded-2xl border border-border bg-card shadow-sm">
          <div className="border-b border-border px-5 py-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground">{fileName}</h2>
              <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium">{parsedRows.length} rows</span>
            </div>
          </div>
          <div className="overflow-x-auto max-h-64 overflow-y-auto">
            <table className="w-full">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                <tr className="border-b border-border">
                  {["Date", "Campaign Name", "Spend", "Cost", "Est. Profit"].map(h => (
                    <th key={h} className="px-5 py-2.5 text-left text-xs font-medium text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parsedRows.slice(0, 20).map((row, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    <td className="px-5 py-2 text-xs text-muted-foreground">{row.date}</td>
                    <td className="px-5 py-2 text-xs font-medium text-foreground">{row.campaignName}</td>
                    <td className="px-5 py-2 text-xs">${row.spend.toLocaleString()}</td>
                    <td className="px-5 py-2 text-xs text-muted-foreground">${row.cost.toLocaleString()}</td>
                    <td className={cn("px-5 py-2 text-xs font-semibold", row.spend - row.cost >= 0 ? "text-emerald-600" : "text-red-600")}>
                      ${(row.spend - row.cost).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {parsedRows.length > 20 && (
            <div className="px-5 py-2 text-xs text-muted-foreground border-t border-border">
              Showing first 20 of {parsedRows.length} rows
            </div>
          )}
          <div className="border-t border-border px-5 py-4 flex justify-end gap-3">
            <Button variant="outline" size="sm" onClick={() => { setParsedRows(null); setFileName(""); }}>Clear</Button>
            <Button size="sm" onClick={handleSubmit} disabled={uploadMutation.isPending} data-testid="submit-upload-btn">
              {uploadMutation.isPending ? "Importing..." : `Import ${parsedRows.length} rows`}
            </Button>
          </div>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-foreground mb-4">Import Result</h2>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/40 p-3 flex items-center gap-3">
              <CheckCircle className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              <div>
                <p className="text-lg font-bold text-emerald-700 dark:text-emerald-400">{result.imported}</p>
                <p className="text-xs text-emerald-600 dark:text-emerald-500">Imported</p>
              </div>
            </div>
            <div className="rounded-xl bg-amber-50 dark:bg-amber-950/40 p-3 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              <div>
                <p className="text-lg font-bold text-amber-700 dark:text-amber-400">{result.skipped}</p>
                <p className="text-xs text-amber-600 dark:text-amber-500">Skipped</p>
              </div>
            </div>
            <div className="rounded-xl bg-red-50 dark:bg-red-950/40 p-3 flex items-center gap-3">
              <XCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
              <div>
                <p className="text-lg font-bold text-red-700 dark:text-red-400">{result.errors.length}</p>
                <p className="text-xs text-red-600 dark:text-red-500">Errors</p>
              </div>
            </div>
          </div>
          {result.errors.length > 0 && (
            <div className="rounded-lg bg-muted/50 p-3 space-y-1 max-h-32 overflow-y-auto">
              {result.errors.map((e, i) => (
                <p key={i} className="text-xs text-muted-foreground">{e}</p>
              ))}
            </div>
          )}
          <Button variant="outline" size="sm" className="mt-4" onClick={() => { setResult(null); setParsedRows(null); setFileName(""); }}>
            Upload Another File
          </Button>
        </div>
      )}
    </div>
  );
}
