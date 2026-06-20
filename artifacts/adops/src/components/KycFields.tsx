import { Input } from "@/components/ui/input";

export type KycState = {
  address: string; pocName: string; pocNumber: string; pocEmail: string;
  companyEmail: string; companyNumber: string;
  bankName: string; bankAccountNumber: string; bankAddress: string; swiftCode: string; iban: string;
  salesTaxNumber: string; ntnNumber: string;
};

export const EMPTY_KYC: KycState = {
  address: "", pocName: "", pocNumber: "", pocEmail: "",
  companyEmail: "", companyNumber: "",
  bankName: "", bankAccountNumber: "", bankAddress: "", swiftCode: "", iban: "",
  salesTaxNumber: "", ntnNumber: "",
};

const s = (v: string | null | undefined) => v ?? "";

export function kycFromRecord(r: Partial<Record<keyof KycState, string | null>>): KycState {
  return {
    address: s(r.address), pocName: s(r.pocName), pocNumber: s(r.pocNumber), pocEmail: s(r.pocEmail),
    companyEmail: s(r.companyEmail), companyNumber: s(r.companyNumber),
    bankName: s(r.bankName), bankAccountNumber: s(r.bankAccountNumber), bankAddress: s(r.bankAddress),
    swiftCode: s(r.swiftCode), iban: s(r.iban),
    salesTaxNumber: s(r.salesTaxNumber), ntnNumber: s(r.ntnNumber),
  };
}

export function kycToPayload(k: KycState): Record<keyof KycState, string | null> {
  const o = {} as Record<keyof KycState, string | null>;
  (Object.keys(k) as (keyof KycState)[]).forEach((key) => {
    const t = k[key].trim();
    o[key] = t === "" ? null : t;
  });
  return o;
}

const phoneFilter = (v: string) => v.replace(/[^+\d\s()\-]/g, "");

function Field({ label, value, onChange, disabled, type = "text", filterFn }: {
  label: string; value: string; onChange: (v: string) => void; disabled: boolean;
  type?: string; filterFn?: (v: string) => string;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Input type={type} value={value} disabled={disabled}
        onChange={(e) => onChange(filterFn ? filterFn(e.target.value) : e.target.value)} />
    </label>
  );
}

export function KycFields({ value, onChange, disabled }: {
  value: KycState; onChange: (next: KycState) => void; disabled: boolean;
}) {
  const set = (key: keyof KycState) => (v: string) => onChange({ ...value, [key]: v });
  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-card p-5">
        <h3 className="mb-4 text-sm font-semibold text-foreground">Contact</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Address" value={value.address} onChange={set("address")} disabled={disabled} />
          <Field label="Company Email" type="email" value={value.companyEmail} onChange={set("companyEmail")} disabled={disabled} />
          <Field label="Company Number" type="tel" value={value.companyNumber} onChange={set("companyNumber")} disabled={disabled} filterFn={phoneFilter} />
          <Field label="POC Name" value={value.pocName} onChange={set("pocName")} disabled={disabled} />
          <Field label="POC Number" type="tel" value={value.pocNumber} onChange={set("pocNumber")} disabled={disabled} filterFn={phoneFilter} />
          <Field label="POC Email" type="email" value={value.pocEmail} onChange={set("pocEmail")} disabled={disabled} />
        </div>
      </div>
      <div className="rounded-lg border border-border bg-card p-5">
        <h3 className="mb-4 text-sm font-semibold text-foreground">Banking & Legal</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Bank Name" value={value.bankName} onChange={set("bankName")} disabled={disabled} />
          <Field label="Account Number" value={value.bankAccountNumber} onChange={set("bankAccountNumber")} disabled={disabled} />
          <Field label="Bank Address" value={value.bankAddress} onChange={set("bankAddress")} disabled={disabled} />
          <Field label="SWIFT" value={value.swiftCode} onChange={set("swiftCode")} disabled={disabled} />
          <Field label="IBAN" value={value.iban} onChange={set("iban")} disabled={disabled} />
          <Field label="Sales Tax Number" value={value.salesTaxNumber} onChange={set("salesTaxNumber")} disabled={disabled} />
          <Field label="NTN Number" value={value.ntnNumber} onChange={set("ntnNumber")} disabled={disabled} />
        </div>
      </div>
    </div>
  );
}
