import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import { db, usersTable } from "@workspace/db";
import { requireAuth, requireAdmin } from "../middlewares/auth";

const router: IRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { error: "Too many login attempts. Please try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

// GET /users — admin only
router.get("/users", requireAuth, requireAdmin, async (_req, res): Promise<void> => {
  try {
    const rows = await db.select().from(usersTable).orderBy(usersTable.id);
    res.json(rows.map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      isSystem: u.isSystem,
    })));
  } catch {
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// POST /users/login — public, issues JWT
router.post("/users/login", loginLimiter, async (req, res): Promise<void> => {
  const secret = process.env["JWT_SECRET"];
  if (!secret) {
    res.status(500).json({ error: "Server misconfiguration" });
    return;
  }
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: "email and password are required" });
      return;
    }
    const normalizedEmail = String(email).trim().toLowerCase();
    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, normalizedEmail));

    const isValid = user ? await bcrypt.compare(String(password), user.password) : false;
    if (!user || !isValid) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const token = jwt.sign(
      { sub: user.id, email: user.email, role: user.role, isSystem: user.isSystem },
      secret,
      { expiresIn: "24h" },
    );

    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, isSystem: user.isSystem },
    });
  } catch {
    res.status(500).json({ error: "Login failed" });
  }
});

// POST /users — create or update (admin only)
router.post("/users", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  try {
    const { name, password, role } = req.body;
    const email = String(req.body.email ?? "").trim().toLowerCase();

    if (!name || !email || !role) {
      res.status(400).json({ error: "name, email, and role are required" });
      return;
    }

    const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email));

    if (existing) {
      if (existing.isSystem) {
        res.status(400).json({ error: "Cannot modify system accounts" });
        return;
      }
      const updates: Record<string, unknown> = { name, role, updatedAt: new Date() };
      if (password) updates.password = await bcrypt.hash(String(password), 12);

      const [updated] = await db.update(usersTable)
        .set(updates)
        .where(eq(usersTable.email, email))
        .returning();
      res.json({ id: updated.id, name: updated.name, email: updated.email, role: updated.role, isSystem: updated.isSystem });
    } else {
      if (!password) {
        res.status(400).json({ error: "Password is required for new users" });
        return;
      }
      const hashed = await bcrypt.hash(String(password), 12);
      const [inserted] = await db.insert(usersTable)
        .values({ name, email, password: hashed, role, isSystem: false })
        .returning();
      res.status(201).json({ id: inserted.id, name: inserted.name, email: inserted.email, role: inserted.role, isSystem: inserted.isSystem });
    }
  } catch {
    res.status(500).json({ error: "Failed to save user" });
  }
});

// DELETE /users/:email — admin only
router.delete("/users/:email", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  try {
    const email = decodeURIComponent(String(req.params.email)).trim().toLowerCase();
    const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email));
    if (!existing) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    if (existing.isSystem) {
      res.status(400).json({ error: "Cannot delete system accounts" });
      return;
    }
    await db.delete(usersTable).where(eq(usersTable.email, email));
    res.sendStatus(204);
  } catch {
    res.status(500).json({ error: "Failed to delete user" });
  }
});

export default router;
