"use client";

import { useState, useEffect } from "react";
import { X } from "lucide-react";
import {
  useListClients, useCreateClientPurchaseOrder, getListClientPurchaseOrdersQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { uploadPoAttachments } from "@/lib/po-attachment";

export function CreateClientPODialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: clients } = useListClients();
  const [clientId, setClientId] = useState<string>("");
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { if (open) { setClientId(""); setFiles([]); } }, [open]);

  const create = useCreateClientPurchaseOrder();

  function addFiles(list: FileList | null) {
    if (!list) return;
    setFiles(prev => [...prev, ...Array.from(list)]);
  }
  function removeFile(idx: number) {
    setFiles(prev => prev.filter((_, i) => i !== idx));
  }

  async function onSubmit() {
    if (!clientId || files.length === 0) {
      toast({ title: "Select a client and attach at least one file", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const attachments = await uploadPoAttachments(files);
      await create.mutateAsync({ data: { clientId: Number(clientId), attachments } });
      qc.invalidateQueries({ queryKey: getListClientPurchaseOrdersQueryKey() });
      toast({ title: "Purchase order created" });
      onClose();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Create failed", variant: "destructive" });
    } finally { setSubmitting(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Create Purchase Order</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Client <span className="text-destructive">*</span></Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger data-testid="cpo-client-select"><SelectValue placeholder="Select a client" /></SelectTrigger>
              <SelectContent>
                {clients?.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Attachments (email / screenshot / PDF) <span className="text-destructive">*</span></Label>
            <Input type="file" multiple accept="image/*,application/pdf,.eml,.msg"
              onChange={e => { addFiles(e.target.files); e.target.value = ""; }} data-testid="cpo-file-input" />
            {files.length > 0 && (
              <ul className="space-y-1 pt-1">
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2 py-1 text-xs">
                    <span className="truncate">{f.name}</span>
                    <button type="button" onClick={() => removeFile(i)} className="shrink-0 text-muted-foreground hover:text-destructive" aria-label={`Remove ${f.name}`}>
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={onSubmit} disabled={submitting} data-testid="submit-cpo-btn">
              {submitting ? "Creating..." : "Create"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
