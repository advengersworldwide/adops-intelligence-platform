import type { Permission } from "./catalog";

export interface TabNode {
  id: string;
  label: string;
  permission: Permission;
  children?: TabNode[];
}

/** Returns the subset of nodes the user may see. A parent with children renders
 *  only when it is itself permitted AND has >= 1 visible child. */
export function visibleTabs(nodes: TabNode[], can: (p: Permission) => boolean): TabNode[] {
  const out: TabNode[] = [];
  for (const n of nodes) {
    if (n.children && n.children.length > 0) {
      const children = visibleTabs(n.children, can);
      if (can(n.permission) && children.length > 0) out.push({ ...n, children });
    } else if (can(n.permission)) {
      out.push({ ...n });
    }
  }
  return out;
}

// Registries consumed by pages (later tasks).
export const CLIENT_DETAIL_TABS: TabNode[] = [
  { id: "details", label: "Details", permission: "clients.details:view" },
  { id: "events", label: "Events", permission: "clients.events:view" },
];

export const PARTNER_DETAIL_TABS: TabNode[] = [
  { id: "details", label: "Details", permission: "partners.details:view" },
  { id: "clients", label: "Clients", permission: "partners.clients:view" },
];

export const BUYING_HOUSE_DETAIL_TABS: TabNode[] = [
  { id: "details", label: "Details", permission: "buying-houses.details:view" },
  { id: "data", label: "Data", permission: "buying-houses.data:view" },
  { id: "analytics", label: "Analytics", permission: "buying-houses.analytics:view" },
];

export const PURCHASE_ORDER_TABS: TabNode[] = [
  { id: "clients", label: "Clients", permission: "purchase-orders.clients:view" },
  { id: "partners", label: "Partners", permission: "purchase-orders.partners:view" },
];

export const BILLING_TABS: TabNode[] = [
  {
    id: "client", label: "Client", permission: "billings.client:view",
    children: [
      { id: "summary", label: "Summary", permission: "billings.client.summary:view" },
      { id: "detail", label: "Detail", permission: "billings.client.detail:view" },
    ],
  },
  { id: "partner", label: "Partner", permission: "billings.partner:view" },
];

export const SETTINGS_TABS: TabNode[] = [
  { id: "general", label: "Currency & Appearance", permission: "settings.general:view" },
  { id: "roles", label: "Roles & Rights", permission: "settings.roles:manage" },
  { id: "users", label: "User Accounts", permission: "settings.users:manage" },
  { id: "costModels", label: "Cost Models", permission: "settings.catalogs:manage" },
  { id: "paymentTerms", label: "Payment Terms", permission: "settings.catalogs:manage" },
];