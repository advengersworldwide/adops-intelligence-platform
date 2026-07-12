"use client";

import { useEffect, useRef, useState } from "react";
import { useListPartners, useListClients, useCreatePartnerBill, useUpdatePartnerBill } from "@workspace/api-client-react";
import type { PartnerBill } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

type Ppo = { id: number; code: string; partnerId: number; clientId: number; totalBudget: number };

async function uploadFile(file: File): Promise<{ url: string; name: string }> {
  const fd = new FormData(); fd.append("file", file);
  const res = await fetch("/api/uploads/payment-attachment", { method: "POST", body: fd });
  if (!res.ok) throw new Error("Upload failed");
  const { url } = await res.json();
  return { url, name: file.name };
}

export function CreatePartnerBillDialog({ open, editBill, onClose, onSuccess }: {
  open: boolean; editBill?: PartnerBill; onClose: () => void; onSuccess: () => void;
}) {
  const { toast } = useToast();
  const { data: partners } = useListPartners();
  const { data: clients } = useListClients();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const [partnerId, setPartnerId] = useState<number | null>(null);
  const [clientId, setClientId] = useState<number | null>(null);
  const [ppos, setPpos] = useState<Ppo[]>([]);
  const [ppoId, setPpoId] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [partnerInvoiceNumber, setPin] = useState("");
  const [dateReceived, setDateReceived] = useState("");
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [attachmentName, setAttachmentName] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (open && editBill) {
      setPartnerId(editBill.partnerId); setClientId(editBill.clientId ?? null);
      setPpoId(editBill.partnerPurchaseOrderId ?? null); setAmount(String(editBill.amount));
      setPin(editBill.partnerInvoiceNumber ?? ""); setDateReceived(editBill.dateReceived ?? "");
      setAttachmentUrl(editBill.attachmentUrl ?? ""); setAttachmentName(editBill.attachmentName ?? "");
      setNotes(editBill.notes ?? "");
    } else if (open) {
      setPartnerId(null); setClientId(null); setPpos([]); setPpoId(null); setAmount("");
      setPin(""); setDateReceived(""); setAttachmentUrl(""); setAttachmentName(""); setNotes("");
    }
  }, [open, editBill]);

  useEffect(() => {
    if (partnerId) {
      fetch(`/api/partner-purchase-orders`).then(r => r.json())
        .then((rows: Ppo[]) => setPpos(rows.filter(p => p.partnerId === partnerId && (!clientId || p.clientId === clientId))))
        .catch(() => setPpos([]));
    } else setPpos([]);
  }, [partnerId, clientId]);

  const pickPpo = (id: number) => {
    setPpoId(id);
    const p = ppos.find(x => x.id === id);
    if (p) setAmount(String(p.totalBudget));
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    try { const { url, name } = await uploadFile(file); setAttachmentUrl(url); setAttachmentName(name); toast({ title: "File uploaded" }); }
    catch { toast({ title: "Upload failed", variant: "destructive" }); }
    finally { setUploading(false); }
  };

  const create = useCreatePartnerBill({ mutation: {
    onSuccess: () => { onSuccess(); onClose(); toast({ title: "Partner bill recorded" }); },
    onError: () => toast({ title: "Failed to record bill", variant: "destructive" }),
  }});
  const update = useUpdatePartnerBill({ mutation: {
    onSuccess: () => { onSuccess(); onClose(); toast({ title: "Partner bill updated" }); },
    onError: () => toast({ title: "Failed to update bill", variant: "destructive" }),
  }});

  const submit = () => {
    if (!partnerId || amount.trim() === "") { toast({ title: "Partner and amount are required", variant: "destructive" }); return; }
    const data = {
      partnerId, clientId, partnerPurchaseOrderId: ppoId,
      partnerInvoiceNumber: partnerInvoiceNumber || null, amount: parseFloat(amount),
      attachmentUrl: attachmentUrl || null, attachmentName: attachmentName || null,
      dateReceived: dateReceived || null, notes: notes || null,
    };
    if (editBill) update.mutate({ id: editBill.id, data }); else create.mutate({ data });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{editBill ? "Edit Partner Bill" : "Record Partner Bill"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs space-y-1"><span className="text-muted-foreground">Partner</span>
              <Select value={partnerId ? String(partnerId) : ""} onValueChange={v => setPartnerId(Number(v))}>
                <SelectTrigger><SelectValue placeholder="Partner" /></SelectTrigger>
                <SelectContent>{partners?.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
            </label>
            <label className="text-xs space-y-1"><span className="text-muted-foreground">Client</span>
              <Select value={clientId ? String(clientId) : "none"} onValueChange={v => setClientId(v === "none" ? null : Number(v))}>
                <SelectTrigger><SelectValue placeholder="Client" /></SelectTrigger>
                <SelectContent><SelectItem value="none">None</SelectItem>{clients?.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </label>
          </div>
          <label className="text-xs space-y-1 block"><span className="text-muted-foreground">Partner PO (prefills amount)</span>
            <Select value={ppoId ? String(ppoId) : "none"} onValueChange={v => v === "none" ? setPpoId(null) : pickPpo(Number(v))}>
              <SelectTrigger><SelectValue placeholder="Optional — select a PO" /></SelectTrigger>
              <SelectContent><SelectItem value="none">None</SelectItem>{ppos.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.code} · ${p.totalBudget}</SelectItem>)}</SelectContent>
            </Select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs space-y-1"><span className="text-muted-foreground">Amount (USD)</span>
              <Input type="number" step="0.01" min={0} value={amount} onChange={e => setAmount(e.target.value)} /></label>
            <label className="text-xs space-y-1"><span className="text-muted-foreground">Their Invoice #</span>
              <Input value={partnerInvoiceNumber} onChange={e => setPin(e.target.value)} placeholder="Partner's number" /></label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs space-y-1"><span className="text-muted-foreground">Date Received</span>
              <Input type="date" value={dateReceived} onChange={e => setDateReceived(e.target.value)} /></label>
            <label className="text-xs space-y-1"><span className="text-muted-foreground">Attachment</span>
              <div className="flex items-center gap-2">
                <Input type="file" accept="image/*,.pdf" ref={fileRef} disabled={uploading}
                  onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0])} className="text-xs" />
                {attachmentUrl && <a href={attachmentUrl} target="_blank" rel="noreferrer" className="text-xs text-primary underline">View</a>}
              </div>
            </label>
          </div>
          <Textarea rows={2} placeholder="Notes..." value={notes} onChange={e => setNotes(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={submit} disabled={create.isPending || update.isPending || uploading}>
              {create.isPending || update.isPending ? "Saving..." : editBill ? "Update" : "Record Bill"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
