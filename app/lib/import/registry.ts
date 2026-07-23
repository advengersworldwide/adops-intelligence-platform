// app/lib/import/registry.ts
import type { ImportDescriptor } from "./types";
import { clientPurchaseOrdersDescriptor } from "./descriptors/client-purchase-orders";
import { partnerPurchaseOrdersDescriptor } from "./descriptors/partner-purchase-orders";
import { partnerBillsDescriptor } from "./descriptors/partner-bills";
import { partnerPaymentsDescriptor } from "./descriptors/partner-payments";
import { clientBillingSummaryDescriptor } from "./descriptors/client-billing-summary";

// Heterogeneous descriptors — ctx/payload types differ per entry.
// The UI only offers the two in catalog.ts; the others stay registered so their
// routes/tests keep working, but they aren't shown in the bulk-upload picker.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const registry: Record<string, ImportDescriptor<any, any>> = {
  [clientBillingSummaryDescriptor.type]: clientBillingSummaryDescriptor,
  [partnerBillsDescriptor.type]: partnerBillsDescriptor,
  [clientPurchaseOrdersDescriptor.type]: clientPurchaseOrdersDescriptor,
  [partnerPurchaseOrdersDescriptor.type]: partnerPurchaseOrdersDescriptor,
  [partnerPaymentsDescriptor.type]: partnerPaymentsDescriptor,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getDescriptor(type: string): ImportDescriptor<any, any> | undefined {
  return registry[type];
}

/** Descriptor metadata for the UI type picker (server-only; the client uses catalog.ts). */
export function listDescriptors(): Array<{ type: string; label: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return Object.values(registry).map((d: ImportDescriptor<any, any>) => ({ type: d.type, label: d.label }));
}
