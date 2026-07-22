import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, rolesTable, usersTable, taxSettingsTable } from "@workspace/db";
import { ALL_PERMISSIONS } from "../lib/rbac/catalog";

// Operator: everything except role/user management and destructive deletes.
const OPERATOR_PERMS = ALL_PERMISSIONS.filter(
  (p) => p !== "settings.roles:manage" && p !== "settings.users:manage" && !p.endsWith(":delete"),
);
// Viewer: every :view (module + tab + sensitive-field views), no settings, no export.
const VIEWER_PERMS = ALL_PERMISSIONS.filter(
  (p) => p.endsWith(":view") && !p.startsWith("settings") && p !== "analytics:export",
);

const DEFAULT_ROLES = [
  { name: "System Admin", permissions: [...ALL_PERMISSIONS] as string[], isSystem: true },
  { name: "Operator", permissions: OPERATOR_PERMS as string[], isSystem: true },
  { name: "Viewer", permissions: VIEWER_PERMS as string[], isSystem: true },
];

async function seedDefaults() {
  for (const role of DEFAULT_ROLES) {
    const rows = await db.select().from(rolesTable);
    const existing = rows.find((r) => r.name === role.name);
    if (!existing) {
      await db.insert(rolesTable).values(role);
    } else {
      await db.update(rolesTable).set({ permissions: role.permissions }).where(eq(rolesTable.name, role.name));
    }
  }

  const users = await db.select().from(usersTable);
  const existingAdmin = users.find((u) => u.email === "admin@advengers.com");
  if (!existingAdmin) {
    const adminPassword = process.env["ADMIN_DEFAULT_PASSWORD"];
    if (!adminPassword) {
      console.warn("[seed] ADMIN_DEFAULT_PASSWORD not set — skipping default admin seed");
    } else {
      const hashedPassword = await bcrypt.hash(adminPassword, 12);
      await db.insert(usersTable).values({
        name: "System Admin",
        email: "admin@advengers.com",
        password: hashedPassword,
        role: "System Admin",
        isSystem: true,
      });
      console.log("[seed] default admin created");
    }
  }
  const existingTax = await db.select().from(taxSettingsTable).limit(1);
  if (existingTax.length === 0) {
    await db.insert(taxSettingsTable).values({
      remittanceTaxPct: "15",
      salesTaxPct: "15",
      withholdingTaxPct: "7",
    });
    console.log("[seed] default tax settings created");
  }

  console.log("[seed] done");
}

seedDefaults()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[seed] failed", err);
    process.exit(1);
  });
