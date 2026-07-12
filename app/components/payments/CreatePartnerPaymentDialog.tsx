"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  useListPartnerBills, useListPartnerPayments, useListPayments,
  useCreatePartnerPayment, useUpdatePartnerPayment,
} from "@workspace/api-client-react";
import type { PartnerPayment } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

function fmt(n: number) { return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

async function uploadFile(file: File): Promise<string> {
  const fd = new FormData(); fd.append("file", file);
  const res = await fetch("/api/uploads/payment-attachment", { method: "POST", body: fd });
  if (!res.ok) throw new Error("Upload failed");
  const { url } = await res.json();
  return url as string;
}

export function CreatePartnerPaymentDialog({ open, editPayment, onClose, onSuccess }: {
  open: boolean; editPayment?: PartnerPayment; onClose: () => void; onSuccess: () => void;
}) {
  const { toast } = useToast();
  const { data: bills } = useListPartnerBills();
  const { data: partnerPayments } = useListPartnerPayments();
  const { data: clientPayments } = useListPayments();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const [partnerBillId, setPartnerBillId] = useState<number | null>(null);
  const [sourceClientPaymentId, setSourceId] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState("online");
  const [status, setStatus] = useState("pending");
  const [paymentDate, setPaymentDate] = useState("");
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (open && editPayment) {
      setPartnerBillId(editPayment.partnerBillId); setSourceId(editPayment.sourceClientPaymentId ?? null);
      setAmount(String(editPayment.amount)); setMode(editPayment.mode ?? "online"); setStatus(editPayment.status);
      setPaymentDate(editPayment.paymentDate ?? ""); setAttachmentUrl(editPayment.attachmentUrl ?? ""); setNotes(editPayment.notes ?? "");
    } else if (open) {
      setPartnerBillId(null); setSourceId(null); setAmount(""); setMode("online"); setStatus("pending");
      setPaymentDate(""); setAttachmentUrl(""); setNotes("");
    }
  }, [open, editPayment]);

  // Remaining USD per bill = bill.amount − Σ(all partner payments to it), excluding the one being edited.
  const remainingByBill = useMemo(() => {
    const allocated = new Map<number, number>();
    for (const p of partnerPayments ?? []) {
      if (editPayment && p.id === editPayment.id) continue;
      allocated.set(p.partnerBillId, (allocated.get(p.partnerBillId) ?? 0) + p.amount);
    }
    const m = new Map<number, number>();
    for (const b of bills ?? []) m.set(b.id, b.amount - (allocated.get(b.id) ?? 0));
    return m;
  }, [bills, partnerPayments, editPayment]);

  const receivedClientPayments = (clientPayments ?? []).filter(p => p.status === "received");
  const selectedRemaining = partnerBillId != null ? (remainingByBill.get(partnerBillId) ?? 0) : 0;
  const overAmount = amount.trim() !== "" && parseFloat(amount) > selectedRemaining + 0.01;

  const pickBill = (id: number) => {
    setPartnerBillId(id);
    const rem = remainingByBill.get(id) ?? 0;
    setAmount(rem > 0 ? String(Number(rem.toFixed(2))) : "0");
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    try { const url = await uploadFile(file); setAttachmentUrl(url); toast({ title: "File uploaded" }); }
    catch { toast({ title: "Upload failed", variant: "destructive" }); }
    finally { setUploading(false); }
  };

  const create = useCreatePartnerPayment({ mutation: {
    onSuccess: () => { onSuccess(); onClose(); toast({ title: "Partner payment recorded" }); },
    onError: () => toast({ title: "Failed to record payment", variant: "destructive" }),
  }});
  const update = useUpdatePartnerPayment({ mutation: {
    onSuccess: () => { onSuccess(); onClose(); toast({ title: "Partner payment updated" }); },
    onError: () => toast({ title: "Failed to update payment", variant: "destructive" }),
  }});

  const submit = () => {
    if (!partnerBillId || !sourceClientPaymentId || amount.trim() === "") {
      toast({ title: "Partner bill, funding payment, and amount are required", variant: "destructive" }); return;
    }
    if (overAmount) { toast({ title: "Amount exceeds the bill's remaining", variant: "destructive" }); return; }
    const data = {
      partnerBillId, sourceClientPaymentId, amount: parseFloat(amount), mode, status,
      paymentDate: paymentDate || null, attachmentUrl: attachmentUrl || null, notes: notes || null,
    };
    if (editPayment) update.mutate({ id: editPayment.id, data }); else create.mutate({ data });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{editPayment ? "Edit Partner Payment" : "Record Partner Payment"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <label className="text-xs space-y-1 block"><span className="text-muted-foreground">Partner Bill</span>
            <Select value={partnerBillId ? String(partnerBillId) : ""} onValueChange={v => pickBill(Number(v))}>
              <SelectTrigger><SelectValue placeholder="Select a partner bill" /></SelectTrigger>
              <SelectContent>
                {(bills ?? []).map(b => {
                  const rem = remainingByBill.get(b.id) ?? 0;
                  return <SelectItem key={b.id} value={String(b.id)} disabled={rem <= 0.01 && b.id !== editPayment?.partnerBillId}>
                    {b.code} · {b.partnerName} · rem ${fmt(rem)}
                  </SelectItem>;
                })}
              </SelectContent>
            </Select>
          </label>
          <label className="text-xs space-y-1 block"><span className="text-muted-foreground">Funding Client Payment (received)</span>
            <Select value={sourceClientPaymentId ? String(sourceClientPaymentId) : ""} onValueChange={v => setSourceId(Number(v))}>
              <SelectTrigger><SelectValue placeholder="Select a received client payment" /></SelectTrigger>
              <SelectContent>
                {receivedClientPayments.length === 0
                  ? <SelectItem value="none" disabled>No received client payments</SelectItem>
                  : receivedClientPayments.map(p => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      #{p.id} · PKR {fmt(p.totalAmount)}{p.paymentDate ? " · " + new Date(p.paymentDate).toLocaleDateString() : ""}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs space-y-1"><span className="text-muted-foreground">Amount (USD)</span>
              <Input type="number" step="0.01" min={0} value={amount} onChange={e => setAmount(e.target.value)}
                className={overAmount ? "border-red-600 focus-visible:ring-red-600" : undefined} />
              {partnerBillId != null && <span className="text-[10px] text-muted-foreground">Remaining: ${fmt(selectedRemaining)}</span>}
              {overAmount && <span className="text-[10px] text-red-600 block">Exceeds remaining</span>}
            </label>
            <label className="text-xs space-y-1"><span className="text-muted-foreground">Mode</span>
              <Select value={mode} onValueChange={setMode}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="online">Online Transfer</SelectItem>
                  <SelectItem value="cheque">Cheque</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                </SelectContent>
              </Select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs space-y-1"><span className="text-muted-foreground">Payment Date</span>
              <Input type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)} /></label>
            <label className="text-xs space-y-1"><span className="text-muted-foreground">Status</span>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="settled">Settled</SelectItem>
                </SelectContent>
              </Select>
            </label>
          </div>
          <label className="text-xs space-y-1 block"><span className="text-muted-foreground">Attachment</span>
            <div className="flex items-center gap-2">
              <Input type="file" accept="image/*,.pdf" ref={fileRef} disabled={uploading}
                onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0])} className="text-xs" />
              {attachmentUrl && <a href={attachmentUrl} target="_blank" rel="noreferrer" className="text-xs text-primary underline">View</a>}
            </div>
          </label>
          <Textarea rows={2} placeholder="Notes..." value={notes} onChange={e => setNotes(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={submit} disabled={create.isPending || update.isPending || uploading || overAmount}>
              {create.isPending || update.isPending ? "Saving..." : editPayment ? "Update" : "Record Payment"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
