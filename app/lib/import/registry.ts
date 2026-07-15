// app/lib/import/registry.ts
import type { ImportDescriptor } from "./types";
import { clientPurchaseOrdersDescriptor } from "./descriptors/client-purchase-orders";

// Heterogeneous descriptors — ctx/payload types differ per entry.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const registry: Record<string, ImportDescriptor<any, any>> = {
  [clientPurchaseOrdersDescriptor.type]: clientPurchaseOrdersDescriptor,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getDescriptor(type: string): ImportDescriptor<any, any> | undefined {
  return registry[type];
}

/** Descriptor metadata for the UI type picker. */
export function listDescriptors(): Array<{ type: string; label: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return Object.values(registry).map((d: ImportDescriptor<any, any>) => ({ type: d.type, label: d.label }));
}
