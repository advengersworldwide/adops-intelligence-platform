// app/app/(dashboard)/upload/page.tsx
"use client";

import { useCallback, useMemo, useState } from "react";
import { Upload, FileText, CheckCircle, XCircle, AlertCircle, Download } from "lucide-react";
import {
  useRunImport,
  getListClientPurchaseOrdersQueryKey,
  getListPartnerPurchaseOrdersQueryKey,
  getListPartnerBillsQueryKey,
} from "@workspace/api-client-react";
import type { ImportResult } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import Papa from "papaparse";
import { PermissionGuard } from "@/components/PermissionGuard";
import { parseDelimited } from "@/lib/import/parse";
import { autoMapColumns } from "@/lib/import/map-columns";
import { importCatalog, getCatalogEntry } from "@/lib/import/catalog";

// Which list query to refresh after a successful import, per type.
const listKeyByType: Record<string, () => readonly unknown[]> = {
  "client-purchase-orders": getListClientPurchaseOrdersQueryKey,
  "partner-purchase-orders": getListPartnerPurchaseOrdersQueryKey,
  "partner-bills": getListPartnerBillsQueryKey,
};

export default function ImportPage() {
  const [importType, setImportType] = useState(importCatalog[0].type);
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const qc = useQueryClient();
  const { toast } = useToast();

  const entry = getCatalogEntry(importType)!;
  const columns = entry.columns;

  const missingRequired = useMemo(
    () => columns.filter((c) => c.required && mapping[c.key] == null).map((c) => c.label),
    [columns, mapping],
  );

  const runImportMutation = useRunImport({
    mutation: { onError: () => toast({ title: "Import failed", variant: "destructive" }) },
  });

  const reset = () => {
    setFileName(""); setHeaders([]); setRows([]); setMapping({}); setPreview(null); setResult(null);
  };

  const handleFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const parsed = parseDelimited(e.target?.result as string);
      if (parsed.rows.length === 0) {
        toast({ title: "File has no data rows", variant: "destructive" });
        return;
      }
      setFileName(file.name);
      setHeaders(parsed.headers);
      setRows(parsed.rows);
      setMapping(autoMapColumns(parsed.headers, columns));
      setPreview(null);
      setResult(null);
    };
    reader.readAsText(file);
  }, [columns, toast]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const runDryRun = () => {
    runImportMutation.mutate(
      { type: importType, data: { mapping, rows, dryRun: true } },
      { onSuccess: (data: ImportResult) => {
          setPreview(data);
          if (data.fileErrors.length) toast({ title: data.fileErrors.join("; "), variant: "destructive" });
        } },
    );
  };

  const runCommit = () => {
    runImportMutation.mutate(
      { type: importType, data: { mapping, rows, dryRun: false } },
      { onSuccess: (data: ImportResult) => {
          setResult(data);
          const keyFn = listKeyByType[importType];
          if (keyFn) qc.invalidateQueries({ queryKey: keyFn() });
        } },
    );
  };

  const downloadSample = () => {
    const csv = Papa.unparse([columns.map((c) => c.label), ...entry.sampleRows]);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${importType}-sample.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const downloadErrors = (res: ImportResult) => {
    const bad = res.rows.filter((r) => r.status !== "valid");
    const csv = Papa.unparse([["row", "status", "messages"], ...bad.map((r) => [r.rowNumber, r.status, r.messages.join(" | ")])]);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${importType}-errors.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const statusClass = (s: string) =>
    s === "valid" ? "text-emerald-600" : s === "skip" ? "text-amber-600" : "text-red-600";

  return (
    <PermissionGuard permission="Upload Data">
      <div className="space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">Import Data</h1>
            <p className="text-sm text-muted-foreground">Bulk-import records from a CSV/TSV file. Entities are matched by name.</p>
          </div>
          <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={downloadSample}>
            <Download className="h-3.5 w-3.5" /> Download sample CSV
          </Button>
        </div>

        {/* Type selector */}
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <label className="text-sm font-semibold text-foreground">Data type</label>
          <Select value={importType} onValueChange={(v) => { setImportType(v); reset(); }}>
            <SelectTrigger className="mt-2 w-72 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {importCatalog.map((d) => (
                <SelectItem key={d.type} value={d.type}>{d.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Expected columns */}
        <div className="rounded-2xl border border-border bg-card shadow-sm">
          <div className="border-b border-border px-5 py-4">
            <h2 className="text-sm font-semibold text-foreground">Expected columns</h2>
            <p className="text-xs text-muted-foreground">Your CSV/TSV should include these columns (any header order; names are auto-matched).</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40">
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Column</th>
                  <th className="px-4 py-2 font-medium">Required</th>
                  <th className="px-4 py-2 font-medium">Example</th>
                  <th className="px-4 py-2 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody>
                {columns.map((c) => (
                  <tr key={c.key} className="border-b border-border last:border-0">
                    <td className="px-4 py-2 font-medium text-foreground">{c.label}</td>
                    <td className="px-4 py-2">{c.required ? <span className="text-red-500">Required</span> : <span className="text-muted-foreground">Optional</span>}</td>
                    <td className="px-4 py-2 text-muted-foreground">{c.example || "—"}</td>
                    <td className="px-4 py-2 text-muted-foreground">{c.note ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            "relative rounded-2xl border-2 border-dashed p-12 text-center transition-all",
            dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30",
          )}
          data-testid="drop-zone"
        >
          <input
            type="file" accept=".csv,.tsv,.txt"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
            className="absolute inset-0 opacity-0 cursor-pointer" data-testid="file-input"
          />
          <div className="flex flex-col items-center gap-3">
            <div className="rounded-2xl bg-primary/10 p-4 text-primary"><Upload className="h-8 w-8" /></div>
            <p className="text-sm font-semibold text-foreground">Drag &amp; drop your CSV/TSV file</p>
            <p className="text-xs text-muted-foreground">or click to browse</p>
          </div>
        </div>

        {/* Mapping + preview trigger */}
        {rows.length > 0 && !result && (
          <div className="rounded-2xl border border-border bg-card shadow-sm">
            <div className="border-b border-border px-5 py-4 flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground">{fileName}</h2>
              <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium">{rows.length} rows</span>
            </div>
            <div className="p-5 grid gap-3 sm:grid-cols-2">
              {columns.map((col) => (
                <div key={col.key} className="flex items-center gap-2">
                  <span className="w-32 text-xs text-muted-foreground">
                    {col.label}{col.required && <span className="text-red-500"> *</span>}
                  </span>
                  <Select
                    value={mapping[col.key] != null ? String(mapping[col.key]) : "none"}
                    onValueChange={(v) => setMapping((m) => {
                      const next = { ...m };
                      if (v === "none") delete next[col.key]; else next[col.key] = parseInt(v, 10);
                      return next;
                    })}
                  >
                    <SelectTrigger className="w-44 text-xs"><SelectValue placeholder="Not mapped" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— not mapped —</SelectItem>
                      {headers.map((h, i) => <SelectItem key={i} value={String(i)}>{h}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
            <div className="border-t border-border px-5 py-4 flex items-center justify-end gap-3">
              {missingRequired.length > 0 && (
                <span className="mr-auto text-xs text-red-600">Map required column(s): {missingRequired.join(", ")}</span>
              )}
              <Button variant="outline" size="sm" onClick={reset}>Clear</Button>
              <Button size="sm" disabled={missingRequired.length > 0 || runImportMutation.isPending} onClick={runDryRun} data-testid="preview-btn">
                {runImportMutation.isPending ? "Checking…" : "Preview"}
              </Button>
            </div>
          </div>
        )}

        {/* Preview results */}
        {preview && !result && preview.fileErrors.length === 0 && (
          <div className="rounded-2xl border border-border bg-card shadow-sm">
            <div className="border-b border-border px-5 py-4 flex items-center gap-4 text-xs">
              <span className="text-emerald-600 font-semibold">{preview.valid} valid</span>
              <span className="text-amber-600 font-semibold">{preview.skipped} skip</span>
              <span className="text-red-600 font-semibold">{preview.errored} error</span>
            </div>
            <div className="max-h-72 overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                  <tr className="border-b border-border">
                    <th className="px-4 py-2 text-left text-muted-foreground">Row</th>
                    <th className="px-4 py-2 text-left text-muted-foreground">Status</th>
                    <th className="px-4 py-2 text-left text-muted-foreground">Messages</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.filter((r) => r.status !== "valid").map((r) => (
                    <tr key={r.rowNumber} className="border-b border-border last:border-0">
                      <td className="px-4 py-1.5">{r.rowNumber}</td>
                      <td className={cn("px-4 py-1.5 font-medium", statusClass(r.status))}>{r.status}</td>
                      <td className="px-4 py-1.5 text-muted-foreground">{r.messages.join("; ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-border px-5 py-4 flex justify-end gap-3">
              <Button variant="outline" size="sm" onClick={() => setPreview(null)}>Back</Button>
              <Button size="sm" disabled={preview.valid === 0 || runImportMutation.isPending} onClick={runCommit} data-testid="import-btn">
                {runImportMutation.isPending ? "Importing…" : `Import ${preview.valid} valid`}
              </Button>
            </div>
          </div>
        )}

        {/* Final result */}
        {result && (
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-foreground mb-4">Import Result</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
              <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/40 p-3 flex items-center gap-3">
                <CheckCircle className="h-5 w-5 text-emerald-600" />
                <div><p className="text-lg font-bold text-emerald-700">{result.valid}</p><p className="text-xs text-emerald-600">Imported</p></div>
              </div>
              <div className="rounded-xl bg-amber-50 dark:bg-amber-950/40 p-3 flex items-center gap-3">
                <AlertCircle className="h-5 w-5 text-amber-600" />
                <div><p className="text-lg font-bold text-amber-700">{result.skipped}</p><p className="text-xs text-amber-600">Skipped</p></div>
              </div>
              <div className="rounded-xl bg-red-50 dark:bg-red-950/40 p-3 flex items-center gap-3">
                <XCircle className="h-5 w-5 text-red-600" />
                <div><p className="text-lg font-bold text-red-700">{result.errored}</p><p className="text-xs text-red-600">Errors</p></div>
              </div>
            </div>
            {(result.errored > 0 || result.skipped > 0) && (
              <Button variant="outline" size="sm" className="mr-2" onClick={() => downloadErrors(result)}>Download error report</Button>
            )}
            <Button variant="outline" size="sm" onClick={reset}>Import another file</Button>
          </div>
        )}
      </div>
    </PermissionGuard>
  );
}