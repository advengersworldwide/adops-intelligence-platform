import bcrypt from "bcryptjs";
import { db, rolesTable, usersTable } from "@workspace/db";

const DEFAULT_ROLES = [
  {
    name: "System Admin",
    permissions: [
      "View Dashboard", "View Clients", "Edit Clients",
      "View Platforms", "Edit Platforms", "View Campaigns",
      "Edit Campaigns", "View Transactions", "Upload Data",
      "View Analytics", "Manage Settings",
    ] as string[],
    isSystem: true,
  },
  {
    name: "Viewer",
    permissions: [
      "View Dashboard", "View Clients", "View Platforms",
      "View Campaigns", "View Transactions", "View Analytics",
    ] as string[],
    isSystem: true,
  },
  {
    name: "Operator",
    permissions: [
      "View Dashboard", "View Clients", "Edit Clients",
      "View Platforms", "Edit Platforms", "View Campaigns",
      "Edit Campaigns", "View Transactions", "Upload Data",
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
