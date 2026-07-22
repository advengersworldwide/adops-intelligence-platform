import type { Permission } from "./catalog";

const MAP: Record<string, Permission[]> = {
  "View Dashboard": ["dashboard:view"],
  "View Clients": [
    "clients:view", "clients.details:view", "clients.events:view",
    "clients.data:view", "clients.bank:view", "clients.tax:view",
  ],
  "Edit Clients": ["clients:edit"],
  "View Partners": [
    "partners:view", "partners.details:view", "partners.clients:view",
    "partners.data:view", "partners.analytics:view", "partners.bank:view", "partners.payout:view",
  ],
  "Edit Partners": ["partners:edit"],
  "View Buying Houses": [
    "buying-houses:view", "buying-houses.details:view",
    "buying-houses.data:view", "buying-houses.analytics:view",
  ],
  "Edit Buying Houses": ["buying-houses:edit"],
  "View Purchase Orders": [
    "purchase-orders:view", "purchase-orders.clients:view", "purchase-orders.partners:view",
  ],
  "Edit Purchase Orders": ["purchase-orders:edit", "purchase-orders:change-status"],
  "View Billings": [
    "billings:view", "billings.client:view", "billings.client.summary:view",
    "billings.partner:view", "billings.margin:view",
  ],
  "View Billing Detail": ["billings.client.detail:view"],
  "View Payments": ["payments:view"],
  "View Cost": ["cost:view"],
  "View Analytics": ["analytics:view"],
  "Upload Data": ["upload:data"],
  "Manage Settings": [
    "settings:view", "settings.general:view", "settings.roles:manage",
    "settings.users:manage", "settings.catalogs:manage",
  ],
  "View Transactions": [], // legacy media model retired
};

export function migratePermissions(old: string[]): string[] {
  const out = new Set<string>();
  for (const key of old) {
    const mapped = MAP[key];
    if (mapped) mapped.forEach((k) => out.add(k));
  }
  return [...out];
}
