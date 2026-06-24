import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, rolesTable, usersTable } from "@workspace/db";

const DEFAULT_ROLES = [
  {
    name: "System Admin",
    permissions: [
      "View Dashboard", "View Clients", "Edit Clients",
      "View Partners", "Edit Partners",
      "View Buying Houses", "Edit Buying Houses",
      "View Transactions", "View Billings", "View Payments", "View Cost", "Upload Data",
      "View Analytics", "Manage Settings",
    ] as string[],
    isSystem: true,
  },
  {
    name: "Viewer",
    permissions: [
      "View Dashboard", "View Clients", "View Partners",
      "View Buying Houses",
      "View Transactions", "View Billings", "View Payments", "View Cost", "View Analytics",
    ] as string[],
    isSystem: true,
  },
  {
    name: "Operator",
    permissions: [
      "View Dashboard", "View Clients", "Edit Clients",
      "View Partners", "Edit Partners",
      "View Buying Houses", "Edit Buying Houses",
      "View Transactions", "View Billings", "View Payments", "View Cost", "Upload Data",
      "View Analytics",
    ] as string[],
    isSystem: true,
  },
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
  console.log("[seed] done");
}

seedDefaults()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[seed] failed", err);
    process.exit(1);
  });
