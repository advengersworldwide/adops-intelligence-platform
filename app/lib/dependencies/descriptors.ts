import type { Permission } from "@/lib/rbac/catalog";

/**
 * `href` and `deleteEndpoint` receive the whole selected row, not just its id.
 * Nested routes need more than the id — `billing_records` deletes through
 * `/api/partners/[id]/billing-records/[recordId]`, which needs the owning
 * partner as well — so anything they read must be listed in `labelColumns`.
 */
type RowUrl = (row: Record<string, unknown>) => string | null;

export type Descriptor = {
  singular: string;
  plural: string;
  /**
   * REAL DB column names (snake_case), never Drizzle TS property names. These are
   * interpolated through `sql.identifier()` — which double-quotes them, making
   * Postgres match them case-sensitively — and `db.execute` returns rows keyed by
   * exactly these names, so `labelWith` must read the same strings.
   * `descriptors.test.ts` checks every entry against the live schema.
   */
  labelColumns: string[];
  labelWith: (row: Record<string, unknown>) => string;
  href: RowUrl | null;
  deletePermission: Permission;
  deleteEndpoint: RowUrl | null;
  financial: boolean;
};

const str = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null;

export const DESCRIPTORS: Record<string, Descriptor> = {
  buying_houses: {
    singular: "Buying House", plural: "Buying Houses",
    labelColumns: ["id", "name"],
    labelWith: r => str(r.name) ?? `Buying House #${r.id}`,
    href: r => `/buying-houses/${r.id}`,
    deletePermission: "buying-houses:delete",
    deleteEndpoint: r => `/api/buying-houses/${r.id}`,
    financial: false,
  },
  clients: {
    singular: "Client", plural: "Clients",
    labelColumns: ["id", "name"],
    labelWith: r => str(r.name) ?? `Client #${r.id}`,
    href: r => `/clients/${r.id}`,
    deletePermission: "clients:delete",
    deleteEndpoint: r => `/api/clients/${r.id}`,
    financial: false,
  },
  partners: {
    singular: "Partner", plural: "Partners",
    labelColumns: ["id", "name"],
    labelWith: r => str(r.name) ?? `Partner #${r.id}`,
    href: r => `/partners/${r.id}`,
    deletePermission: "partners:delete",
    deleteEndpoint: r => `/api/partners/${r.id}`,
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
    href: r => `/purchase-orders?cpo=${r.id}`,
    deletePermission: "purchase-orders:edit",
    deleteEndpoint: r => `/api/client-purchase-orders/${r.id}`,
    financial: false,
  },
  partner_purchase_orders: {
    singular: "Partner PO", plural: "Partner POs",
    labelColumns: ["id", "code"],
    labelWith: r => str(r.code) ?? `Partner PO #${r.id}`,
    href: r => `/purchase-orders?ppo=${r.id}`,
    deletePermission: "purchase-orders:edit",
    deleteEndpoint: r => `/api/partner-purchase-orders/${r.id}`,
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
    labelColumns: ["id", "invoice_code"],
    labelWith: r => str(r.invoice_code) ?? `Billing #${r.id}`,
    href: r => `/billings?billing=${r.id}`,
    deletePermission: "billings:edit",
    deleteEndpoint: r => `/api/billings/${r.id}`,
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
    // platform_id is the owning partner: billing_records has no top-level delete
    // route, only the nested one below. period/pins carry the identity a bare
    // "#id" cannot — a buying house can front 50 of these at once.
    labelColumns: ["id", "platform_id", "period", "pins"],
    labelWith: (r) => {
      const detail = [str(r.period), typeof r.pins === "number" ? `${r.pins} pins` : null]
        .filter(Boolean).join(", ");
      return detail ? `Billing Record #${r.id} — ${detail}` : `Billing Record #${r.id}`;
    },
    href: () => "/transactions",
    deletePermission: "billings:edit",
    deleteEndpoint: r => (r.platform_id == null
      ? null
      : `/api/partners/${r.platform_id}/billing-records/${r.id}`),
    financial: true,
  },
  partner_bills: {
    singular: "Partner Bill", plural: "Partner Bills",
    labelColumns: ["id", "code"],
    labelWith: r => str(r.code) ?? `Partner Bill #${r.id}`,
    href: r => `/billings?partnerBill=${r.id}`,
    deletePermission: "billings:edit",
    deleteEndpoint: r => `/api/partner-bills/${r.id}`,
    financial: true,
  },
  payments: {
    singular: "Client Payment", plural: "Client Payments",
    labelColumns: ["id", "reference_code"],
    labelWith: r => str(r.reference_code) ?? `Payment #${r.id}`,
    href: r => `/payments?payment=${r.id}`,
    deletePermission: "payments:edit",
    deleteEndpoint: r => `/api/payments/${r.id}`,
    financial: true,
  },
  partner_payments: {
    singular: "Partner Payment", plural: "Partner Payments",
    labelColumns: ["id", "reference_code"],
    labelWith: r => str(r.reference_code) ?? `Partner Payment #${r.id}`,
    href: r => `/payments?partnerPayment=${r.id}`,
    deletePermission: "payments:edit",
    deleteEndpoint: r => `/api/partner-payments/${r.id}`,
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
    deleteEndpoint: r => `/api/cost-models/${r.id}`,
    financial: false,
  },
  cost_resources: {
    singular: "Cost Resource", plural: "Cost Resources",
    labelColumns: ["id", "name"],
    labelWith: r => str(r.name) ?? `Cost Resource #${r.id}`,
    href: null,
    deletePermission: "cost:edit",
    deleteEndpoint: r => `/api/cost-resources/${r.id}`,
    financial: false,
  },
  payment_terms: {
    singular: "Payment Term", plural: "Payment Terms",
    labelColumns: ["id", "name"],
    labelWith: r => str(r.name) ?? `Payment Term #${r.id}`,
    href: null,
    deletePermission: "settings.catalogs:manage",
    deleteEndpoint: r => `/api/payment-terms/${r.id}`,
    financial: false,
  },
  tax_settings: {
    singular: "Tax Setting", plural: "Tax Settings",
    labelColumns: ["id"],
    labelWith: r => `Tax Setting #${r.id}`,
    href: null,
    deletePermission: "settings.general:view",
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
