import { eq } from "drizzle-orm";
import { db, rolesTable } from "@workspace/db";
import { migratePermissions } from "../lib/rbac/migrate-permissions";

// One-time migration: rewrite custom roles' legacy permission strings to catalog keys.
// System roles are reset by the seed, so they are skipped here.
async function run() {
  const roles = await db.select().from(rolesTable);
  for (const role of roles) {
    if (role.isSystem) continue;
    const looksLegacy = role.permissions.some((p) => p.includes(" ")); // legacy strings contain spaces
    if (!looksLegacy) {
      console.log(`[migrate-rbac] skip ${role.name} (already migrated)`);
      continue;
    }
    const next = migratePermissions(role.permissions);
    await db.update(rolesTable).set({ permissions: next }).where(eq(rolesTable.name, role.name));
    console.log(`[migrate-rbac] ${role.name}: ${role.permissions.length} -> ${next.length} perms`);
  }
  console.log("[migrate-rbac] done");
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
