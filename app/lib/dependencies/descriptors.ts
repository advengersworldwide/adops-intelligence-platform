import type { Permission } from "@/lib/rbac/catalog";

export type Descriptor = {
  singular: string;
  plural: string;
  labelColumns: string[];
  labelWith: (row: Record<string, unknown>) => string;
  href: ((id: number | string) => string) | null;
  deletePermission: Permission;
  deleteEndpoint: ((id: number | string) => string) | null;
  financial: boolean;
};

const str = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null;

export const DESCRIPTORS: Record<string, Descriptor> = {
  buying_houses: {
    singular: "Buying House", plural: "Buying Houses",
    labelColumns: ["id", "name"],
    labelWith: r => str(r.name) ?? `Buying House #${r.id}`,
    href: id => `/buying-houses/${id}`,
    deletePermission: "buying-houses:delete",
    deleteEndpoint: id => `/api/buying-houses/${id}`,
    financial: false,
  },
  clients: {
    singular: "Client", plural: "Clients",
    labelColumns: ["id", "name"],
    labelWith: r => str(r.name) ?? `Client #${r.id}`,
    href: id => `/clients/${id}`,
    deletePermission: "clients:delete",
    deleteEndpoint: id => `/api/clients/${id}`,
    financial: false,
  },
  partners: {
    singular: "Partner", plural: "Partners",
    labelColumns: ["id", "name"],
    labelWith: r => str(r.name) ?? `Partner #${r.id}`,
    href: id => `/partners/${id}`,
    deletePermission: "partners:delete",
    deleteEndpoint: id => `/api/partners/${id}`,
    financial: false,
  },
  client_events: {
    singular: "Client Event", plural: "Client Events",
    labelColumns: ["id", "name"],
    labelWith: r => str(r.name) ?? `Event #${r.id}`,
    href: null,
    deletePermission: "clients:edit",
    deleteEndpoint: null, // nested under /api/clients/[id]/events/[eventId]
    financial: false,
  },
  partner_clients: {
    singular: "Partner–Client Link", plural: "Partner–Client Links",
    labelColumns: ["id"],
    labelWith: r => `Link #${r.id}`,
    href: null,
    deletePermission: "partners:edit",
    deleteEndpoint: null,
    financial: false,
  },
  partner_event_payouts: {
    singular: "Partner Payout Rate", plural: "Partner Payout Rates",
    labelColumns: ["id"],
    labelWith: r => `Payout Rate #${r.id}`,
    href: null,
    deletePermission: "partners:edit",
    deleteEndpoint: null,
    financial: false,
  },
  client_purchase_orders: {
    singular: "Client PO", plural: "Client POs",
    labelColumns: ["id", "code"],
    labelWith: r => str(r.code) ?? `Client PO #${r.id}`,
    href: id => `/purchase-orders?cpo=${id}`,
    deletePermission: "purchase-orders:edit",
    deleteEndpoint: id => `/api/client-purchase-orders/${id}`,
    financial: false,
  },
  partner_purchase_orders: {
    singular: "Partner PO", plural: "Partner POs",
    labelColumns: ["id", "code"],
    labelWith: r => str(r.code) ?? `Partner PO #${r.id}`,
    href: id => `/purchase-orders?ppo=${id}`,
    deletePermission: "purchase-orders:edit",
    deleteEndpoint: id => `/api/partner-purchase-orders/${id}`,
    financial: false,
  },
  partner_purchase_order_items: {
    singular: "Partner PO Line", plural: "Partner PO Lines",
    labelColumns: ["id"],
    labelWith: r => `PO Line #${r.id}`,
    href: null,
    deletePermission: "purchase-orders:edit",
    deleteEndpoint: null,
    financial: false,
  },
  billings: {
    singular: "Client Bill", plural: "Client Bills",
    labelColumns: ["id", "invoiceCode"],
    labelWith: r => str(r.invoiceCode) ?? `Billing #${r.id}`,
    href: id => `/billings?billing=${id}`,
    deletePermission: "billings:edit",
    deleteEndpoint: id => `/api/billings/${id}`,
    financial: true,
  },
  billing_lines: {
    singular: "Bill Line", plural: "Bill Lines",
    labelColumns: ["id"],
    labelWith: r => `Bill Line #${r.id}`,
    href: null,
    deletePermission: "billings:edit",
    deleteEndpoint: null,
    financial: true,
  },
  billing_event_items: {
    singular: "Bill Event Item", plural: "Bill Event Items",
    labelColumns: ["id"],
    labelWith: r => `Bill Event Item #${r.id}`,
    href: null,
    deletePermission: "billings:edit",
    deleteEndpoint: null,
    financial: true,
  },
  billing_records: {
    singular: "Billing Record", plural: "Billing Records",
    labelColumns: ["id"],
    labelWith: r => `Billing Record #${r.id}`,
    href: null,
    deletePermission: "billings:edit",
    deleteEndpoint: null,
    financial: true,
  },
  partner_bills: {
    singular: "Partner Bill", plural: "Partner Bills",
    labelColumns: ["id", "code"],
    labelWith: r => str(r.code) ?? `Partner Bill #${r.id}`,
    href: id => `/billings?partnerBill=${id}`,
    deletePermission: "billings:edit",
    deleteEndpoint: id => `/api/partner-bills/${id}`,
    financial: true,
  },
  payments: {
    singular: "Client Payment", plural: "Client Payments",
    labelColumns: ["id", "referenceCode"],
    labelWith: r => str(r.referenceCode) ?? `Payment #${r.id}`,
    href: id => `/payments?payment=${id}`,
    deletePermission: "payments:edit",
    deleteEndpoint: id => `/api/payments/${id}`,
    financial: true,
  },
  partner_payments: {
    singular: "Partner Payment", plural: "Partner Payments",
    labelColumns: ["id", "referenceCode"],
    labelWith: r => str(r.referenceCode) ?? `Partner Payment #${r.id}`,
    href: id => `/payments?partnerPayment=${id}`,
    deletePermission: "payments:edit",
    deleteEndpoint: id => `/api/partner-payments/${id}`,
    financial: true,
  },
  payment_billings: {
    singular: "Payment Allocation", plural: "Payment Allocations",
    labelColumns: ["id"],
    labelWith: r => `Allocation #${r.id}`,
    href: null,
    deletePermission: "payments:edit",
    deleteEndpoint: null,
    financial: true,
  },
  cost_models: {
    singular: "Cost Model", plural: "Cost Models",
    labelColumns: ["id", "name"],
    labelWith: r => str(r.name) ?? `Cost Model #${r.id}`,
    href: null,
    deletePermission: "settings.catalogs:manage",
    deleteEndpoint: id => `/api/cost-models/${id}`,
    financial: false,
  },
  cost_resources: {
    singular: "Cost Resource", plural: "Cost Resources",
    labelColumns: ["id", "name"],
    labelWith: r => str(r.name) ?? `Cost Resource #${r.id}`,
    href: null,
    deletePermission: "cost:edit",
    deleteEndpoint: id => `/api/cost-resources/${id}`,
    financial: false,
  },
  payment_terms: {
    singular: "Payment Term", plural: "Payment Terms",
    labelColumns: ["id", "name"],
    labelWith: r => str(r.name) ?? `Payment Term #${r.id}`,
    href: null,
    deletePermission: "settings.catalogs:manage",
    deleteEndpoint: id => `/api/payment-terms/${id}`,
    financial: false,
  },
  tax_settings: {
    singular: "Tax Setting", plural: "Tax Settings",
    labelColumns: ["id"],
    labelWith: r => `Tax Setting #${r.id}`,
    href: null,
    deletePermission: "settings.catalogs:manage",
    deleteEndpoint: null,
    financial: false,
  },
  users: {
    singular: "User", plural: "Users",
    labelColumns: ["id", "name", "email"],
    labelWith: r => str(r.name) ?? str(r.email) ?? `User #${r.id}`,
    href: null,
    deletePermission: "settings.users:manage",
    deleteEndpoint: null, // keyed by email: /api/users/[email]
    financial: false,
  },
  roles: {
    singular: "Role", plural: "Roles",
    labelColumns: ["id", "name"],
    labelWith: r => str(r.name) ?? `Role #${r.id}`,
    href: null,
    deletePermission: "settings.roles:manage",
    deleteEndpoint: null, // keyed by name: /api/roles/[name]
    financial: false,
  },
  dashboard_layouts: {
    singular: "Dashboard Layout", plural: "Dashboard Layouts",
    labelColumns: ["id"],
    labelWith: r => `Dashboard Layout #${r.id}`,
    href: null,
    deletePermission: "dashboard:view",
    deleteEndpoint: null,
    financial: false,
  },
};

export function hasDescriptor(table: string): boolean {
  return Object.hasOwn(DESCRIPTORS, table);
}

export function getDescriptor(table: string): Descriptor {
  const d = DESCRIPTORS[table];
  if (!d) throw new Error(`No dependency descriptor registered for table "${table}"`);
  return d;
}
