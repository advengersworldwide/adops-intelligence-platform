"use client";

import { useState, useEffect } from "react";
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
import { uploadPoAttachment } from "@/lib/po-attachment";

export function CreateClientPODialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: clients } = useListClients();
  const [clientId, setClientId] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { if (open) { setClientId(""); setFile(null); } }, [open]);

  const create = useCreateClientPurchaseOrder();

  async function onSubmit() {
    if (!clientId || !file) { toast({ title: "Select a client and attach a file", variant: "destructive" }); return; }
    setSubmitting(true);
    try {
      const { url, name } = await uploadPoAttachment(file);
      await create.mutateAsync({ data: { clientId: Number(clientId), attachmentUrl: url, attachmentName: name } });
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
            <Label>Attachment (email / screenshot / PDF) <span className="text-destructive">*</span></Label>
            <Input type="file" accept="image/*,application/pdf,.eml,.msg"
              onChange={e => setFile(e.target.files?.[0] ?? null)} data-testid="cpo-file-input" />
            {file && <p className="text-xs text-muted-foreground">{file.name}</p>}
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
