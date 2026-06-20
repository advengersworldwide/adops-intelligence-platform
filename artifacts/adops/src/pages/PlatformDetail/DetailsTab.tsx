import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  type Platform,
  useUpdatePlatform,
  useListPaymentTerms,
  getGetPlatformQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { hasPermission } from "@/lib/auth";

type FormState = {
  name: string;
  address: string;
  companyEmail: string;
  companyNumber: string;
  pocName: string;
  pocNumber: string;
  pocEmail: string;
  bankName: string;
  bankAccountNumber: string;
  bankAddress: string;
  swiftCode: string;
  iban: string;
  salesTaxNumber: string;
  ntnNumber: string;
  paymentTermsId: string;
};

function s(v: string | null | undefined): string {
  return v ?? "";
}

function buildFormState(platform: Platform): FormState {
  return {
    name: s(platform.name),
    address: s(platform.address),
    companyEmail: s(platform.companyEmail),
    companyNumber: s(platform.companyNumber),
    pocName: s(platform.pocName),
    pocNumber: s(platform.pocNumber),
    pocEmail: s(platform.pocEmail),
    bankName: s(platform.bankName),
    bankAccountNumber: s(platform.bankAccountNumber),
    bankAddress: s(platform.bankAddress),
    swiftCode: s(platform.swiftCode),
    iban: s(platform.iban),
    salesTaxNumber: s(platform.salesTaxNumber),
    ntnNumber: s(platform.ntnNumber),
    paymentTermsId: platform.paymentTermsId != null ? String(platform.paymentTermsId) : "",
  };
}

function strOrNull(v: string): string | null {
  const t = v.trim();
  return t === "" ? null : t;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <h3 className="mb-4 text-sm font-semibold text-foreground">{title}</h3>
      {children}
    </div>
  );
}

const phoneFilter = (v: string) => v.replace(/[^+\d\s()\-]/g, "");

function Field({
  label,
  value,
  onChange,
  disabled,
  type = "text",
  filterFn,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  type?: string;
  filterFn?: (v: string) => string;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Input
        type={type}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(filterFn ? filterFn(e.target.value) : e.target.value)}
      />
    </label>
  );
}

export default function PlatformDetailsTab({ platform }: { platform: Platform }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const canEdit = hasPermission("Edit Platforms");

  const [form, setForm] = useState<FormState>(() => buildFormState(platform));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(buildFormState(platform));
  }, [platform]);

  const { data: paymentTerms = [] } = useListPaymentTerms();
  const updatePlatform = useUpdatePlatform();

  const set = (key: keyof FormState) => (v: string) =>
    setForm((prev) => ({ ...prev, [key]: v }));

  async function handleSave() {
    setSaving(true);
    try {
      await updatePlatform.mutateAsync({
        id: platform.id,
        data: {
          name: form.name.trim(),
          address: strOrNull(form.address),
          companyEmail: strOrNull(form.companyEmail),
          companyNumber: strOrNull(form.companyNumber),
          pocName: strOrNull(form.pocName),
          pocNumber: strOrNull(form.pocNumber),
          pocEmail: strOrNull(form.pocEmail),
          bankName: strOrNull(form.bankName),
          bankAccountNumber: strOrNull(form.bankAccountNumber),
          bankAddress: strOrNull(form.bankAddress),
          swiftCode: strOrNull(form.swiftCode),
          iban: strOrNull(form.iban),
          salesTaxNumber: strOrNull(form.salesTaxNumber),
          ntnNumber: strOrNull(form.ntnNumber),
          paymentTermsId: form.paymentTermsId ? parseInt(form.paymentTermsId, 10) : null,
        },
      });

      await qc.invalidateQueries({ queryKey: getGetPlatformQueryKey(platform.id) });
      toast({ title: "Changes saved" });
    } catch {
      toast({ title: "Failed to save changes", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <Section title="General">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" value={form.name} onChange={set("name")} disabled={!canEdit} />
          <Field label="Address" value={form.address} onChange={set("address")} disabled={!canEdit} />
          <Field
            label="Company Email"
            type="email"
            value={form.companyEmail}
            onChange={set("companyEmail")}
            disabled={!canEdit}
          />
          <Field
            label="Company Number"
            type="tel"
            value={form.companyNumber}
            onChange={set("companyNumber")}
            disabled={!canEdit}
            filterFn={phoneFilter}
          />
        </div>
      </Section>

      <Section title="Point of Contact">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="POC Name" value={form.pocName} onChange={set("pocName")} disabled={!canEdit} />
          <Field label="POC Number" type="tel" value={form.pocNumber} onChange={set("pocNumber")} disabled={!canEdit} filterFn={phoneFilter} />
          <Field
            label="POC Email"
            type="email"
            value={form.pocEmail}
            onChange={set("pocEmail")}
            disabled={!canEdit}
          />
        </div>
      </Section>

      <Section title="Financial & Legal">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Bank Name" value={form.bankName} onChange={set("bankName")} disabled={!canEdit} />
          <Field
            label="Account Number"
            value={form.bankAccountNumber}
            onChange={set("bankAccountNumber")}
            disabled={!canEdit}
          />
          <Field label="Bank Address" value={form.bankAddress} onChange={set("bankAddress")} disabled={!canEdit} />
          <Field label="SWIFT" value={form.swiftCode} onChange={set("swiftCode")} disabled={!canEdit} />
          <Field label="IBAN" value={form.iban} onChange={set("iban")} disabled={!canEdit} />
          <Field
            label="Sales Tax Number"
            value={form.salesTaxNumber}
            onChange={set("salesTaxNumber")}
            disabled={!canEdit}
          />
          <Field label="NTN Number" value={form.ntnNumber} onChange={set("ntnNumber")} disabled={!canEdit} />
        </div>
      </Section>

      <Section title="Payment Terms">
        <div className="max-w-xs space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Payment Terms</span>
          <Select
            value={form.paymentTermsId}
            onValueChange={set("paymentTermsId")}
            disabled={!canEdit}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select payment terms" />
            </SelectTrigger>
            <SelectContent>
              {paymentTerms.map((pt) => (
                <SelectItem key={pt.id} value={String(pt.id)}>
                  {pt.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Section>

      {canEdit && (
        <div className="flex justify-end">
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save Changes"}
          </Button>
        </div>
      )}
    </div>
  );
}
