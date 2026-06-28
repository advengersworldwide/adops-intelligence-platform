"use client";

import { useState, useEffect } from "react";
import { X } from "lucide-react";
import {
  useListClients, useUpdateClientPurchaseOrder, getListClientPurchaseOrdersQueryKey,
  type ClientPurchaseOrder, type ClientPurchaseOrderAttachment,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { uploadPoAttachments } from "@/lib/po-attachment";

export function ClientPODetailDialog({ po, startInEdit, onClose }: {
  po: ClientPurchaseOrder | null; startInEdit: boolean; onClose: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: clients } = useListClients();
  const [editing, setEditing] = useState(startInEdit);
  const [clientId, setClientId] = useState("");
  const [kept, setKept] = useState<ClientPurchaseOrderAttachment[]>([]);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (po) { setEditing(startInEdit); setClientId(String(po.clientId)); setKept(po.attachments ?? []); setNewFiles([]); }
  }, [po, startInEdit]);

  const update = useUpdateClientPurchaseOrder();

  async function onSave() {
    if (!po) return;
    if (kept.length === 0 && newFiles.length === 0) {
      toast({ title: "Keep or add at least one attachment", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const uploaded = newFiles.length ? await uploadPoAttachments(newFiles) : [];
      const attachments = [...kept, ...uploaded];
      await update.mutateAsync({ id: po.id, data: { clientId: Number(clientId), attachments } });
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
              <Label>Attachments</Label>
              {editing ? (
                <>
                  {kept.length > 0 && (
                    <ul className="space-y-1">
                      {kept.map((a, i) => (
                        <li key={`${a.url}-${i}`} className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2 py-1 text-xs">
                          <a href={a.url} target="_blank" rel="noreferrer" className="truncate text-primary hover:underline">{a.name ?? "Attachment"}</a>
                          <button type="button" onClick={() => setKept(prev => prev.filter((_, j) => j !== i))}
                            className="shrink-0 text-muted-foreground hover:text-destructive" aria-label="Remove attachment">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {newFiles.map((f, i) => (
                    <div key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2 py-1 text-xs">
                      <span className="truncate">{f.name} <span className="text-muted-foreground">(new)</span></span>
                      <button type="button" onClick={() => setNewFiles(prev => prev.filter((_, j) => j !== i))}
                        className="shrink-0 text-muted-foreground hover:text-destructive" aria-label="Remove file">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  <Input type="file" multiple accept="image/*,application/pdf,.eml,.msg"
                    onChange={e => { const l = e.target.files; if (l) setNewFiles(prev => [...prev, ...Array.from(l)]); e.target.value = ""; }} />
                </>
              ) : (
                <ul className="space-y-1">
                  {(po.attachments ?? []).map((a, i) => (
                    <li key={`${a.url}-${i}`}>
                      <a href={a.url} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline">
                        {a.name ?? "Open attachment"}
                      </a>
                    </li>
                  ))}
                  {(po.attachments?.length ?? 0) === 0 && <p className="text-sm text-muted-foreground">No attachments</p>}
                </ul>
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
