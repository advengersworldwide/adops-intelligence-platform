import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, rolesTable } from "@workspace/db";
import { requireAuth, requireAdmin } from "../middlewares/auth";

const router: IRouter = Router();

// GET /roles — any authenticated user (needed for permission checks and dropdowns)
router.get("/roles", requireAuth, async (_req, res): Promise<void> => {
  try {
    const rows = await db.select().from(rolesTable).orderBy(rolesTable.id);
    res.json(rows.map(r => ({
      name: r.name,
      permissions: r.permissions,
      isSystem: r.isSystem,
    })));
  } catch {
    res.status(500).json({ error: "Failed to fetch roles" });
  }
});

// POST /roles — admin only
router.post("/roles", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  try {
    const { name, permissions } = req.body;
    if (!name) {
      res.status(400).json({ error: "Role name is required" });
      return;
    }
    if (!Array.isArray(permissions)) {
      res.status(400).json({ error: "Permissions must be an array" });
      return;
    }

    const roleName = String(name);
    const [existing] = await db.select().from(rolesTable).where(eq(rolesTable.name, roleName));

    if (existing) {
      if (existing.isSystem) {
        res.status(400).json({ error: "Cannot modify system roles" });
        return;
      }
      const [updated] = await db.update(rolesTable)
        .set({ permissions, updatedAt: new Date() })
        .where(eq(rolesTable.name, roleName))
        .returning();
      res.json({ name: updated.name, permissions: updated.permissions, isSystem: updated.isSystem });
    } else {
      const [inserted] = await db.insert(rolesTable)
        .values({ name, permissions, isSystem: false })
        .returning();
      res.status(201).json({ name: inserted.name, permissions: inserted.permissions, isSystem: inserted.isSystem });
    }
  } catch {
    res.status(500).json({ error: "Failed to save role" });
  }
});

// DELETE /roles/:name — admin only
router.delete("/roles/:name", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  try {
    const name = String(req.params.name);
    const [existing] = await db.select().from(rolesTable).where(eq(rolesTable.name, name));
    if (!existing) {
      res.status(404).json({ error: "Role not found" });
      return;
    }
    if (existing.isSystem) {
      res.status(400).json({ error: "Cannot delete system roles" });
      return;
    }
    await db.delete(rolesTable).where(eq(rolesTable.name, name));
    res.sendStatus(204);
  } catch {
    res.status(500).json({ error: "Failed to delete role" });
  }
});

export default router;
