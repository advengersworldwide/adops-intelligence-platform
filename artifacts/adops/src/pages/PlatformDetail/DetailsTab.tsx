import { useState, useEffect } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  type Platform,
  useUpdatePlatform,
  useCreatePlatformCostModel,
  useUpdatePlatformCostModel,
  useDeletePlatformCostModel,
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

const PAYMENT_TERMS = ["net_30", "net_60", "net_90", "net_120", "net_150"] as const;
const PAYMENT_LABEL: Record<string, string> = {
  net_30: "Net 30",
  net_60: "Net 60",
  net_90: "Net 90",
  net_120: "Net 120",
  net_150: "Net 150",
};

type CostModelRow = { id?: number; name: string; payoutRate: string; marginPct: string; isNew?: boolean };

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
  remittanceTaxPct: string;
  forexBuyingRate: string;
  bulkDiscountPct: string;
  paymentTerms: string;
};

function s(v: string | null | undefined): string {
  return v ?? "";
}

function numToStr(v: number | null | undefined): string {
  return v === null || v === undefined ? "" : String(v);
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
    remittanceTaxPct: numToStr(platform.remittanceTaxPct),
    forexBuyingRate: numToStr(platform.forexBuyingRate),
    bulkDiscountPct: numToStr(platform.bulkDiscountPct),
    paymentTerms: s(platform.paymentTerms),
  };
}

function buildCostModelRows(platform: Platform): CostModelRow[] {
  return (platform.costModels ?? []).map((cm) => ({
    id: cm.id,
    name: cm.name,
    payoutRate: String(cm.payoutRate),
    marginPct: String(cm.marginPct),
  }));
}

/** Convert a form string to a nullable string for the API (empty -> null). */
function strOrNull(v: string): string | null {
  const t = v.trim();
  return t === "" ? null : t;
}

/** Convert a form string to a nullable number for the API (empty/invalid -> null). */
function numOrNull(v: string): number | null {
  const t = v.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isNaN(n) ? null : n;
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
  const [costModels, setCostModels] = useState<CostModelRow[]>(() =>
    buildCostModelRows(platform),
  );
  const [saving, setSaving] = useState(false);

  // Re-sync form state when the platform prop changes.
  useEffect(() => {
    setForm(buildFormState(platform));
    setCostModels(buildCostModelRows(platform));
  }, [platform]);

  const updatePlatform = useUpdatePlatform();
  const createCostModel = useCreatePlatformCostModel();
  const updateCostModel = useUpdatePlatformCostModel();
  const deleteCostModel = useDeletePlatformCostModel();

  const set = (key: keyof FormState) => (v: string) =>
    setForm((prev) => ({ ...prev, [key]: v }));

  const addCostModel = () =>
    setCostModels((prev) => [...prev, { name: "", payoutRate: "", marginPct: "", isNew: true }]);

  const updateCostModelRow = (index: number, patch: Partial<CostModelRow>) =>
    setCostModels((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );

  const removeCostModelRow = (index: number) =>
    setCostModels((prev) => prev.filter((_, i) => i !== index));

  async function handleSave() {
    setSaving(true);
    try {
      // 1. PATCH platform fields.
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
          paymentTerms: strOrNull(form.paymentTerms),
          remittanceTaxPct: numOrNull(form.remittanceTaxPct),
          forexBuyingRate: numOrNull(form.forexBuyingRate),
          bulkDiscountPct: numOrNull(form.bulkDiscountPct),
        },
      });

      // 2. Determine cost model create / update / delete operations.
      const original = platform.costModels ?? [];
      const keptIds = new Set(
        costModels.filter((cm) => cm.id !== undefined).map((cm) => cm.id as number),
      );

      const ops: Promise<unknown>[] = [];

      // Create new cost models.
      for (const cm of costModels) {
        if (cm.isNew) {
          const name = cm.name.trim();
          if (name === "") continue;
          ops.push(
            createCostModel.mutateAsync({
              id: platform.id,
              data: {
                name,
                payoutRate: Number(cm.payoutRate) || 0,
                marginPct: Number(cm.marginPct) || 0,
              },
            }),
          );
        }
      }

      // Update changed existing cost models.
      for (const cm of costModels) {
        if (cm.isNew || cm.id === undefined) continue;
        const prev = original.find((o) => o.id === cm.id);
        if (!prev) continue;
        const newName = cm.name.trim();
        const newPayoutRate = Number(cm.payoutRate) || 0;
        const newMarginPct = Number(cm.marginPct) || 0;
        if (
          prev.name !== newName ||
          prev.payoutRate !== newPayoutRate ||
          prev.marginPct !== newMarginPct
        ) {
          ops.push(
            updateCostModel.mutateAsync({
              id: platform.id,
              cmId: cm.id,
              data: { name: newName, payoutRate: newPayoutRate, marginPct: newMarginPct },
            }),
          );
        }
      }

      // Delete removed cost models.
      for (const prev of original) {
        if (!keptIds.has(prev.id)) {
          ops.push(
            deleteCostModel.mutateAsync({ id: platform.id, cmId: prev.id }),
          );
        }
      }

      await Promise.all(ops);

      // 3. Invalidate the platform query so fresh data is fetched.
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
          <Field
            label="Remittance Tax %"
            type="number"
            value={form.remittanceTaxPct}
            onChange={set("remittanceTaxPct")}
            disabled={!canEdit}
          />
          <Field
            label="Forex Buying Rate"
            type="number"
            value={form.forexBuyingRate}
            onChange={set("forexBuyingRate")}
            disabled={!canEdit}
          />
          <Field
            label="Bulk Discount %"
            type="number"
            value={form.bulkDiscountPct}
            onChange={set("bulkDiscountPct")}
            disabled={!canEdit}
          />
        </div>
      </Section>

      <Section title="Payment Terms">
        <div className="max-w-xs space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Payment Terms</span>
          <Select
            value={form.paymentTerms}
            onValueChange={set("paymentTerms")}
            disabled={!canEdit}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select payment terms" />
            </SelectTrigger>
            <SelectContent>
              {PAYMENT_TERMS.map((t) => (
                <SelectItem key={t} value={t}>
                  {PAYMENT_LABEL[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Section>

      <Section title="Cost Models">
        <div className="space-y-3">
          {costModels.length === 0 && (
            <p className="text-sm text-muted-foreground">No cost models yet.</p>
          )}
          {costModels.map((cm, i) => (
            <div key={cm.id ?? `new-${i}`} className="flex items-center gap-3">
              <Input
                placeholder="Name"
                className="flex-1"
                value={cm.name}
                disabled={!canEdit}
                onChange={(e) => updateCostModelRow(i, { name: e.target.value })}
              />
              <Input
                type="number"
                placeholder="USD/pin"
                className="w-32"
                value={cm.payoutRate}
                disabled={!canEdit}
                onChange={(e) => updateCostModelRow(i, { payoutRate: e.target.value })}
              />
              <Input
                type="number"
                placeholder="Margin %"
                className="w-28"
                value={cm.marginPct}
                disabled={!canEdit}
                onChange={(e) => updateCostModelRow(i, { marginPct: e.target.value })}
              />
              {canEdit && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeCostModelRow(i)}
                  aria-label="Delete cost model"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
          {canEdit && (
            <Button type="button" variant="outline" size="sm" onClick={addCostModel}>
              <Plus className="mr-1.5 h-4 w-4" />
              Add Cost Model
            </Button>
          )}
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
