"use client";

import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { type Partner, useUpdatePartner, useListPaymentTerms, getGetPartnerQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useHasPermission } from "@/lib/auth/user-context";
import { KycFields, kycFromRecord, kycToPayload, type KycState } from "@/components/KycFields";

export default function PartnerDetailsTab({ partner }: { partner: Partner }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const canEdit = useHasPermission("Edit Partners");
  const { data: paymentTerms } = useListPaymentTerms();
  const updatePartner = useUpdatePartner();

  const [kyc, setKyc] = useState<KycState>(() => kycFromRecord(partner));
  const [paymentTermsId, setPaymentTermsId] = useState<string>(partner.paymentTermsId != null ? String(partner.paymentTermsId) : "none");
  const [codePrefix, setCodePrefix] = useState<string>(partner.codePrefix ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setKyc(kycFromRecord(partner));
    setPaymentTermsId(partner.paymentTermsId != null ? String(partner.paymentTermsId) : "none");
    setCodePrefix(partner.codePrefix ?? "");
  }, [partner]);

  async function handleSave() {
    if (!/^[A-Z0-9]{2,4}$/.test(codePrefix)) {
      toast({ title: "PO code prefix must be 2–4 uppercase letters/numbers", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await updatePartner.mutateAsync({ id: partner.id, data: {
        ...kycToPayload(kyc),
        paymentTermsId: paymentTermsId === "none" ? null : parseInt(paymentTermsId, 10),
        codePrefix,
      }});
      await qc.invalidateQueries({ queryKey: getGetPartnerQueryKey(partner.id) });
      toast({ title: "Changes saved" });
    } catch { toast({ title: "Failed to save changes", variant: "destructive" }); }
    finally { setSaving(false); }
  }

  return (
    <div className="space-y-6">
      <KycFields value={kyc} onChange={setKyc} disabled={!canEdit} />
      <div className="rounded-lg border border-border bg-card p-5 max-w-xs space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">PO Code Prefix</span>
        <Input value={codePrefix} disabled={!canEdit} maxLength={4}
          onChange={e => setCodePrefix(e.target.value.toUpperCase())}
          data-testid="partner-edit-prefix-input" />
        <p className="text-xs text-muted-foreground">2–4 letters/numbers. e.g. SB-0126-0001</p>
      </div>
      <div className="rounded-lg border border-border bg-card p-5 max-w-xs space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">Payment Terms</span>
        <Select value={paymentTermsId} onValueChange={setPaymentTermsId} disabled={!canEdit}>
          <SelectTrigger><SelectValue placeholder="Select payment terms" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None</SelectItem>
            {(paymentTerms ?? []).map(pt => <SelectItem key={pt.id} value={String(pt.id)}>{pt.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {canEdit && <div className="flex justify-end"><Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save Changes"}</Button></div>}
    </div>
  );
}
