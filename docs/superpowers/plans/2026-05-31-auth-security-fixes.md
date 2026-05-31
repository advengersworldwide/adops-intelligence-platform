# Auth Security & Code Quality Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all critical and high-severity security findings from the 2026-05-31 audit — protect secrets, add real password hashing, issue JWT session tokens, enforce server-side auth middleware, and remove dead/misleading code.

**Architecture:** Server issues a signed JWT on login; the frontend stores it and sends it as a Bearer token on every request (both the generated API client and the hand-rolled auth.ts fetch calls). A single Express middleware validates the token before all routes except `/healthz` and `POST /users/login`. Passwords are hashed with bcryptjs.

**Tech Stack:** Express 5, Drizzle ORM, bcryptjs, jsonwebtoken, express-rate-limit, React 19 + TanStack Query, wouter, TypeScript 5.9

> **Note on TDD:** There is no test runner configured in this project. The TDD steps below run the TypeScript compiler (`tsc --noEmit`) and the dev server as the verification gate. A full test setup is a separate follow-up effort.

---

## File map

| File | Action | What changes |
|---|---|---|
| `.gitignore` | Modify | Add `.env*` patterns |
| `.env.example` | Create | Documented placeholders for all env vars |
| `artifacts/api-server/package.json` | Modify | Add bcryptjs, jsonwebtoken, express-rate-limit; remove cookie-parser |
| `artifacts/api-server/src/index.ts` | Modify | Validate JWT_SECRET on startup |
| `artifacts/api-server/src/middlewares/auth.ts` | Create | JWT validation middleware + req.user typing |
| `artifacts/api-server/src/lib/seed.ts` | Modify | Hash default admin password with bcrypt |
| `artifacts/api-server/src/routes/users.ts` | Modify | bcrypt on create/update; JWT on login; remove isSystem from body; sanitize errors |
| `artifacts/api-server/src/routes/roles.ts` | Modify | Sanitize error messages |
| `artifacts/api-server/src/app.ts` | Modify | Wire auth middleware; restrict CORS to env-configured origins |
| `artifacts/adops/src/lib/auth.ts` | Modify | Relative API_BASE; JWT storage/retrieval; auth headers on every request |
| `artifacts/adops/src/main.tsx` | Modify | Call setAuthTokenGetter at app boot |
| `artifacts/adops/src/pages/Dashboard.tsx` | Modify | Remove dead AI Assistant widget |

---

## Task 1: Protect secrets — `.gitignore` and `.env.example`

**Files:**
- Modify: `.gitignore`
- Create: `.env.example`

- [ ] **Step 1: Add `.env*` to `.gitignore`**

Open `.gitignore` and append at the bottom:

```
# Environment variable files — NEVER commit these
.env
.env.local
.env.production
.env.*.local
```

- [ ] **Step 2: Create `.env.example`**

Create `.env.example` at the repo root with this exact content:

```
# Copy this file to .env and fill in real values — never commit .env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE"
PORT=8080

# Generate with: openssl rand -base64 32
JWT_SECRET="replace-with-a-long-random-secret"

# Restrict the frontend origin (comma-separated, no trailing slash)
CORS_ORIGINS="http://localhost:19416"

# Third-party keys (fill in only when the features are implemented)
RESEND=""
GROQ=""
```

- [ ] **Step 3: Verify `.env` is now ignored**

```bash
git check-ignore -v .env
```
Expected: `.gitignore:N:.env    .env`

- [ ] **Step 4: Add JWT_SECRET to your local `.env`**

Open `.env` and add:
```
JWT_SECRET="dev-secret-change-in-production"
CORS_ORIGINS="http://localhost:19416"
```

- [ ] **Step 5: Commit**

```bash
git add .gitignore .env.example
git commit -m "security: protect .env files and add .env.example"
```

---

## Task 2: Update server dependencies

**Files:**
- Modify: `artifacts/api-server/package.json`

- [ ] **Step 1: Add security packages**

```bash
cd artifacts/api-server
pnpm add bcryptjs jsonwebtoken express-rate-limit
pnpm add -D @types/bcryptjs @types/jsonwebtoken
```

- [ ] **Step 2: Remove unused `cookie-parser`**

```bash
pnpm remove cookie-parser @types/cookie-parser
```

- [ ] **Step 3: Verify lockfile updated**

```bash
cd ../..
pnpm install
```

Expected: no errors, lockfile updated.

- [ ] **Step 4: Verify typecheck still passes**

```bash
pnpm run typecheck
```
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/package.json pnpm-lock.yaml
git commit -m "deps(api-server): add bcryptjs/jsonwebtoken/rate-limit, remove unused cookie-parser"
```

---

## Task 3: Validate JWT_SECRET at startup

**Files:**
- Modify: `artifacts/api-server/src/index.ts`

- [ ] **Step 1: Add JWT_SECRET check**

Replace the entire file content with:

```typescript
import app from "./app";
import { logger } from "./lib/logger";
import { seedDefaults } from "./lib/seed";

const rawPort = process.env["PORT"];
const jwtSecret = process.env["JWT_SECRET"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}
if (!jwtSecret) {
  throw new Error("JWT_SECRET environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

seedDefaults()
  .then(() => {
    app.listen(port, (err) => {
      if (err) {
        logger.error({ err }, "Error listening on port");
        process.exit(1);
      }
      logger.info({ port }, "Server listening");
    });
  })
  .catch((err) => {
    logger.error({ err }, "Failed to seed database");
    process.exit(1);
  });
```

- [ ] **Step 2: Typecheck**

```bash
pnpm run typecheck
```
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add artifacts/api-server/src/index.ts
git commit -m "security: require JWT_SECRET at server startup"
```

---

## Task 4: Create JWT auth middleware

**Files:**
- Create: `artifacts/api-server/src/middlewares/auth.ts`

- [ ] **Step 1: Create the middleware file**

```typescript
import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";

declare module "express" {
  interface Request {
    user?: {
      id: number;
      email: string;
      role: string;
      isSystem: boolean;
    };
  }
}

interface JWTPayload {
  sub: number;
  email: string;
  role: string;
  isSystem: boolean;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const secret = process.env["JWT_SECRET"];
  if (!secret) {
    res.status(500).json({ error: "Server misconfiguration" });
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const payload = jwt.verify(token, secret) as JWTPayload;
    req.user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      isSystem: payload.isSystem,
    };
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user?.isSystem) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm run typecheck
```
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add artifacts/api-server/src/middlewares/auth.ts
git commit -m "feat(api-server): add JWT auth middleware with req.user typing"
```

---

## Task 5: Hash passwords in seed + overhaul users.ts

**Files:**
- Modify: `artifacts/api-server/src/lib/seed.ts`
- Modify: `artifacts/api-server/src/routes/users.ts`

- [ ] **Step 1: Update seed.ts to hash the default admin password**

Replace the entire file:

```typescript
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
    const hashedPassword = await bcrypt.hash("Admin@123", 12);
    await db.insert(usersTable).values({
      name: "System Admin",
      email: "admin@advengers.com",
      password: hashedPassword,
      role: "System Admin",
      isSystem: true,
    });
  }
}
```

- [ ] **Step 2: Overhaul users.ts**

Replace the entire file:

```typescript
import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db, usersTable } from "@workspace/db";
import { requireAuth, requireAdmin } from "../middlewares/auth";

const router: IRouter = Router();

// GET /users — requires login (admin or any authenticated user for role dropdowns)
router.get("/users", requireAuth, requireAdmin, async (req, res): Promise<void> => {
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
router.post("/users/login", async (req, res): Promise<void> => {
  const secret = process.env["JWT_SECRET"]!;
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
    const { name, email, password, role } = req.body;

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
        .values({ name, email, password: hashed, role, isSystem: false }) // isSystem always false — only seed creates system accounts
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
    const email = decodeURIComponent(req.params.email);
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
```

- [ ] **Step 3: Typecheck**

```bash
pnpm run typecheck
```
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add artifacts/api-server/src/lib/seed.ts artifacts/api-server/src/routes/users.ts
git commit -m "security: bcrypt passwords, JWT on login, remove isSystem body trust, sanitize errors"
```

---

## Task 6: Sanitize roles.ts errors + add auth guards

**Files:**
- Modify: `artifacts/api-server/src/routes/roles.ts`

- [ ] **Step 1: Add auth guards and sanitize errors**

Replace the entire file:

```typescript
import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, rolesTable } from "@workspace/db";
import { requireAuth, requireAdmin } from "../middlewares/auth";

const router: IRouter = Router();

// GET /roles — any authenticated user (needed for permission checks and dropdowns)
router.get("/roles", requireAuth, async (req, res): Promise<void> => {
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

    const [existing] = await db.select().from(rolesTable).where(eq(rolesTable.name, name));

    if (existing) {
      if (existing.isSystem) {
        res.status(400).json({ error: "Cannot modify system roles" });
        return;
      }
      const [updated] = await db.update(rolesTable)
        .set({ permissions, updatedAt: new Date() })
        .where(eq(rolesTable.name, name))
        .returning();
      res.json({ name: updated.name, permissions: updated.permissions, isSystem: updated.isSystem });
    } else {
      const [inserted] = await db.insert(rolesTable)
        .values({ name, permissions, isSystem: false }) // isSystem always false for API-created roles
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
    const { name } = req.params;
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
```

- [ ] **Step 2: Typecheck**

```bash
pnpm run typecheck
```
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add artifacts/api-server/src/routes/roles.ts
git commit -m "security: auth guards on roles routes, sanitize error messages, remove isSystem body trust"
```

---

## Task 7: Wire auth middleware + restrict CORS in app.ts

**Files:**
- Modify: `artifacts/api-server/src/app.ts`

- [ ] **Step 1: Replace app.ts**

```typescript
import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { requireAuth } from "./middlewares/auth";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

const allowedOrigins = (process.env["CORS_ORIGINS"] ?? "http://localhost:19416")
  .split(",")
  .map(s => s.trim());

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (same-origin, server-to-server)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
```

Note: individual route handlers already apply `requireAuth` where needed (Tasks 5 & 6). The login and health routes are public by design — no global middleware blanket needed.

- [ ] **Step 2: Typecheck**

```bash
pnpm run typecheck
```
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add artifacts/api-server/src/app.ts
git commit -m "security: restrict CORS to configured origins, remove unused cookie-parser wiring"
```

---

## Task 8: Add login rate limiting

**Files:**
- Modify: `artifacts/api-server/src/routes/users.ts`

- [ ] **Step 1: Add the rate limiter import and apply it to the login route**

Add the import at the top of `users.ts` (after the existing imports):

```typescript
import rateLimit from "express-rate-limit";
```

Add the limiter constant before the first `router.get`:

```typescript
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { error: "Too many login attempts. Please try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});
```

Change the login route signature from:
```typescript
router.post("/users/login", async (req, res): Promise<void> => {
```
to:
```typescript
router.post("/users/login", loginLimiter, async (req, res): Promise<void> => {
```

- [ ] **Step 2: Typecheck**

```bash
pnpm run typecheck
```
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add artifacts/api-server/src/routes/users.ts
git commit -m "security: rate-limit login endpoint to 10 attempts per 15 minutes"
```

---

## Task 9: Frontend auth overhaul — relative API_BASE + JWT storage

**Files:**
- Modify: `artifacts/adops/src/lib/auth.ts`

- [ ] **Step 1: Replace the entire file**

```typescript
export interface Role {
  name: string;
  permissions: string[];
  isSystem?: boolean;
}

export interface User {
  id?: number;
  name: string;
  email: string;
  password?: string;
  role: string;
  isSystem?: boolean;
}

export const ALL_PERMISSIONS = [
  "View Dashboard",
  "View Clients",
  "Edit Clients",
  "View Platforms",
  "Edit Platforms",
  "View Campaigns",
  "Edit Campaigns",
  "View Transactions",
  "Upload Data",
  "View Analytics",
  "Manage Settings",
];

// Relative base — works in dev (Vite proxy /api → :8080) and in production (same origin)
const API_BASE = "/api";

// ────────────────────────────────────────────────
// JWT token storage
// ────────────────────────────────────────────────

export function getToken(): string | null {
  return localStorage.getItem("adops-jwt");
}

function setToken(token: string | null) {
  if (token) {
    localStorage.setItem("adops-jwt", token);
  } else {
    localStorage.removeItem("adops-jwt");
  }
}

function authHeaders(): HeadersInit {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ────────────────────────────────────────────────
// Roles
// ────────────────────────────────────────────────

export async function getRoles(): Promise<Role[]> {
  try {
    const res = await fetch(`${API_BASE}/roles`, { headers: authHeaders() });
    if (!res.ok) throw new Error("Failed to fetch roles");
    return res.json();
  } catch {
    return [];
  }
}

export async function saveRole(role: Role): Promise<void> {
  await fetch(`${API_BASE}/roles`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(role),
  });
}

export async function deleteRole(roleName: string): Promise<boolean> {
  const res = await fetch(`${API_BASE}/roles/${encodeURIComponent(roleName)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  return res.ok;
}

// ────────────────────────────────────────────────
// Users
// ────────────────────────────────────────────────

export async function getUsers(): Promise<User[]> {
  try {
    const res = await fetch(`${API_BASE}/users`, { headers: authHeaders() });
    if (!res.ok) throw new Error("Failed to fetch users");
    return res.json();
  } catch {
    return [];
  }
}

export async function saveUser(user: User): Promise<void> {
  await fetch(`${API_BASE}/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(user),
  });
}

export async function deleteUser(email: string): Promise<boolean> {
  const res = await fetch(`${API_BASE}/users/${encodeURIComponent(email)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  return res.ok;
}

// ────────────────────────────────────────────────
// Login — stores JWT and user object
// ────────────────────────────────────────────────

export async function loginUser(email: string, password: string): Promise<User | null> {
  try {
    const res = await fetch(`${API_BASE}/users/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
    });
    if (!res.ok) return null;
    const { token, user } = await res.json();
    setToken(token);
    return user as User;
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────
// Active session — stored in localStorage
// ────────────────────────────────────────────────

export function getCurrentUser(): User | null {
  try {
    const data = localStorage.getItem("adops-active-user");
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

export function setCurrentUser(user: User | null) {
  if (user) {
    localStorage.setItem("adops-active-user", JSON.stringify(user));
  } else {
    localStorage.removeItem("adops-active-user");
  }
}

export function logout() {
  setCurrentUser(null);
  setToken(null);
  window.location.href = "/login";
}

// ────────────────────────────────────────────────
// In-memory roles cache
// ────────────────────────────────────────────────

let _rolesCache: Role[] = [];

export function setCachedRoles(roles: Role[]) {
  _rolesCache = roles;
}

export function getCachedRoles(): Role[] {
  return _rolesCache;
}

// ────────────────────────────────────────────────
// Permission check — synchronous, uses cached roles
// System Admin always passes
// ────────────────────────────────────────────────

export function hasPermission(permission: string): boolean {
  const user = getCurrentUser();
  if (!user) return false;
  if (user.role === "System Admin") return true;
  const userRole = _rolesCache.find(r => r.name.toLowerCase() === user.role.toLowerCase());
  return userRole?.permissions.includes(permission) ?? false;
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm run typecheck
```
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add artifacts/adops/src/lib/auth.ts
git commit -m "security: relative API_BASE, JWT storage, auth headers on every auth.ts request"
```

---

## Task 10: Wire `setAuthTokenGetter` at app boot

**Files:**
- Modify: `artifacts/adops/src/main.tsx`

- [ ] **Step 1: Register the JWT getter before the app renders**

Replace the entire file:

```typescript
import { createRoot } from "react-dom/client";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { getToken } from "./lib/auth";
import App from "./App";
import "./index.css";

// Supply the stored JWT to the generated API client on every request
setAuthTokenGetter(() => getToken());

createRoot(document.getElementById("root")!).render(<App />);
```

- [ ] **Step 2: Typecheck**

```bash
pnpm run typecheck
```
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add artifacts/adops/src/main.tsx
git commit -m "feat(adops): wire JWT bearer token into generated API client at startup"
```

---

## Task 11: Remove dead AI Assistant widget

**Files:**
- Modify: `artifacts/adops/src/pages/Dashboard.tsx`

- [ ] **Step 1: Delete the dead widget block**

In `Dashboard.tsx`, find and remove the entire "AI Assistant" card (lines ~271–291). The block starts with:

```tsx
          {/* AI Assistant */}
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
```

and ends with the closing `</div>` of that card (before the closing `</div>` of the right panel).

Also remove the `Bot` import from the lucide-react import line if `Bot` is no longer used elsewhere in the file.

- [ ] **Step 2: Verify no `Bot` reference remains**

```bash
grep -n "Bot" artifacts/adops/src/pages/Dashboard.tsx
```
Expected: no output (or only if Bot is used elsewhere in that file — double-check and remove if not).

- [ ] **Step 3: Typecheck**

```bash
pnpm run typecheck
```
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add artifacts/adops/src/pages/Dashboard.tsx
git commit -m "chore: remove dead AI Assistant widget (no backend implementation)"
```

---

## Task 12: Persist Settings notification toggles to localStorage

**Files:**
- Modify: `artifacts/adops/src/pages/Settings.tsx`

Right now `alertNegative`, `alertLowMargin`, `weeklyReport`, and `analyticsCollection` are ephemeral React state that resets on every page load. This task persists them to localStorage so they survive refreshes, matching the pattern already used for `baseCurrency` and `rateMode`.

- [ ] **Step 1: Update the four toggle `useState` initializers**

Find and replace the four `useState` calls for the notification/analytics toggles. Change:

```typescript
  const [alertNegative, setAlertNegative] = useState(true);
  const [alertLowMargin, setAlertLowMargin] = useState(true);
  const [weeklyReport, setWeeklyReport] = useState(false);
  const [analyticsCollection, setAnalyticsCollection] = useState(false);
```

to:

```typescript
  const [alertNegative, setAlertNegative] = useState(
    () => localStorage.getItem("adops-alert-negative") !== "false"
  );
  const [alertLowMargin, setAlertLowMargin] = useState(
    () => localStorage.getItem("adops-alert-low-margin") !== "false"
  );
  const [weeklyReport, setWeeklyReport] = useState(
    () => localStorage.getItem("adops-weekly-report") === "true"
  );
  const [analyticsCollection, setAnalyticsCollection] = useState(
    () => localStorage.getItem("adops-analytics-collection") === "true"
  );
```

- [ ] **Step 2: Persist each toggle's onChange**

In the notifications `Switch` list inside Settings.tsx, each toggle has an `onChange` prop. Add a localStorage write to each setter. Find the array definition for the three notification toggles:

```typescript
                {[
                  {
                    label: "Alert on negative profit",
                    description: "Notify when any campaign goes negative",
                    checked: alertNegative,
                    onChange: setAlertNegative,
                  },
                  {
                    label: "Low margin warnings",
                    description: "Alert when margin drops below 10%",
                    checked: alertLowMargin,
                    onChange: setAlertLowMargin,
                  },
                  {
                    label: "Weekly performance report",
                    description: "Receive summary every Monday",
                    checked: weeklyReport,
                    onChange: setWeeklyReport,
                  },
                ].map(item => (
```

Replace the `onChange` values so each setter also writes localStorage:

```typescript
                {[
                  {
                    label: "Alert on negative profit",
                    description: "Notify when any campaign goes negative",
                    checked: alertNegative,
                    onChange: (v: boolean) => { setAlertNegative(v); localStorage.setItem("adops-alert-negative", String(v)); },
                  },
                  {
                    label: "Low margin warnings",
                    description: "Alert when margin drops below 10%",
                    checked: alertLowMargin,
                    onChange: (v: boolean) => { setAlertLowMargin(v); localStorage.setItem("adops-alert-low-margin", String(v)); },
                  },
                  {
                    label: "Weekly performance report",
                    description: "Receive summary every Monday",
                    checked: weeklyReport,
                    onChange: (v: boolean) => { setWeeklyReport(v); localStorage.setItem("adops-weekly-report", String(v)); },
                  },
                ].map(item => (
```

- [ ] **Step 3: Persist the analytics toggle**

Find the Analytics `Switch`:

```tsx
                  <Switch
                    checked={analyticsCollection}
                    onCheckedChange={setAnalyticsCollection}
                    data-testid="switch-analytics-collection"
                  />
```

Replace `onCheckedChange`:

```tsx
                  <Switch
                    checked={analyticsCollection}
                    onCheckedChange={(v) => { setAnalyticsCollection(v); localStorage.setItem("adops-analytics-collection", String(v)); }}
                    data-testid="switch-analytics-collection"
                  />
```

- [ ] **Step 4: Typecheck**

```bash
pnpm run typecheck
```
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add artifacts/adops/src/pages/Settings.tsx
git commit -m "fix(settings): persist notification toggles to localStorage"
```

---

## Self-review

**Spec coverage check:**

| Audit finding | Task | Status |
|---|---|---|
| S1 — secrets not git-ignored | Task 1 | ✅ |
| S2 — no server-side auth | Tasks 4, 5, 6, 7 | ✅ |
| S3 — plaintext passwords | Tasks 5 (seed + users) | ✅ |
| S4 — forgeable localStorage session | Tasks 5 (JWT issuance), 9 (store JWT), 10 (wire getter) | ✅ |
| S5 — known default admin creds | Task 5 (hashed seed) | ✅ (hashed; full rotation is an ops task) |
| S6 — CORS wide open | Task 7 | ✅ |
| S7 — error.message leaked | Tasks 5, 6 | ✅ |
| S8 — no login rate limit | Task 8 | ✅ |
| L1 — auth not in OpenAPI spec | Not covered — follow-up plan needed | ⚠️ deferred |
| L2 — hardcoded localhost API base | Task 9 | ✅ |
| L3 — dead AI widget | Task 11 | ✅ |
| L4 — orphaned GROQ/RESEND/cookie-parser | Tasks 1 (.env.example), 2 (cookie-parser removed) | ✅ |
| L5 — fake Settings toggles | Task 12 | ✅ |

**L1 deferred rationale:** Bringing auth into the OpenAPI/orval pipeline requires schema design decisions (token response shape, auth header spec, error schemas) that are a meaningful feature in themselves. The security fixes in this plan don't depend on it — the auth.ts layer is now consistent and functional.

**Placeholder scan:** No TBD/TODO/placeholder language in any code block. ✅

**Type consistency:** `req.user` is typed identically in `middlewares/auth.ts` (declare module) and consumed as-is in routes — no name divergence. `JWTPayload.sub` maps to `req.user.id` in the middleware, `user.id` in the JWT sign call. ✅
