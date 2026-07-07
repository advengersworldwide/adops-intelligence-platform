"use client";

import { use, useRef } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { useGetBilling } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PermissionGuard } from "@/components/PermissionGuard";
import { BillingInvoice } from "@/components/billings/BillingInvoice";
import { downloadInvoicePdf } from "@/lib/po-pdf";

function InvoicePage({ id }: { id: number }) {
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const { data: b, isLoading } = useGetBilling(id);

  async function onDownload() {
    if (ref.current && b) await downloadInvoicePdf(ref.current, `${b.invoiceCode ?? "invoice"}.pdf`);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => router.back()} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <Button size="sm" onClick={onDownload} disabled={!b} className="gap-1.5" data-testid="download-invoice-btn">
          <Download className="h-4 w-4" /> Download PDF
        </Button>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-border bg-muted/30 p-6">
        {isLoading || !b ? <Skeleton className="mx-auto h-[600px] w-[800px]" /> : <BillingInvoice ref={ref} b={b} />}
      </div>
    </div>
  );
}

export default function InvoiceRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <PermissionGuard permission="View Billing Detail">
      <InvoicePage id={Number(id)} />
    </PermissionGuard>
  );
}
