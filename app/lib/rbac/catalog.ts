export type PermissionKind = "action" | "tab" | "field" | "workflow";

export interface PermissionDef {
  key: string;
  label: string;
  group: string;
  kind: PermissionKind;
}

export const SYSTEM_ADMIN_ROLE = "System Admin";

export const PERMISSIONS = [
  // Dashboard
  { key: "dashboard:view", label: "View Dashboard", group: "Dashboard", kind: "action" },

  // Clients
  { key: "clients:view", label: "View Clients", group: "Clients", kind: "action" },
  { key: "clients:edit", label: "Edit Clients", group: "Clients", kind: "action" },
  { key: "clients:delete", label: "Delete Clients", group: "Clients", kind: "action" },
  { key: "clients.details:view", label: "Client · Details tab", group: "Clients", kind: "tab" },
  { key: "clients.events:view", label: "Client · Events tab", group: "Clients", kind: "tab" },
  { key: "clients.data:view", label: "Client · Data (financials) tab", group: "Clients", kind: "tab" },
  { key: "clients.bank:view", label: "Client · Bank details", group: "Clients", kind: "field" },
  { key: "clients.tax:view", label: "Client · Tax numbers", group: "Clients", kind: "field" },

  // Buying Houses
  { key: "buying-houses:view", label: "View Buying Houses", group: "Buying Houses", kind: "action" },
  { key: "buying-houses:edit", label: "Edit Buying Houses", group: "Buying Houses", kind: "action" },
  { key: "buying-houses:delete", label: "Delete Buying Houses", group: "Buying Houses", kind: "action" },
  { key: "buying-houses.details:view", label: "Buying House · Details tab", group: "Buying Houses", kind: "tab" },
  { key: "buying-houses.data:view", label: "Buying House · Data tab", group: "Buying Houses", kind: "tab" },
  { key: "buying-houses.analytics:view", label: "Buying House · Analytics tab", group: "Buying Houses", kind: "tab" },

  // Partners
  { key: "partners:view", label: "View Partners", group: "Partners", kind: "action" },
  { key: "partners:edit", label: "Edit Partners", group: "Partners", kind: "action" },
  { key: "partners:delete", label: "Delete Partners", group: "Partners", kind: "action" },
  { key: "partners.details:view", label: "Partner · Details tab", group: "Partners", kind: "tab" },
  { key: "partners.clients:view", label: "Partner · Clients tab", group: "Partners", kind: "tab" },
  { key: "partners.data:view", label: "Partner · Data tab", group: "Partners", kind: "tab" },
  { key: "partners.analytics:view", label: "Partner · Analytics tab", group: "Partners", kind: "tab" },
  { key: "partners.bank:view", label: "Partner · Bank details", group: "Partners", kind: "field" },
  { key: "partners.payout:view", label: "Partner · Payout rates", group: "Partners", kind: "field" },

  // Purchase Orders
  { key: "purchase-orders:view", label: "View Purchase Orders", group: "Purchase Orders", kind: "action" },
  { key: "purchase-orders:edit", label: "Edit Purchase Orders", group: "Purchase Orders", kind: "action" },
  { key: "purchase-orders:change-status", label: "Change PO status", group: "Purchase Orders", kind: "workflow" },
  { key: "purchase-orders.clients:view", label: "PO · Clients tab", group: "Purchase Orders", kind: "tab" },
  { key: "purchase-orders.partners:view", label: "PO · Partners tab", group: "Purchase Orders", kind: "tab" },

  // Billings
  { key: "billings:view", label: "View Billings", group: "Billings", kind: "action" },
  { key: "billings:edit", label: "Edit Billings", group: "Billings", kind: "action" },
  { key: "billings:generate-invoice", label: "Generate invoice", group: "Billings", kind: "workflow" },
  { key: "billings:change-status", label: "Change billing status", group: "Billings", kind: "workflow" },
  { key: "billings.client:view", label: "Billing · Client tab", group: "Billings", kind: "tab" },
  { key: "billings.client.summary:view", label: "Billing · Client Summary", group: "Billings", kind: "tab" },
  { key: "billings.client.detail:view", label: "Billing · Client Detail", group: "Billings", kind: "tab" },
  { key: "billings.partner:view", label: "Billing · Partner tab", group: "Billings", kind: "tab" },
  { key: "billings.margin:view", label: "Billing · Margin/receivable columns", group: "Billings", kind: "field" },

  // Payments
  { key: "payments:view", label: "View Payments", group: "Payments", kind: "action" },
  { key: "payments:edit", label: "Edit Payments", group: "Payments", kind: "action" },
  { key: "payments:change-status", label: "Change payment status", group: "Payments", kind: "workflow" },
  { key: "partner-payments:change-status", label: "Change partner-payment status", group: "Payments", kind: "workflow" },

  // Cost
  { key: "cost:view", label: "View Cost", group: "Cost", kind: "action" },
  { key: "cost:edit", label: "Edit Cost", group: "Cost", kind: "action" },

  // Upload
  { key: "upload:data", label: "Upload Data", group: "Upload", kind: "action" },

  // Analytics
  { key: "analytics:view", label: "View Analytics", group: "Analytics", kind: "action" },
  { key: "analytics:export", label: "Export Analytics", group: "Analytics", kind: "action" },

  // Settings (splits the old "Manage Settings")
  { key: "settings:view", label: "View Settings", group: "Settings", kind: "action" },
  { key: "settings.general:view", label: "Settings · General/Currency/Tax", group: "Settings", kind: "tab" },
  { key: "settings.roles:manage", label: "Settings · Roles & Rights", group: "Settings", kind: "tab" },
  { key: "settings.users:manage", label: "Settings · User Accounts", group: "Settings", kind: "tab" },
  { key: "settings.catalogs:manage", label: "Settings · Cost Models & Payment Terms", group: "Settings", kind: "tab" },
] as const satisfies readonly PermissionDef[];

export type Permission = (typeof PERMISSIONS)[number]["key"];

export const ALL_PERMISSIONS: Permission[] = PERMISSIONS.map((p) => p.key);