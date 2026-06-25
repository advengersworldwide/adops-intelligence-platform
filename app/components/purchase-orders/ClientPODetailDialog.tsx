"use client";

import { useState, useEffect } from "react";
import {
  useListClients, useUpdateClientPurchaseOrder, getListClientPurchaseOrdersQueryKey,
  type ClientPurchaseOrder,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { uploadPoAttachment } from "@/lib/po-attachment";

export function ClientPODetailDialog({ po, startInEdit, onClose }: {
  po: ClientPurchaseOrder | null; startInEdit: boolean; onClose: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: clients } = useListClients();
  const [editing, setEditing] = useState(startInEdit);
  const [clientId, setClientId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (po) { setEditing(startInEdit); setClientId(String(po.clientId)); setFile(null); }
  }, [po, startInEdit]);

  const update = useUpdateClientPurchaseOrder();

  async function onSave() {
    if (!po) return;
    setSubmitting(true);
    try {
      const attach = file ? await uploadPoAttachment(file) : null;
      await update.mutateAsync({ id: po.id, data: {
        clientId: Number(clientId),
        ...(attach ? { attachmentUrl: attach.url, attachmentName: attach.name } : {}),
      }});
      qc.invalidateQueries({ queryKey: getListClientPurchaseOrdersQueryKey() });
      toast({ title: "Purchase order updated" });
      onClose();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Update failed", variant: "destructive" });
    } finally { setSubmitting(false); }
  }

  return (
    <Dialog open={!!po} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{po?.code}{editing ? " — Edit" : ""}</DialogTitle></DialogHeader>
        {po && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Client</Label>
              {editing ? (
                <Select value={clientId} onValueChange={setClientId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{clients?.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              ) : <p className="text-sm">{po.clientName}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-muted-foreground">Buying House</span><p>{po.buyingHouseName ?? "—"}</p></div>
              <div><span className="text-muted-foreground">Created By</span><p>{po.createdByName ?? "—"}</p></div>
            </div>
            <div className="space-y-1.5">
              <Label>Attachment</Label>
              {editing ? (
                <>
                  <Input type="file" accept="image/*,application/pdf,.eml,.msg" onChange={e => setFile(e.target.files?.[0] ?? null)} />
                  <p className="text-xs text-muted-foreground">{file ? file.name : `Current: ${po.attachmentName ?? "file"} (leave empty to keep)`}</p>
                </>
              ) : (
                <a href={po.attachmentUrl} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline">
                  {po.attachmentName ?? "Open attachment"}
                </a>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={onClose}>Close</Button>
              {editing
                ? <Button onClick={onSave} disabled={submitting}>{submitting ? "Saving..." : "Save"}</Button>
                : <Button onClick={() => setEditing(true)}>Edit</Button>}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
