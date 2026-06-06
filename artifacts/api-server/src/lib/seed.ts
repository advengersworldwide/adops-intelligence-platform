import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, rolesTable, usersTable } from "@workspace/db";

const DEFAULT_ROLES = [
  {
    name: "System Admin",
    permissions: [
      "View Dashboard", "View Clients", "Edit Clients",
      "View Platforms", "Edit Platforms",
      "View Buying Houses", "Edit Buying Houses",
      "View Billing", "Upload Data",
      "View Analytics", "Manage Settings",
    ] as string[],
    isSystem: true,
  },
  {
    name: "Viewer",
    permissions: [
      "View Dashboard", "View Clients", "View Platforms",
      "View Buying Houses",
      "View Billing", "View Analytics",
    ] as string[],
    isSystem: true,
  },
  {
    name: "Operator",
    permissions: [
      "View Dashboard", "View Clients", "Edit Clients",
      "View Platforms", "Edit Platforms",
      "View Buying Houses", "Edit Buying Houses",
      "View Billing", "Upload Data",
      "View Analytics",
    ] as string[],
    isSystem: true,
  },
];

export async function seedDefaults() {
  for (const role of DEFAULT_ROLES) {
    const existing = await db.select().from(rolesTable)
      .then(rows => rows.find(r => r.name === role.name));
    if (!existing) {
      await db.insert(rolesTable).values(role);
    } else {
      await db.update(rolesTable).set({ permissions: role.permissions })
        .where(eq(rolesTable.name, role.name));
    }
  }

  const existingAdmin = await db.select().from(usersTable)
    .then(rows => rows.find(u => u.email === "admin@advengers.com"));
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
    }
  }
}
