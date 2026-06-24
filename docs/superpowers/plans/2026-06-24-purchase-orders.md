# Purchase Orders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a **Purchase Orders** section with two tabs — **Clients** (POs received from clients, stored with an uploaded attachment) and **Partners** (POs issued to partners, priced from partner payout rates, viewable as a downloadable invoice).

**Architecture:** Three new Drizzle tables → OpenAPI paths/schemas → orval-generated zod + React Query hooks → Next.js route handlers → App Router pages. The partner-PO create flow is driven entirely by the **existing** `listPartnerClients` endpoint (it already returns each linked client with its `events[]` including `payoutRate`), so no new "payable events" endpoint is needed. The invoice is one HTML/Tailwind component rendered on a dedicated route; "Download PDF" captures it via `html2canvas → jsPDF`.

**Tech Stack:** Next.js 15 (App Router, route handlers), Drizzle ORM + Postgres (`drizzle-kit push`), `@workspace/api-spec` (OpenAPI + orval), React Query, react-hook-form + zod, shadcn/ui, `html2canvas` + `jspdf`, vitest (node env).

**Spec:** `docs/superpowers/specs/2026-06-24-purchase-orders-design.md`

---

## Conventions (read once)

- **Route handlers** (`app/app/api/**/route.ts`): `export const runtime = "nodejs"`. Parse JSON, validate with generated zod (`@workspace/api-zod`), query via `db` from `@workspace/db`, return `NextResponse.json(SomeResponseSchema.parse(mapped), { status })`. Drizzle `numeric`/`date` columns come back as **strings** — convert with `Number(...)` when mapping to JSON (see `app/app/api/clients/route.ts` `mapRow`).
- **Auth/createdBy**: middleware already enforces auth on `/api/*`. Handlers get the user via `getSession()` from `@/lib/auth/session` (returns `SessionUser | null` with `.id`, `.name`). Permission gating is done in the **UI** (PermissionGuard + `useHasPermission`), matching the existing clients/partners pages.
- **Generated names** (orval): operationId `createFooBar` → hook `useCreateFooBar`, request schema `CreateFooBarBody`, response schema `CreateFooBarResponse`; `listFooBars` → `useListFooBars` + `getListFooBarsQueryKey` + `ListFooBarsResponse`.
- **Tests**: vitest, node env, file `*.test.ts` next to source. Mock `@workspace/db` and `@/lib/auth/session` with `vi.mock` (see `app/app/api/users/login/route.test.ts`). Run from `app/`: `pnpm test <path>`. There is **no** React component test harness — UI is verified by `pnpm typecheck` + `pnpm build` + a manual checklist (Task 19).
- **Commits**: one per task (or per logical step group). Conventional Commit messages.

## File Structure

**Create — DB (`lib/db/src/schema/`):**
- `client-purchase-orders.ts` — `clientPurchaseOrdersTable` + `ClientPurchaseOrder` type
- `partner-purchase-orders.ts` — `partnerPurchaseOrdersTable` + `PartnerPurchaseOrder` type
- `partner-purchase-order-items.ts` — `partnerPurchaseOrderItemsTable` + `PartnerPurchaseOrderItem` type

**Create — utils (`app/lib/`):**
- `po-codes.ts` — `formatPoCode(prefix, year, seq)` (pure)
- `po-totals.ts` — `lineBudget`, `totalBudget`, `PoLineInput` (pure)
- `po-attachment.ts` — `uploadPoAttachment(file)` fetch helper
- `po-pdf.ts` — `downloadInvoicePdf(node, filename)` (html2canvas + jsPDF)

**Create — API (`app/app/api/`):**
- `client-purchase-orders/route.ts` (GET list, POST) + `route.test.ts`
- `client-purchase-orders/[id]/route.ts` (GET, PATCH, DELETE)
- `clients/[id]/purchase-orders/route.ts` (GET)
- `partner-purchase-orders/route.ts` (GET list, POST) + `route.test.ts`
- `partner-purchase-orders/[id]/route.ts` (GET, PATCH, DELETE)
- `uploads/po-attachment/route.ts` (POST)

**Create — UI (`app/`):**
- `app/(dashboard)/purchase-orders/page.tsx` — tabs shell + guard
- `app/(dashboard)/purchase-orders/ppo/[id]/page.tsx` — invoice view
- `components/purchase-orders/ClientPOTab.tsx`
- `components/purchase-orders/CreateClientPODialog.tsx`
- `components/purchase-orders/ClientPODetailDialog.tsx` (view + edit a CPO)
- `components/purchase-orders/PartnerPOTab.tsx`
- `components/purchase-orders/CreatePartnerPODialog.tsx` (dual create + edit mode)
- `components/purchase-orders/PartnerInvoice.tsx`
- `public/advengers-logo.png` (asset from user; ship a placeholder until provided)

**Modify:**
- `lib/db/src/schema/index.ts` — export the 3 new schema files
- `lib/api-spec/openapi.yaml` — add paths + component schemas
- `app/components/layout/Sidebar.tsx` — add nav item
- `app/scripts/seed.ts` — add permissions
- `app/package.json` — promote `html2canvas` to a direct dependency

---

## Task 1: Database schema (3 tables)

**Files:**
- Create: `lib/db/src/schema/client-purchase-orders.ts`, `partner-purchase-orders.ts`, `partner-purchase-order-items.ts`
- Modify: `lib/db/src/schema/index.ts`

- [ ] **Step 1: Create `client-purchase-orders.ts`**

```ts
import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { clientsTable } from "./clients";
import { usersTable } from "./auth";

export const clientPurchaseOrdersTable = pgTable("client_purchase_orders", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  clientId: integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "restrict" }),
  attachmentUrl: text("attachment_url").notNull(),
  attachmentName: text("attachment_name"),
  createdById: integer("created_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type ClientPurchaseOrder = typeof clientPurchaseOrdersTable.$inferSelect;
```

- [ ] **Step 2: Create `partner-purchase-orders.ts`**

```ts
import { pgTable, serial, integer, text, numeric, date, timestamp } from "drizzle-orm/pg-core";
import { partnersTable } from "./partners";
import { clientPurchaseOrdersTable } from "./client-purchase-orders";
import { usersTable } from "./auth";

export const partnerPurchaseOrdersTable = pgTable("partner_purchase_orders", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  partnerId: integer("partner_id").notNull().references(() => partnersTable.id, { onDelete: "restrict" }),
  clientPurchaseOrderId: integer("client_purchase_order_id").notNull()
    .references(() => clientPurchaseOrdersTable.id, { onDelete: "restrict" }),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  totalBudget: numeric("total_budget", { precision: 14, scale: 2 }).notNull(),
  createdById: integer("created_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type PartnerPurchaseOrder = typeof partnerPurchaseOrdersTable.$inferSelect;
```

- [ ] **Step 3: Create `partner-purchase-order-items.ts`**

```ts
import { pgTable, serial, integer, text, numeric } from "drizzle-orm/pg-core";
import { partnerPurchaseOrdersTable } from "./partner-purchase-orders";
import { clientEventsTable } from "./client-events";

export const partnerPurchaseOrderItemsTable = pgTable("partner_purchase_order_items", {
  id: serial("id").primaryKey(),
  partnerPurchaseOrderId: integer("partner_purchase_order_id").notNull()
    .references(() => partnerPurchaseOrdersTable.id, { onDelete: "cascade" }),
  clientEventId: integer("client_event_id").notNull()
    .references(() => clientEventsTable.id, { onDelete: "restrict" }),
  eventName: text("event_name").notNull(),
  cacRate: numeric("cac_rate", { precision: 12, scale: 4 }).notNull(),
  eventCount: integer("event_count").notNull(),
  lineBudget: numeric("line_budget", { precision: 14, scale: 2 }).notNull(),
});

export type PartnerPurchaseOrderItem = typeof partnerPurchaseOrderItemsTable.$inferSelect;
```

- [ ] **Step 4: Export from `lib/db/src/schema/index.ts`**

Add these three lines after the existing `partner-event-payouts` export:

```ts
export * from "./client-purchase-orders";
export * from "./partner-purchase-orders";
export * from "./partner-purchase-order-items";
```

- [ ] **Step 5: Push schema to the database**

Run (from repo root; requires `DATABASE_URL` in env): `pnpm --filter @workspace/db push`
Expected: drizzle-kit reports the 3 new tables created, no errors. (Dev DB; destructive push is acceptable per spec.)

- [ ] **Step 6: Typecheck the db package**

Run: `pnpm run typecheck:libs`
Expected: PASS (no type errors).

- [ ] **Step 7: Commit**

```bash
git add lib/db/src/schema/
git commit -m "feat(db): add purchase order tables (client + partner + items)"
```

---

## Task 2: PO code formatter (pure util, TDD)

**Files:**
- Create: `app/lib/po-codes.ts`, `app/lib/po-codes.test.ts`

- [ ] **Step 1: Write the failing test** — `app/lib/po-codes.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { formatPoCode } from "./po-codes";

describe("formatPoCode", () => {
  it("zero-pads the sequence to 4 digits", () => {
    expect(formatPoCode("CPO", 2026, 1)).toBe("CPO-2026-0001");
    expect(formatPoCode("PPO", 2026, 42)).toBe("PPO-2026-0042");
  });
  it("does not truncate sequences beyond 4 digits", () => {
    expect(formatPoCode("CPO", 2026, 12345)).toBe("CPO-2026-12345");
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `pnpm test app/lib/po-codes.test.ts` (from `app/`: `pnpm test lib/po-codes.test.ts`)
Expected: FAIL — `formatPoCode` not found.

- [ ] **Step 3: Implement** — `app/lib/po-codes.ts`

```ts
export type PoPrefix = "CPO" | "PPO";

export function formatPoCode(prefix: PoPrefix, year: number, seq: number): string {
  return `${prefix}-${year}-${String(seq).padStart(4, "0")}`;
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `pnpm test lib/po-codes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/lib/po-codes.ts app/lib/po-codes.test.ts
git commit -m "feat: add PO code formatter util"
```

---

## Task 3: Budget math (pure util, TDD)

**Files:**
- Create: `app/lib/po-totals.ts`, `app/lib/po-totals.test.ts`

- [ ] **Step 1: Write the failing test** — `app/lib/po-totals.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { lineBudget, totalBudget } from "./po-totals";

describe("lineBudget", () => {
  it("multiplies rate by count, rounded to 2 dp", () => {
    expect(lineBudget(0.8, 1000)).toBe(800);
    expect(lineBudget(0.2, 1000)).toBe(200);
    expect(lineBudget(0.075, 333)).toBe(24.98);
  });
});

describe("totalBudget", () => {
  it("sums line budgets, rounded to 2 dp", () => {
    expect(totalBudget([{ cacRate: 0.8, eventCount: 1000 }, { cacRate: 0.2, eventCount: 1000 }])).toBe(1000);
  });
  it("returns 0 for no items", () => {
    expect(totalBudget([])).toBe(0);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `pnpm test lib/po-totals.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `app/lib/po-totals.ts`

```ts
export interface PoLineInput {
  cacRate: number;
  eventCount: number;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function lineBudget(cacRate: number, eventCount: number): number {
  return round2(cacRate * eventCount);
}

export function totalBudget(items: PoLineInput[]): number {
  return round2(items.reduce((sum, i) => sum + i.cacRate * i.eventCount, 0));
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `pnpm test lib/po-totals.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/lib/po-totals.ts app/lib/po-totals.test.ts
git commit -m "feat: add PO budget math utils"
```

---

## Task 4: OpenAPI paths + schemas

**Files:**
- Modify: `lib/api-spec/openapi.yaml`

- [ ] **Step 1: Add paths.** Under `paths:`, after the `/partners/...` block (before the financials section), insert:

```yaml
  # ── Client Purchase Orders ────────────────────────────────────────────────────
  /client-purchase-orders:
    get:
      operationId: listClientPurchaseOrders
      tags: [purchase-orders]
      summary: List client purchase orders
      responses:
        "200":
          description: List
          content:
            application/json:
              schema: { type: array, items: { $ref: "#/components/schemas/ClientPurchaseOrder" } }
    post:
      operationId: createClientPurchaseOrder
      tags: [purchase-orders]
      summary: Create a client purchase order
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/ClientPurchaseOrderInput" }
      responses:
        "201":
          description: Created
          content:
            application/json:
              schema: { $ref: "#/components/schemas/ClientPurchaseOrder" }
        "400": { description: Validation error }

  /client-purchase-orders/{id}:
    get:
      operationId: getClientPurchaseOrder
      tags: [purchase-orders]
      summary: Get a client purchase order
      parameters: [{ name: id, in: path, required: true, schema: { type: integer } }]
      responses:
        "200":
          description: CPO
          content:
            application/json:
              schema: { $ref: "#/components/schemas/ClientPurchaseOrder" }
        "404": { description: Not found }
    patch:
      operationId: updateClientPurchaseOrder
      tags: [purchase-orders]
      summary: Update a client purchase order
      parameters: [{ name: id, in: path, required: true, schema: { type: integer } }]
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/ClientPurchaseOrderUpdate" }
      responses:
        "200":
          description: Updated
          content:
            application/json:
              schema: { $ref: "#/components/schemas/ClientPurchaseOrder" }
        "404": { description: Not found }
    delete:
      operationId: deleteClientPurchaseOrder
      tags: [purchase-orders]
      summary: Delete a client purchase order
      parameters: [{ name: id, in: path, required: true, schema: { type: integer } }]
      responses:
        "204": { description: Deleted }
        "409": { description: Has linked partner purchase orders }
        "404": { description: Not found }

  /clients/{id}/purchase-orders:
    get:
      operationId: listClientPurchaseOrdersByClient
      tags: [purchase-orders]
      summary: List a client's purchase orders (for the PPO dropdown)
      parameters: [{ name: id, in: path, required: true, schema: { type: integer } }]
      responses:
        "200":
          description: List
          content:
            application/json:
              schema: { type: array, items: { $ref: "#/components/schemas/ClientPurchaseOrder" } }

  # ── Partner Purchase Orders ───────────────────────────────────────────────────
  /partner-purchase-orders:
    get:
      operationId: listPartnerPurchaseOrders
      tags: [purchase-orders]
      summary: List partner purchase orders
      responses:
        "200":
          description: List
          content:
            application/json:
              schema: { type: array, items: { $ref: "#/components/schemas/PartnerPurchaseOrder" } }
    post:
      operationId: createPartnerPurchaseOrder
      tags: [purchase-orders]
      summary: Create a partner purchase order
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/PartnerPurchaseOrderInput" }
      responses:
        "201":
          description: Created
          content:
            application/json:
              schema: { $ref: "#/components/schemas/PartnerPurchaseOrder" }
        "400": { description: Validation error }

  /partner-purchase-orders/{id}:
    get:
      operationId: getPartnerPurchaseOrder
      tags: [purchase-orders]
      summary: Get a partner purchase order (full detail for invoice)
      parameters: [{ name: id, in: path, required: true, schema: { type: integer } }]
      responses:
        "200":
          description: PPO
          content:
            application/json:
              schema: { $ref: "#/components/schemas/PartnerPurchaseOrder" }
        "404": { description: Not found }
    patch:
      operationId: updatePartnerPurchaseOrder
      tags: [purchase-orders]
      summary: Update a partner purchase order
      parameters: [{ name: id, in: path, required: true, schema: { type: integer } }]
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/PartnerPurchaseOrderUpdate" }
      responses:
        "200":
          description: Updated
          content:
            application/json:
              schema: { $ref: "#/components/schemas/PartnerPurchaseOrder" }
        "404": { description: Not found }
    delete:
      operationId: deletePartnerPurchaseOrder
      tags: [purchase-orders]
      summary: Delete a partner purchase order
      parameters: [{ name: id, in: path, required: true, schema: { type: integer } }]
      responses:
        "204": { description: Deleted }
        "404": { description: Not found }
```

- [ ] **Step 2: Add component schemas.** Under `components: schemas:`, after the `PartnerClient` block, insert:

```yaml
    ClientPurchaseOrder:
      type: object
      required: [id, code, clientId, clientName, attachmentUrl, createdAt]
      properties:
        id: { type: integer }
        code: { type: string }
        clientId: { type: integer }
        clientName: { type: string }
        buyingHouseName: { type: ["string", "null"] }
        attachmentUrl: { type: string }
        attachmentName: { type: ["string", "null"] }
        createdById: { type: ["integer", "null"] }
        createdByName: { type: ["string", "null"] }
        createdAt: { type: string }

    ClientPurchaseOrderInput:
      type: object
      required: [clientId, attachmentUrl]
      properties:
        clientId: { type: integer }
        attachmentUrl: { type: string, minLength: 1 }
        attachmentName: { type: ["string", "null"] }

    ClientPurchaseOrderUpdate:
      type: object
      properties:
        clientId: { type: integer }
        attachmentUrl: { type: string, minLength: 1 }
        attachmentName: { type: ["string", "null"] }

    PartnerPurchaseOrderItem:
      type: object
      required: [id, clientEventId, eventName, cacRate, eventCount, lineBudget]
      properties:
        id: { type: integer }
        clientEventId: { type: integer }
        eventName: { type: string }
        cacRate: { type: number }
        eventCount: { type: integer }
        lineBudget: { type: number }

    PartnerPurchaseOrderItemInput:
      type: object
      required: [clientEventId, eventName, cacRate, eventCount]
      properties:
        clientEventId: { type: integer }
        eventName: { type: string, minLength: 1 }
        cacRate: { type: number }
        eventCount: { type: integer, minimum: 1 }

    PartnerPurchaseOrder:
      type: object
      required: [id, code, partnerId, partnerName, clientPurchaseOrderId, cpoCode, clientId, clientName, startDate, endDate, totalBudget, createdAt, items]
      properties:
        id: { type: integer }
        code: { type: string }
        partnerId: { type: integer }
        partnerName: { type: string }
        clientPurchaseOrderId: { type: integer }
        cpoCode: { type: string }
        clientId: { type: integer }
        clientName: { type: string }
        buyingHouseName: { type: ["string", "null"] }
        startDate: { type: string }
        endDate: { type: string }
        totalBudget: { type: number }
        createdById: { type: ["integer", "null"] }
        createdByName: { type: ["string", "null"] }
        createdAt: { type: string }
        partner: { $ref: "#/components/schemas/Partner" }
        items:
          type: array
          items: { $ref: "#/components/schemas/PartnerPurchaseOrderItem" }

    PartnerPurchaseOrderInput:
      type: object
      required: [partnerId, clientPurchaseOrderId, startDate, endDate, items]
      properties:
        partnerId: { type: integer }
        clientPurchaseOrderId: { type: integer }
        startDate: { type: string }
        endDate: { type: string }
        items:
          type: array
          minItems: 1
          items: { $ref: "#/components/schemas/PartnerPurchaseOrderItemInput" }

    PartnerPurchaseOrderUpdate:
      type: object
      properties:
        startDate: { type: string }
        endDate: { type: string }
        items:
          type: array
          items: { $ref: "#/components/schemas/PartnerPurchaseOrderItemInput" }
```

Note: `PartnerPurchaseOrder.partner` reuses the existing `Partner` schema so the invoice gets full KYC without a second fetch.

- [ ] **Step 3: Commit**

```bash
git add lib/api-spec/openapi.yaml
git commit -m "feat(api-spec): add purchase order paths and schemas"
```

---

## Task 5: Regenerate the API client

**Files:** generated — `lib/api-zod/src/generated/**`, `lib/api-client-react/src/generated/**`

- [ ] **Step 1: Run codegen**

Run: `pnpm --filter @workspace/api-spec codegen`
Expected: orval regenerates without error, then `typecheck:libs` passes. New hooks exist: `useListClientPurchaseOrders`, `useCreateClientPurchaseOrder`, `useGetClientPurchaseOrder`, `useUpdateClientPurchaseOrder`, `useDeleteClientPurchaseOrder`, `useListClientPurchaseOrdersByClient`, `useListPartnerPurchaseOrders`, `useCreatePartnerPurchaseOrder`, `useGetPartnerPurchaseOrder`, `useUpdatePartnerPurchaseOrder`, `useDeletePartnerPurchaseOrder` (+ `getList...QueryKey` variants).

- [ ] **Step 2: Verify generated symbols**

Run: `grep -c "useCreatePartnerPurchaseOrder\|useListClientPurchaseOrders\|useListClientPurchaseOrdersByClient" lib/api-client-react/src/generated/api.ts`
Expected: ≥ 3.

- [ ] **Step 3: Commit**

```bash
git add lib/api-zod/src/generated lib/api-client-react/src/generated
git commit -m "chore: regenerate api client for purchase orders"
```

---

## Task 6: Client PO route handlers + tests

**Files:**
- Create: `app/app/api/client-purchase-orders/route.ts`, `app/app/api/client-purchase-orders/[id]/route.ts`, `app/app/api/client-purchase-orders/route.test.ts`

- [ ] **Step 1: Implement list + create** — `app/app/api/client-purchase-orders/route.ts`

```ts
import { NextResponse } from "next/server";
import { eq, and, gte, lt, count } from "drizzle-orm";
import {
  db, clientPurchaseOrdersTable, clientsTable, buyingHousesTable, usersTable,
} from "@workspace/db";
import { CreateClientPurchaseOrderBody } from "@workspace/api-zod";
import { getSession } from "@/lib/auth/session";
import { formatPoCode } from "@/lib/po-codes";

export const runtime = "nodejs";

type Row = typeof clientPurchaseOrdersTable.$inferSelect;

export async function mapCpoRow(r: Row) {
  const [client] = await db.select({ name: clientsTable.name, buyingHouseId: clientsTable.buyingHouseId })
    .from(clientsTable).where(eq(clientsTable.id, r.clientId));
  let buyingHouseName: string | null = null;
  if (client?.buyingHouseId != null) {
    const [bh] = await db.select({ name: buyingHousesTable.name })
      .from(buyingHousesTable).where(eq(buyingHousesTable.id, client.buyingHouseId));
    buyingHouseName = bh?.name ?? null;
  }
  let createdByName: string | null = null;
  if (r.createdById != null) {
    const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, r.createdById));
    createdByName = u?.name ?? null;
  }
  return {
    id: r.id, code: r.code, clientId: r.clientId, clientName: client?.name ?? "—",
    buyingHouseName, attachmentUrl: r.attachmentUrl, attachmentName: r.attachmentName,
    createdById: r.createdById ?? null, createdByName, createdAt: r.createdAt.toISOString(),
  };
}

async function nextCpoCode(): Promise<string> {
  const year = new Date().getFullYear();
  const start = new Date(year, 0, 1);
  const end = new Date(year + 1, 0, 1);
  const [{ value }] = await db.select({ value: count() }).from(clientPurchaseOrdersTable)
    .where(and(gte(clientPurchaseOrdersTable.createdAt, start), lt(clientPurchaseOrdersTable.createdAt, end)));
  return formatPoCode("CPO", year, Number(value) + 1);
}

export async function GET(): Promise<Response> {
  const rows = await db.select().from(clientPurchaseOrdersTable).orderBy(clientPurchaseOrdersTable.createdAt);
  return NextResponse.json(await Promise.all(rows.map(mapCpoRow)));
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = CreateClientPurchaseOrderBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const user = await getSession();
  const [row] = await db.insert(clientPurchaseOrdersTable).values({
    code: await nextCpoCode(),
    clientId: parsed.data.clientId,
    attachmentUrl: parsed.data.attachmentUrl,
    attachmentName: parsed.data.attachmentName ?? null,
    createdById: user?.id ?? null,
  }).returning();
  return NextResponse.json(await mapCpoRow(row), { status: 201 });
}
```

- [ ] **Step 2: Implement get + patch + delete** — `app/app/api/client-purchase-orders/[id]/route.ts`

```ts
import { NextResponse } from "next/server";
import { eq, count } from "drizzle-orm";
import { db, clientPurchaseOrdersTable, partnerPurchaseOrdersTable } from "@workspace/db";
import { UpdateClientPurchaseOrderBody } from "@workspace/api-zod";
import { mapCpoRow } from "../route";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const [row] = await db.select().from(clientPurchaseOrdersTable).where(eq(clientPurchaseOrdersTable.id, Number(id)));
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(await mapCpoRow(row));
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = UpdateClientPurchaseOrderBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const [row] = await db.update(clientPurchaseOrdersTable).set({
    ...(parsed.data.clientId !== undefined ? { clientId: parsed.data.clientId } : {}),
    ...(parsed.data.attachmentUrl !== undefined ? { attachmentUrl: parsed.data.attachmentUrl } : {}),
    ...(parsed.data.attachmentName !== undefined ? { attachmentName: parsed.data.attachmentName } : {}),
  }).where(eq(clientPurchaseOrdersTable.id, Number(id))).returning();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(await mapCpoRow(row));
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const [{ value }] = await db.select({ value: count() }).from(partnerPurchaseOrdersTable)
    .where(eq(partnerPurchaseOrdersTable.clientPurchaseOrderId, Number(id)));
  if (Number(value) > 0) {
    return NextResponse.json({ error: "Remove linked Partner POs first" }, { status: 409 });
  }
  await db.delete(clientPurchaseOrdersTable).where(eq(clientPurchaseOrdersTable.id, Number(id)));
  return new NextResponse(null, { status: 204 });
}
```

Note: Next.js 15 route params are async (`Promise<{ id }>`). Confirm against an existing `[id]/route.ts` and match its signature exactly.

- [ ] **Step 3: Write the handler test** — `app/app/api/client-purchase-orders/route.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const insertReturning = vi.fn();
const selectChain = vi.fn();

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => selectChain(), orderBy: () => selectChain() }) }),
    insert: () => ({ values: () => ({ returning: () => insertReturning() }) }),
  },
  clientPurchaseOrdersTable: {}, clientsTable: {}, buyingHousesTable: {}, usersTable: {},
}));
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn(async () => ({ id: 7, name: "Tester" })) }));

beforeEach(() => { insertReturning.mockReset(); selectChain.mockReset(); });

async function post(body: unknown) {
  const { POST } = await import("./route");
  return POST(new Request("http://localhost/api/client-purchase-orders", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }));
}

describe("POST /api/client-purchase-orders", () => {
  it("returns 400 when clientId/attachmentUrl missing", async () => {
    const res = await post({ clientId: 1 });
    expect(res.status).toBe(400);
  });

  it("creates with a generated CPO code and 201", async () => {
    selectChain
      .mockResolvedValueOnce([{ value: 0 }])                // year count -> seq 1
      .mockResolvedValueOnce([{ name: "JazzCash", buyingHouseId: null }]) // mapCpoRow client
      .mockResolvedValueOnce([{ name: "Tester" }]);         // mapCpoRow user
    insertReturning.mockResolvedValueOnce([{
      id: 1, code: "CPO-2026-0001", clientId: 1, attachmentUrl: "http://x/f.pdf",
      attachmentName: "f.pdf", createdById: 7, createdAt: new Date("2026-06-24T00:00:00Z"),
    }]);
    const res = await post({ clientId: 1, attachmentUrl: "http://x/f.pdf", attachmentName: "f.pdf" });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.code).toBe("CPO-2026-0001");
    expect(json.clientName).toBe("JazzCash");
  });
});
```

- [ ] **Step 4: Run the test — expect PASS**

Run: `pnpm test app/app/api/client-purchase-orders/route.test.ts`
Expected: PASS (both cases). If the chained-mock order mismatches, adjust `mockResolvedValueOnce` order to match the query order in `mapCpoRow`.

- [ ] **Step 5: Commit**

```bash
git add app/app/api/client-purchase-orders
git commit -m "feat(api): client purchase order CRUD handlers"
```

---

## Task 7: Client's POs sub-route (for the PPO dropdown)

**Files:**
- Create: `app/app/api/clients/[id]/purchase-orders/route.ts`

- [ ] **Step 1: Implement** — returns that client's CPOs newest-first

```ts
import { NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db, clientPurchaseOrdersTable } from "@workspace/db";
import { mapCpoRow } from "../../../client-purchase-orders/route";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const rows = await db.select().from(clientPurchaseOrdersTable)
    .where(eq(clientPurchaseOrdersTable.clientId, Number(id)))
    .orderBy(desc(clientPurchaseOrdersTable.createdAt));
  return NextResponse.json(await Promise.all(rows.map(mapCpoRow)));
}
```

Verify the relative import depth to `client-purchase-orders/route` resolves (`app/app/api/clients/[id]/purchase-orders/` → `../../../client-purchase-orders/route`).

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @workspace/web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/app/api/clients
git commit -m "feat(api): list a client's purchase orders"
```

---

## Task 8: Partner PO route handlers + tests

**Files:**
- Create: `app/app/api/partner-purchase-orders/route.ts`, `app/app/api/partner-purchase-orders/[id]/route.ts`, `app/app/api/partner-purchase-orders/route.test.ts`

- [ ] **Step 1: Implement list + create** — `app/app/api/partner-purchase-orders/route.ts`

```ts
import { NextResponse } from "next/server";
import { eq, and, gte, lt, count } from "drizzle-orm";
import {
  db, partnerPurchaseOrdersTable, partnerPurchaseOrderItemsTable, partnersTable,
  clientPurchaseOrdersTable, clientsTable, buyingHousesTable, usersTable,
} from "@workspace/db";
import { CreatePartnerPurchaseOrderBody } from "@workspace/api-zod";
import { getSession } from "@/lib/auth/session";
import { formatPoCode } from "@/lib/po-codes";
import { lineBudget, totalBudget } from "@/lib/po-totals";

export const runtime = "nodejs";

type Row = typeof partnerPurchaseOrdersTable.$inferSelect;

export async function mapPpoRow(r: Row) {
  const [partner] = await db.select().from(partnersTable).where(eq(partnersTable.id, r.partnerId));
  const [cpo] = await db.select().from(clientPurchaseOrdersTable).where(eq(clientPurchaseOrdersTable.id, r.clientPurchaseOrderId));
  const [client] = cpo ? await db.select({ id: clientsTable.id, name: clientsTable.name, buyingHouseId: clientsTable.buyingHouseId })
    .from(clientsTable).where(eq(clientsTable.id, cpo.clientId)) : [undefined];
  let buyingHouseName: string | null = null;
  if (client?.buyingHouseId != null) {
    const [bh] = await db.select({ name: buyingHousesTable.name }).from(buyingHousesTable).where(eq(buyingHousesTable.id, client.buyingHouseId));
    buyingHouseName = bh?.name ?? null;
  }
  let createdByName: string | null = null;
  if (r.createdById != null) {
    const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, r.createdById));
    createdByName = u?.name ?? null;
  }
  const itemRows = await db.select().from(partnerPurchaseOrderItemsTable)
    .where(eq(partnerPurchaseOrderItemsTable.partnerPurchaseOrderId, r.id));
  return {
    id: r.id, code: r.code, partnerId: r.partnerId, partnerName: partner?.name ?? "—",
    clientPurchaseOrderId: r.clientPurchaseOrderId, cpoCode: cpo?.code ?? "—",
    clientId: client?.id ?? 0, clientName: client?.name ?? "—", buyingHouseName,
    startDate: r.startDate, endDate: r.endDate, totalBudget: Number(r.totalBudget),
    createdById: r.createdById ?? null, createdByName, createdAt: r.createdAt.toISOString(),
    partner: partner ? mapPartnerKyc(partner) : undefined,
    items: itemRows.map(it => ({
      id: it.id, clientEventId: it.clientEventId, eventName: it.eventName,
      cacRate: Number(it.cacRate), eventCount: it.eventCount, lineBudget: Number(it.lineBudget),
    })),
  };
}

// Shape a partner row to match the generated `Partner` schema (KYC fields used by the invoice).
function mapPartnerKyc(p: typeof partnersTable.$inferSelect) {
  return {
    id: p.id, name: p.name, address: p.address, pocName: p.pocName, pocNumber: p.pocNumber,
    pocEmail: p.pocEmail, companyEmail: p.companyEmail, companyNumber: p.companyNumber,
    bankName: p.bankName, bankAccountNumber: p.bankAccountNumber, bankAddress: p.bankAddress,
    swiftCode: p.swiftCode, iban: p.iban, salesTaxNumber: p.salesTaxNumber, ntnNumber: p.ntnNumber,
    paymentTermsId: p.paymentTermsId ?? null, paymentTermName: null,
    createdAt: p.createdAt.toISOString(),
  };
}

async function nextPpoCode(): Promise<string> {
  const year = new Date().getFullYear();
  const start = new Date(year, 0, 1), end = new Date(year + 1, 0, 1);
  const [{ value }] = await db.select({ value: count() }).from(partnerPurchaseOrdersTable)
    .where(and(gte(partnerPurchaseOrdersTable.createdAt, start), lt(partnerPurchaseOrdersTable.createdAt, end)));
  return formatPoCode("PPO", year, Number(value) + 1);
}

export async function GET(): Promise<Response> {
  const rows = await db.select().from(partnerPurchaseOrdersTable).orderBy(partnerPurchaseOrdersTable.createdAt);
  return NextResponse.json(await Promise.all(rows.map(mapPpoRow)));
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = CreatePartnerPurchaseOrderBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const { partnerId, clientPurchaseOrderId, startDate, endDate, items } = parsed.data;
  const user = await getSession();
  const total = totalBudget(items.map(i => ({ cacRate: i.cacRate, eventCount: i.eventCount })));

  const [ppo] = await db.insert(partnerPurchaseOrdersTable).values({
    code: await nextPpoCode(), partnerId, clientPurchaseOrderId, startDate, endDate,
    totalBudget: String(total), createdById: user?.id ?? null,
  }).returning();

  await db.insert(partnerPurchaseOrderItemsTable).values(items.map(i => ({
    partnerPurchaseOrderId: ppo.id, clientEventId: i.clientEventId, eventName: i.eventName,
    cacRate: String(i.cacRate), eventCount: i.eventCount,
    lineBudget: String(lineBudget(i.cacRate, i.eventCount)),
  })));

  return NextResponse.json(await mapPpoRow(ppo), { status: 201 });
}
```

- [ ] **Step 2: Implement get + patch + delete** — `app/app/api/partner-purchase-orders/[id]/route.ts`

```ts
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, partnerPurchaseOrdersTable, partnerPurchaseOrderItemsTable } from "@workspace/db";
import { UpdatePartnerPurchaseOrderBody } from "@workspace/api-zod";
import { mapPpoRow } from "../route";
import { lineBudget, totalBudget } from "@/lib/po-totals";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const [row] = await db.select().from(partnerPurchaseOrdersTable).where(eq(partnerPurchaseOrdersTable.id, Number(id)));
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(await mapPpoRow(row));
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const ppoId = Number(id);
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = UpdatePartnerPurchaseOrderBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const { startDate, endDate, items } = parsed.data;

  if (items !== undefined) {
    await db.delete(partnerPurchaseOrderItemsTable).where(eq(partnerPurchaseOrderItemsTable.partnerPurchaseOrderId, ppoId));
    if (items.length) {
      await db.insert(partnerPurchaseOrderItemsTable).values(items.map(i => ({
        partnerPurchaseOrderId: ppoId, clientEventId: i.clientEventId, eventName: i.eventName,
        cacRate: String(i.cacRate), eventCount: i.eventCount, lineBudget: String(lineBudget(i.cacRate, i.eventCount)),
      })));
    }
  }
  const setTotal = items !== undefined
    ? { totalBudget: String(totalBudget(items.map(i => ({ cacRate: i.cacRate, eventCount: i.eventCount })))) }
    : {};
  const [row] = await db.update(partnerPurchaseOrdersTable).set({
    ...(startDate !== undefined ? { startDate } : {}),
    ...(endDate !== undefined ? { endDate } : {}),
    ...setTotal,
  }).where(eq(partnerPurchaseOrdersTable.id, ppoId)).returning();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(await mapPpoRow(row));
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  await db.delete(partnerPurchaseOrdersTable).where(eq(partnerPurchaseOrdersTable.id, Number(id)));
  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 3: Write the test** — `app/app/api/partner-purchase-orders/route.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const selectChain = vi.fn();
const insertReturning = vi.fn();
const insertItems = vi.fn(async () => undefined);

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => selectChain(), orderBy: () => selectChain() }) }),
    insert: (t: unknown) => ({
      values: (v: unknown) => ({
        returning: () => insertReturning(),
        then: undefined,
      }),
    }),
  },
  partnerPurchaseOrdersTable: {}, partnerPurchaseOrderItemsTable: {}, partnersTable: {},
  clientPurchaseOrdersTable: {}, clientsTable: {}, buyingHousesTable: {}, usersTable: {},
}));
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn(async () => ({ id: 7, name: "Tester" })) }));

beforeEach(() => { selectChain.mockReset(); insertReturning.mockReset(); });

async function post(body: unknown) {
  const { POST } = await import("./route");
  return POST(new Request("http://localhost/api/partner-purchase-orders", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }));
}

describe("POST /api/partner-purchase-orders", () => {
  it("400 when items are missing", async () => {
    const res = await post({ partnerId: 1, clientPurchaseOrderId: 1, startDate: "2026-06-01", endDate: "2026-06-30" });
    expect(res.status).toBe(400);
  });
});
```

Note: the create handler does multi-step inserts that are awkward to fully mock; this test covers validation. The **total/line math is already unit-tested** in Task 3, and code generation in Task 6. Broader create behavior is verified manually in Task 19.

- [ ] **Step 4: Run the test — expect PASS**

Run: `pnpm test app/app/api/partner-purchase-orders/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/app/api/partner-purchase-orders
git commit -m "feat(api): partner purchase order CRUD handlers"
```

---

## Task 9: PO attachment upload route

**Files:**
- Create: `app/app/api/uploads/po-attachment/route.ts`

- [ ] **Step 1: Implement** (mirror of `payment-attachment`, new bucket `po-attachments`)

```ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set");
  return createClient(url, key);
}

export async function POST(req: Request): Promise<Response> {
  let formData: FormData;
  try { formData = await req.formData(); } catch { return NextResponse.json({ error: "Invalid form data" }, { status: 400 }); }
  const file = formData.get("file");
  if (!file || !(file instanceof Blob)) return NextResponse.json({ error: "No file provided" }, { status: 400 });

  const originalName = file instanceof File ? file.name : "upload.bin";
  const ext = originalName.split(".").pop() ?? "bin";
  const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  try {
    const supabase = getSupabase();
    const buffer = Buffer.from(await file.arrayBuffer());
    const { error } = await supabase.storage.from("po-attachments").upload(path, buffer, { contentType: file.type });
    if (error) throw error;
    const { data: { publicUrl } } = supabase.storage.from("po-attachments").getPublicUrl(path);
    return NextResponse.json({ url: publicUrl, name: originalName });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Upload failed" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Create the Supabase bucket** (one-time, manual): in the Supabase dashboard create a **public** bucket named `po-attachments`. Document this in the PR description.

- [ ] **Step 3: Commit**

```bash
git add app/app/api/uploads/po-attachment
git commit -m "feat(api): PO attachment upload route"
```

---

## Task 10: Permissions + sidebar nav

**Files:**
- Modify: `app/scripts/seed.ts`, `app/components/layout/Sidebar.tsx`

- [ ] **Step 1: Add permissions in `seed.ts`.** Add `"View Purchase Orders", "Edit Purchase Orders"` to the **Admin** and **Manager** role arrays, and `"View Purchase Orders"` to the **Viewer** array. (Match the exact array each role uses; see lines ~9–33.)

- [ ] **Step 2: Re-seed** Run: `pnpm --filter @workspace/web db:seed` Expected: roles updated, no error.

- [ ] **Step 3: Add the sidebar item** in `Sidebar.tsx`. Add `ClipboardList` to the lucide import, then add to `topNavItems` after the partners entry:

```ts
  { href: "/purchase-orders", label: "Purchase Orders", icon: ClipboardList, permission: "View Purchase Orders" },
```

- [ ] **Step 4: Commit**

```bash
git add app/scripts/seed.ts app/components/layout/Sidebar.tsx
git commit -m "feat: purchase orders permissions + sidebar nav"
```

---

## Task 11: Purchase Orders page (tabs shell)

**Files:**
- Create: `app/app/(dashboard)/purchase-orders/page.tsx`

- [ ] **Step 1: Implement** — guarded tabs shell

```tsx
"use client";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PermissionGuard } from "@/components/PermissionGuard";
import { ClientPOTab } from "@/components/purchase-orders/ClientPOTab";
import { PartnerPOTab } from "@/components/purchase-orders/PartnerPOTab";

function PurchaseOrdersPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Purchase Orders</h1>
        <p className="text-sm text-muted-foreground">Client requests and partner orders</p>
      </div>
      <Tabs defaultValue="clients">
        <TabsList>
          <TabsTrigger value="clients" data-testid="po-tab-clients">Clients</TabsTrigger>
          <TabsTrigger value="partners" data-testid="po-tab-partners">Partners</TabsTrigger>
        </TabsList>
        <TabsContent value="clients" className="mt-4"><ClientPOTab /></TabsContent>
        <TabsContent value="partners" className="mt-4"><PartnerPOTab /></TabsContent>
      </Tabs>
    </div>
  );
}

export default function PurchaseOrdersRoute() {
  return (
    <PermissionGuard permission="View Purchase Orders">
      <PurchaseOrdersPage />
    </PermissionGuard>
  );
}
```

- [ ] **Step 2: Commit** (after Tasks 12–15 supply the imported components, or stub them first to keep the build green — recommended: create empty named-export stubs now, fill next).

```bash
git add "app/app/(dashboard)/purchase-orders/page.tsx"
git commit -m "feat: purchase orders page shell with tabs"
```

---

## Task 12: Attachment helper + Client PO tab (listing)

**Files:**
- Create: `app/lib/po-attachment.ts`, `app/components/purchase-orders/ClientPOTab.tsx`

- [ ] **Step 1: Upload helper** — `app/lib/po-attachment.ts`

```ts
export async function uploadPoAttachment(file: File): Promise<{ url: string; name: string }> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/uploads/po-attachment", { method: "POST", body: fd });
  if (!res.ok) throw new Error("Upload failed");
  return res.json();
}
```

- [ ] **Step 2: Client PO tab** — `app/components/purchase-orders/ClientPOTab.tsx`

```tsx
"use client";

import { useState } from "react";
import { Plus, Trash2, Paperclip } from "lucide-react";
import {
  useListClientPurchaseOrders, useDeleteClientPurchaseOrder, getListClientPurchaseOrdersQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useHasPermission } from "@/lib/auth/user-context";
import { CreateClientPODialog } from "./CreateClientPODialog";

function fmtDate(s: string) { return new Date(s).toLocaleDateString(); }

export function ClientPOTab() {
  const [createOpen, setCreateOpen] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();
  const canEdit = useHasPermission("Edit Purchase Orders");
  const { data: rows, isLoading } = useListClientPurchaseOrders();

  const del = useDeleteClientPurchaseOrder({
    mutation: {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getListClientPurchaseOrdersQueryKey() }); toast({ title: "Deleted" }); },
      onError: (e: unknown) => toast({ title: e instanceof Error ? e.message : "Delete failed", variant: "destructive" }),
    },
  });

  const headers = ["Sr.", "CPO ID", "Client", "Buying House", "Created", "Created By", canEdit ? "Actions" : null]
    .filter((h): h is string => h !== null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{rows?.length ?? 0} client purchase orders</p>
        {canEdit && (
          <Button size="sm" className="gap-1.5 text-xs" onClick={() => setCreateOpen(true)} data-testid="create-cpo-btn">
            <Plus className="h-3.5 w-3.5" /> Create Purchase Order
          </Button>
        )}
      </div>

      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {headers.map(h => <th key={h} className="px-5 py-3 text-left text-xs font-medium text-muted-foreground">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(3)].map((_, i) => (
                <tr key={i} className="border-b border-border">
                  {headers.map((_, j) => <td key={j} className="px-5 py-3"><Skeleton className="h-4 w-20" /></td>)}
                </tr>
              ))
            ) : (rows?.length ?? 0) === 0 ? (
              <tr><td colSpan={headers.length} className="px-5 py-10 text-center text-sm text-muted-foreground">No purchase orders yet</td></tr>
            ) : (
              rows!.map((r, i) => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/30" data-testid={`cpo-row-${r.id}`}>
                  <td className="px-5 py-3 text-sm text-muted-foreground">{i + 1}</td>
                  <td className="px-5 py-3 text-sm font-medium">{r.code}</td>
                  <td className="px-5 py-3 text-sm">{r.clientName}</td>
                  <td className="px-5 py-3 text-sm text-muted-foreground">{r.buyingHouseName ?? "—"}</td>
                  <td className="px-5 py-3 text-sm text-muted-foreground">{fmtDate(r.createdAt)}</td>
                  <td className="px-5 py-3 text-sm text-muted-foreground">{r.createdByName ?? "—"}</td>
                  {canEdit && (
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1">
                        <a href={r.attachmentUrl} target="_blank" rel="noreferrer" title="Attachment"
                           className="rounded p-1.5 text-muted-foreground hover:bg-muted"><Paperclip className="h-3.5 w-3.5" /></a>
                        <button onClick={() => del.mutate({ id: r.id })} title="Delete"
                          className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          data-testid={`delete-cpo-${r.id}`}><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <CreateClientPODialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
```

Note: this tab ships **Attachment + Delete**. The **View** (read-only detail) and **Edit** action buttons and their dialogs are added in **Task 19** (which modifies this file's imports and action cell). This is intentional incremental building.

- [ ] **Step 3: Typecheck** Run: `pnpm --filter @workspace/web typecheck` — fix any unused-import errors.

- [ ] **Step 4: Commit**

```bash
git add app/lib/po-attachment.ts "app/components/purchase-orders/ClientPOTab.tsx"
git commit -m "feat: client PO listing tab"
```

---

## Task 13: Create Client PO dialog

**Files:**
- Create: `app/components/purchase-orders/CreateClientPODialog.tsx`

- [ ] **Step 1: Implement** — client select + file upload + create

```tsx
"use client";

import { useState, useEffect } from "react";
import {
  useListClients, useCreateClientPurchaseOrder, getListClientPurchaseOrdersQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { uploadPoAttachment } from "@/lib/po-attachment";

export function CreateClientPODialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: clients } = useListClients();
  const [clientId, setClientId] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { if (open) { setClientId(""); setFile(null); } }, [open]);

  const create = useCreateClientPurchaseOrder();

  async function onSubmit() {
    if (!clientId || !file) { toast({ title: "Select a client and attach a file", variant: "destructive" }); return; }
    setSubmitting(true);
    try {
      const { url, name } = await uploadPoAttachment(file);
      await create.mutateAsync({ data: { clientId: Number(clientId), attachmentUrl: url, attachmentName: name } });
      qc.invalidateQueries({ queryKey: getListClientPurchaseOrdersQueryKey() });
      toast({ title: "Purchase order created" });
      onClose();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Create failed", variant: "destructive" });
    } finally { setSubmitting(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Create Purchase Order</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Client <span className="text-destructive">*</span></Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger data-testid="cpo-client-select"><SelectValue placeholder="Select a client" /></SelectTrigger>
              <SelectContent>
                {clients?.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Attachment (email / screenshot / PDF) <span className="text-destructive">*</span></Label>
            <Input type="file" accept="image/*,application/pdf,.eml,.msg"
              onChange={e => setFile(e.target.files?.[0] ?? null)} data-testid="cpo-file-input" />
            {file && <p className="text-xs text-muted-foreground">{file.name}</p>}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={onSubmit} disabled={submitting} data-testid="submit-cpo-btn">
              {submitting ? "Creating..." : "Create"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Typecheck** Run: `pnpm --filter @workspace/web typecheck` — PASS.

- [ ] **Step 3: Commit**

```bash
git add "app/components/purchase-orders/CreateClientPODialog.tsx"
git commit -m "feat: create client PO dialog with upload"
```

---

## Task 14: Partner PO tab (listing + expandable breakdown)

**Files:**
- Create: `app/components/purchase-orders/PartnerPOTab.tsx`

- [ ] **Step 1: Implement** — listing with a chevron-expandable item breakdown row

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, Trash2, Eye, ChevronRight, ChevronDown } from "lucide-react";
import {
  useListPartnerPurchaseOrders, useDeletePartnerPurchaseOrder, getListPartnerPurchaseOrdersQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useHasPermission } from "@/lib/auth/user-context";
import { CreatePartnerPODialog } from "./CreatePartnerPODialog";

const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (s: string) => new Date(s).toLocaleDateString();

export function PartnerPOTab() {
  const [createOpen, setCreateOpen] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const qc = useQueryClient();
  const { toast } = useToast();
  const canEdit = useHasPermission("Edit Purchase Orders");
  const { data: rows, isLoading } = useListPartnerPurchaseOrders();

  const del = useDeletePartnerPurchaseOrder({
    mutation: {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getListPartnerPurchaseOrdersQueryKey() }); toast({ title: "Deleted" }); },
      onError: () => toast({ title: "Delete failed", variant: "destructive" }),
    },
  });

  const headers = ["", "Sr.", "PPO ID", "Partner", "Buying House", "Client", "Total Budget", "Created", "Created By", canEdit ? "Actions" : null]
    .filter((h): h is string => h !== null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{rows?.length ?? 0} partner purchase orders</p>
        {canEdit && (
          <Button size="sm" className="gap-1.5 text-xs" onClick={() => setCreateOpen(true)} data-testid="create-ppo-btn">
            <Plus className="h-3.5 w-3.5" /> Create Purchase Order
          </Button>
        )}
      </div>

      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {headers.map((h, i) => <th key={i} className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(3)].map((_, i) => (
                <tr key={i} className="border-b border-border">
                  {headers.map((_, j) => <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-16" /></td>)}
                </tr>
              ))
            ) : (rows?.length ?? 0) === 0 ? (
              <tr><td colSpan={headers.length} className="px-4 py-10 text-center text-sm text-muted-foreground">No partner purchase orders yet</td></tr>
            ) : (
              rows!.map((r, i) => (
                <>
                  <tr key={r.id} className="border-b border-border hover:bg-muted/30" data-testid={`ppo-row-${r.id}`}>
                    <td className="px-4 py-3">
                      <button onClick={() => setExpanded(expanded === r.id ? null : r.id)} data-testid={`ppo-expand-${r.id}`}
                        className="rounded p-1 text-muted-foreground hover:bg-muted">
                        {expanded === r.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{i + 1}</td>
                    <td className="px-4 py-3 text-sm font-medium">{r.code}</td>
                    <td className="px-4 py-3 text-sm">{r.partnerName}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{r.buyingHouseName ?? "—"}</td>
                    <td className="px-4 py-3 text-sm">{r.clientName}</td>
                    <td className="px-4 py-3 text-sm font-semibold">{money(r.totalBudget)}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{fmtDate(r.createdAt)}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{r.createdByName ?? "—"}</td>
                    {canEdit && (
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <Link href={`/purchase-orders/ppo/${r.id}`} title="View invoice"
                            className="rounded p-1.5 text-muted-foreground hover:bg-muted" data-testid={`view-ppo-${r.id}`}>
                            <Eye className="h-3.5 w-3.5" />
                          </Link>
                          <button onClick={() => del.mutate({ id: r.id })} title="Delete"
                            className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            data-testid={`delete-ppo-${r.id}`}><Trash2 className="h-3.5 w-3.5" /></button>
                        </div>
                      </td>
                    )}
                  </tr>
                  {expanded === r.id && (
                    <tr className="border-b border-border bg-muted/20">
                      <td colSpan={headers.length} className="px-10 py-3">
                        <table className="w-full max-w-2xl">
                          <thead>
                            <tr className="text-xs text-muted-foreground">
                              <th className="py-1 text-left font-medium">Payable Event</th>
                              <th className="py-1 text-left font-medium">CAC Rate</th>
                              <th className="py-1 text-left font-medium">Event Count</th>
                              <th className="py-1 text-left font-medium">Budget</th>
                            </tr>
                          </thead>
                          <tbody>
                            {r.items.map(it => (
                              <tr key={it.id} className="text-sm">
                                <td className="py-1">{it.eventName}</td>
                                <td className="py-1">{it.cacRate}</td>
                                <td className="py-1">{it.eventCount.toLocaleString()}</td>
                                <td className="py-1">{money(it.lineBudget)}</td>
                              </tr>
                            ))}
                            <tr className="text-sm font-semibold border-t border-border">
                              <td className="py-1" colSpan={3}>Total</td>
                              <td className="py-1">{money(r.totalBudget)}</td>
                            </tr>
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </>
              ))
            )}
          </tbody>
        </table>
      </div>

      <CreatePartnerPODialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
```

Note: the `<>...</>` fragment per row needs a `key`; if React warns, refactor the map body to a small `PpoRow` component that takes `key={r.id}`. This tab ships **View (invoice) + Delete**; the **Edit** action button is added in **Task 19**.

- [ ] **Step 2: Typecheck** Run: `pnpm --filter @workspace/web typecheck` — PASS.

- [ ] **Step 3: Commit**

```bash
git add "app/components/purchase-orders/PartnerPOTab.tsx"
git commit -m "feat: partner PO listing tab with expandable breakdown"
```

---

## Task 15: Create Partner PO dialog (cascading form)

**Files:**
- Create: `app/components/purchase-orders/CreatePartnerPODialog.tsx`

- [ ] **Step 1: Implement** — partner → client (from `useListPartnerClients`) → CPO → duration → events with payout rate + counts → total

```tsx
"use client";

import { useState, useEffect, useMemo } from "react";
import {
  useListPartners, useListPartnerClients, useListClientPurchaseOrdersByClient,
  useCreatePartnerPurchaseOrder, getListPartnerPurchaseOrdersQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { lineBudget, totalBudget } from "@/lib/po-totals";

const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface DraftItem { clientEventId: number; eventName: string; cacRate: number; eventCount: number; selected: boolean; }

export function CreatePartnerPODialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: partners } = useListPartners();

  const [partnerId, setPartnerId] = useState<string>("");
  const [clientId, setClientId] = useState<string>("");
  const [cpoId, setCpoId] = useState<string>("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [items, setItems] = useState<DraftItem[]>([]);

  // Cascade sources
  const { data: partnerClients } = useListPartnerClients(partnerId ? Number(partnerId) : 0, { query: { enabled: !!partnerId } });
  const { data: cpos } = useListClientPurchaseOrdersByClient(clientId ? Number(clientId) : 0, { query: { enabled: !!clientId } });

  const selectedClient = useMemo(
    () => partnerClients?.find(pc => pc.clientId === Number(clientId)),
    [partnerClients, clientId],
  );

  useEffect(() => { if (open) { setPartnerId(""); setClientId(""); setCpoId(""); setStartDate(""); setEndDate(""); setItems([]); } }, [open]);
  useEffect(() => { setClientId(""); setCpoId(""); setItems([]); }, [partnerId]);
  useEffect(() => { setCpoId(""); }, [clientId]);

  // When a client is chosen, seed the event rows from its payable events (those with a payout rate).
  useEffect(() => {
    if (!selectedClient) { setItems([]); return; }
    const payable = (selectedClient.events ?? []).filter(e => e.payoutRate != null);
    setItems(payable.map(e => ({
      clientEventId: e.clientEventId, eventName: e.name, cacRate: Number(e.payoutRate), eventCount: 0, selected: false,
    })));
  }, [selectedClient]);

  const create = useCreatePartnerPurchaseOrder();
  const chosen = items.filter(i => i.selected && i.eventCount > 0);
  const total = totalBudget(chosen.map(i => ({ cacRate: i.cacRate, eventCount: i.eventCount })));

  function setItem(id: number, patch: Partial<DraftItem>) {
    setItems(prev => prev.map(i => i.clientEventId === id ? { ...i, ...patch } : i));
  }

  async function onSubmit() {
    if (!partnerId || !clientId || !cpoId || !startDate || !endDate) { toast({ title: "Fill partner, client, CPO and duration", variant: "destructive" }); return; }
    if (chosen.length === 0) { toast({ title: "Select at least one event with a count", variant: "destructive" }); return; }
    try {
      await create.mutateAsync({ data: {
        partnerId: Number(partnerId), clientPurchaseOrderId: Number(cpoId), startDate, endDate,
        items: chosen.map(i => ({ clientEventId: i.clientEventId, eventName: i.eventName, cacRate: i.cacRate, eventCount: i.eventCount })),
      }});
      qc.invalidateQueries({ queryKey: getListPartnerPurchaseOrdersQueryKey() });
      toast({ title: "Partner purchase order created" });
      onClose();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Create failed", variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Create Partner Purchase Order</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Partner <span className="text-destructive">*</span></Label>
              <Select value={partnerId} onValueChange={setPartnerId}>
                <SelectTrigger data-testid="ppo-partner-select"><SelectValue placeholder="Select partner" /></SelectTrigger>
                <SelectContent>{partners?.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Client <span className="text-destructive">*</span></Label>
              <Select value={clientId} onValueChange={setClientId} disabled={!partnerId}>
                <SelectTrigger data-testid="ppo-client-select"><SelectValue placeholder="Select client" /></SelectTrigger>
                <SelectContent>{partnerClients?.map(pc => <SelectItem key={pc.clientId} value={String(pc.clientId)}>{pc.clientName}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Client PO <span className="text-destructive">*</span></Label>
              <Select value={cpoId} onValueChange={setCpoId} disabled={!clientId}>
                <SelectTrigger data-testid="ppo-cpo-select"><SelectValue placeholder="Select CPO" /></SelectTrigger>
                <SelectContent>
                  {cpos?.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.code} ({new Date(c.createdAt).toLocaleDateString()})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>From <span className="text-destructive">*</span></Label>
              <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} data-testid="ppo-start" />
            </div>
            <div className="space-y-1.5">
              <Label>To <span className="text-destructive">*</span></Label>
              <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} data-testid="ppo-end" />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Events</Label>
            {items.length === 0 ? (
              <p className="text-xs text-muted-foreground">{clientId ? "This partner has no payout rates configured for this client's events." : "Select a partner and client to load events."}</p>
            ) : (
              <div className="rounded-lg border border-border divide-y">
                <div className="grid grid-cols-[auto_1fr_5rem_6rem_6rem] gap-2 px-3 py-2 text-xs font-medium text-muted-foreground">
                  <span></span><span>Event</span><span>CAC</span><span>Count</span><span className="text-right">Budget</span>
                </div>
                {items.map(it => (
                  <div key={it.clientEventId} className="grid grid-cols-[auto_1fr_5rem_6rem_6rem] items-center gap-2 px-3 py-2">
                    <Checkbox checked={it.selected} onCheckedChange={v => setItem(it.clientEventId, { selected: !!v })} data-testid={`ppo-event-${it.clientEventId}`} />
                    <span className="text-sm">{it.eventName}</span>
                    <span className="text-sm text-muted-foreground">{it.cacRate}</span>
                    <Input type="number" min={0} value={it.eventCount || ""} disabled={!it.selected}
                      onChange={e => setItem(it.clientEventId, { eventCount: Number(e.target.value) })}
                      className="h-8 text-sm" data-testid={`ppo-count-${it.clientEventId}`} />
                    <span className="text-sm text-right">{it.selected && it.eventCount > 0 ? money(lineBudget(it.cacRate, it.eventCount)) : "—"}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-border pt-3">
            <span className="text-sm font-medium">Total Budget</span>
            <span className="text-lg font-bold" data-testid="ppo-total">{money(total)}</span>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={onSubmit} disabled={create.isPending} data-testid="submit-ppo-btn">
              {create.isPending ? "Creating..." : "Create"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

Note: Confirm the orval hook signature for parameterized queries — existing pages call e.g. `useGetAnalyticsByPartner()`; for path-param hooks the generated signature is typically `useListPartnerClients(id, options?)`. If the generated `enabled`-gating option shape differs, match whatever `partners/[id]` detail pages already use.

- [ ] **Step 2: Typecheck** Run: `pnpm --filter @workspace/web typecheck` — PASS. Fix hook-signature mismatches against the generated client.

- [ ] **Step 3: Commit**

```bash
git add "app/components/purchase-orders/CreatePartnerPODialog.tsx"
git commit -m "feat: create partner PO dialog with cascading event pricing"
```

---

## Task 16: PDF download helper

**Files:**
- Modify: `app/package.json`
- Create: `app/lib/po-pdf.ts`

- [ ] **Step 1: Add `html2canvas` as a direct dependency.** In `app/package.json` `dependencies`, add `"html2canvas": "1.4.1"` (already resolved in the lockfile, so no new download). Run `pnpm install`.

- [ ] **Step 2: Implement** — `app/lib/po-pdf.ts`

```ts
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

export async function downloadInvoicePdf(node: HTMLElement, filename: string): Promise<void> {
  const canvas = await html2canvas(node, { scale: 2, backgroundColor: "#ffffff", useCORS: true });
  const img = canvas.toDataURL("image/png");
  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const imgW = pageW;
  const imgH = (canvas.height * imgW) / canvas.width;

  let heightLeft = imgH;
  let position = 0;
  pdf.addImage(img, "PNG", 0, position, imgW, imgH);
  heightLeft -= pageH;
  while (heightLeft > 0) {
    position -= pageH;
    pdf.addPage();
    pdf.addImage(img, "PNG", 0, position, imgW, imgH);
    heightLeft -= pageH;
  }
  pdf.save(filename);
}
```

- [ ] **Step 3: Typecheck** Run: `pnpm --filter @workspace/web typecheck` — PASS.

- [ ] **Step 4: Commit**

```bash
git add app/package.json pnpm-lock.yaml app/lib/po-pdf.ts
git commit -m "feat: invoice PDF download helper (html2canvas + jsPDF)"
```

---

## Task 17: Partner invoice component

**Files:**
- Create: `app/components/purchase-orders/PartnerInvoice.tsx`, `app/public/advengers-logo.png` (placeholder asset)

- [ ] **Step 1: Add a placeholder logo.** Drop any PNG at `app/public/advengers-logo.png` (replace with the real Advengers logo when provided).

- [ ] **Step 2: Implement** — `app/components/purchase-orders/PartnerInvoice.tsx`. Accepts the `GetPartnerPurchaseOrderResponse` shape. The `ref` is forwarded so the page can capture it for PDF.

```tsx
"use client";

import { forwardRef } from "react";
import type { PartnerPurchaseOrder } from "@workspace/api-client-react";

const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmt = (s: string) => new Date(s).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

const CLAUSE = "[Clause text to be provided by Advengers.]"; // TODO: replace with final clause when supplied.

export const PartnerInvoice = forwardRef<HTMLDivElement, { po: PartnerPurchaseOrder }>(function PartnerInvoice({ po }, ref) {
  const p = po.partner;
  const duration = `${fmt(po.startDate)} – ${fmt(po.endDate)}`;
  return (
    <div ref={ref} className="mx-auto w-[800px] bg-white p-12 text-[#1f2937]" data-testid="invoice-doc">
      {/* Header */}
      <div className="flex items-start justify-between border-b-2 border-[#2f4a8b] pb-6">
        <img src="/advengers-logo.png" alt="Advengers" className="h-12 object-contain" />
        <div className="text-right">
          <h2 className="text-2xl font-bold tracking-wide text-[#2f4a8b]">PURCHASE ORDER</h2>
          <p className="mt-1 text-sm">Invoice No: <span className="font-semibold">{po.code}</span></p>
          <p className="text-sm">Date: {fmt(po.createdAt)}</p>
        </div>
      </div>

      {/* Vendor (partner KYC) */}
      <div className="mt-6">
        <div className="bg-[#2f4a8b] px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white">Vendor</div>
        <div className="mt-2 grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
          <div><span className="text-gray-500">Name:</span> {p?.name ?? "—"}</div>
          <div><span className="text-gray-500">POC:</span> {p?.pocName ?? "—"}</div>
          <div><span className="text-gray-500">Address:</span> {p?.address ?? "—"}</div>
          <div><span className="text-gray-500">Phone:</span> {p?.pocNumber ?? p?.companyNumber ?? "—"}</div>
          <div><span className="text-gray-500">Email:</span> {p?.pocEmail ?? p?.companyEmail ?? "—"}</div>
          <div><span className="text-gray-500">NTN / STN:</span> {p?.ntnNumber ?? "—"} / {p?.salesTaxNumber ?? "—"}</div>
        </div>
      </div>

      {/* Line items */}
      <table className="mt-6 w-full border-collapse text-sm">
        <thead>
          <tr className="bg-[#2f4a8b] text-white">
            {["Client", "Agency", "Duration", "Payable Event", "CAC Rate", "Event Count", "Budget"].map(h => (
              <th key={h} className="border border-[#2f4a8b] px-3 py-2 text-left font-semibold">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {po.items.map(it => (
            <tr key={it.id}>
              <td className="border border-gray-300 px-3 py-2">{po.clientName}</td>
              <td className="border border-gray-300 px-3 py-2">{po.buyingHouseName ?? "—"}</td>
              <td className="border border-gray-300 px-3 py-2">{duration}</td>
              <td className="border border-gray-300 px-3 py-2">{it.eventName}</td>
              <td className="border border-gray-300 px-3 py-2">{it.cacRate}</td>
              <td className="border border-gray-300 px-3 py-2">{it.eventCount.toLocaleString()}</td>
              <td className="border border-gray-300 px-3 py-2">{money(it.lineBudget)}</td>
            </tr>
          ))}
          <tr className="font-bold">
            <td className="border border-gray-300 px-3 py-2 text-right" colSpan={6}>TOTAL</td>
            <td className="border border-gray-300 px-3 py-2">{money(po.totalBudget)}</td>
          </tr>
        </tbody>
      </table>

      {/* Clause + computer-generated note */}
      <div className="mt-6 space-y-3 text-xs text-gray-600">
        <p>{CLAUSE}</p>
        <p className="font-medium">This is a computer-generated document and does not require a signature or stamp.</p>
      </div>

      {/* Footer — Advengers details */}
      <div className="mt-10 border-t border-gray-300 pt-4 text-center text-xs text-gray-500">
        <p className="font-semibold text-[#2f4a8b]">Advengers</p>
        <p>Office #2, 1st Floor, Building #87-C, 11th Commercial Street, Phase II Extension, DHA, Karachi, 74700</p>
        <p>www.advengers.com.pk</p>
      </div>
    </div>
  );
});
```

Note: import the type from `@workspace/api-client-react` (same package the invoice page's `useGetPartnerPurchaseOrder` data comes from, so date fields are typed as `string` and assignable). If the exact name differs, check `lib/api-client-react/src/generated/api.schemas.ts` and use the matching export (e.g., `GetPartnerPurchaseOrderResponse`).

- [ ] **Step 3: Typecheck** Run: `pnpm --filter @workspace/web typecheck` — PASS.

- [ ] **Step 4: Commit**

```bash
git add "app/components/purchase-orders/PartnerInvoice.tsx" app/public/advengers-logo.png
git commit -m "feat: partner invoice document component"
```

---

## Task 18: Invoice view route + Download PDF

**Files:**
- Create: `app/app/(dashboard)/purchase-orders/ppo/[id]/page.tsx`

- [ ] **Step 1: Implement** — fetch the PPO, render the invoice, wire Download + Back

```tsx
"use client";

import { use, useRef } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { useGetPartnerPurchaseOrder } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PermissionGuard } from "@/components/PermissionGuard";
import { PartnerInvoice } from "@/components/purchase-orders/PartnerInvoice";
import { downloadInvoicePdf } from "@/lib/po-pdf";

function InvoicePage({ id }: { id: number }) {
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const { data: po, isLoading } = useGetPartnerPurchaseOrder(id);

  async function onDownload() {
    if (ref.current && po) await downloadInvoicePdf(ref.current, `${po.code}.pdf`);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => router.back()} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <Button size="sm" onClick={onDownload} disabled={!po} className="gap-1.5" data-testid="download-invoice-btn">
          <Download className="h-4 w-4" /> Download PDF
        </Button>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-border bg-muted/30 p-6">
        {isLoading || !po ? <Skeleton className="mx-auto h-[600px] w-[800px]" /> : <PartnerInvoice ref={ref} po={po} />}
      </div>
    </div>
  );
}

export default function InvoiceRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <PermissionGuard permission="View Purchase Orders">
      <InvoicePage id={Number(id)} />
    </PermissionGuard>
  );
}
```

- [ ] **Step 2: Typecheck** Run: `pnpm --filter @workspace/web typecheck` — PASS.

- [ ] **Step 3: Commit**

```bash
git add "app/app/(dashboard)/purchase-orders/ppo"
git commit -m "feat: partner invoice view route with PDF download"
```

---

## Task 19: View & Edit actions (CPO detail/edit + PPO edit)

Covers the spec's `View` + `Edit` actions on both tabs (PPO `View` is already the invoice route from Task 18).

**Files:**
- Create: `app/components/purchase-orders/ClientPODetailDialog.tsx`
- Modify: `app/components/purchase-orders/ClientPOTab.tsx`, `app/components/purchase-orders/CreatePartnerPODialog.tsx`, `app/components/purchase-orders/PartnerPOTab.tsx`

- [ ] **Step 1: Create `ClientPODetailDialog.tsx`** — read-only by default; an Edit toggle enables changing the client and replacing the attachment (calls `updateClientPurchaseOrder`).

```tsx
"use client";

import { useState, useEffect } from "react";
import {
  useListClients, useUpdateClientPurchaseOrder, getListClientPurchaseOrdersQueryKey,
  type ClientPurchaseOrder,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { uploadPoAttachment } from "@/lib/po-attachment";

export function ClientPODetailDialog({ po, startInEdit, onClose }: {
  po: ClientPurchaseOrder | null; startInEdit: boolean; onClose: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: clients } = useListClients();
  const [editing, setEditing] = useState(startInEdit);
  const [clientId, setClientId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (po) { setEditing(startInEdit); setClientId(String(po.clientId)); setFile(null); }
  }, [po, startInEdit]);

  const update = useUpdateClientPurchaseOrder();

  async function onSave() {
    if (!po) return;
    setSubmitting(true);
    try {
      const attach = file ? await uploadPoAttachment(file) : null;
      await update.mutateAsync({ id: po.id, data: {
        clientId: Number(clientId),
        ...(attach ? { attachmentUrl: attach.url, attachmentName: attach.name } : {}),
      }});
      qc.invalidateQueries({ queryKey: getListClientPurchaseOrdersQueryKey() });
      toast({ title: "Purchase order updated" });
      onClose();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Update failed", variant: "destructive" });
    } finally { setSubmitting(false); }
  }

  return (
    <Dialog open={!!po} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{po?.code}{editing ? " — Edit" : ""}</DialogTitle></DialogHeader>
        {po && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Client</Label>
              {editing ? (
                <Select value={clientId} onValueChange={setClientId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{clients?.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              ) : <p className="text-sm">{po.clientName}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-muted-foreground">Buying House</span><p>{po.buyingHouseName ?? "—"}</p></div>
              <div><span className="text-muted-foreground">Created By</span><p>{po.createdByName ?? "—"}</p></div>
            </div>
            <div className="space-y-1.5">
              <Label>Attachment</Label>
              {editing ? (
                <>
                  <Input type="file" accept="image/*,application/pdf,.eml,.msg" onChange={e => setFile(e.target.files?.[0] ?? null)} />
                  <p className="text-xs text-muted-foreground">{file ? file.name : `Current: ${po.attachmentName ?? "file"} (leave empty to keep)`}</p>
                </>
              ) : (
                <a href={po.attachmentUrl} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline">
                  {po.attachmentName ?? "Open attachment"}
                </a>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={onClose}>Close</Button>
              {editing
                ? <Button onClick={onSave} disabled={submitting}>{submitting ? "Saving..." : "Save"}</Button>
                : <Button onClick={() => setEditing(true)}>Edit</Button>}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Wire View + Edit into `ClientPOTab.tsx`.** (a) Change the lucide import to `import { Plus, Trash2, Paperclip, Eye, Pencil } from "lucide-react";`; (b) add `type ClientPurchaseOrder` to the `@workspace/api-client-react` import and `import { ClientPODetailDialog } from "./ClientPODetailDialog";`; (c) add state `const [detail, setDetail] = useState<{ po: ClientPurchaseOrder; edit: boolean } | null>(null);`; (d) **replace** the action-cell `<div className="flex items-center gap-1">…</div>` with:

```tsx
<div className="flex items-center gap-1">
  <button onClick={() => setDetail({ po: r, edit: false })} title="View"
    className="rounded p-1.5 text-muted-foreground hover:bg-muted" data-testid={`view-cpo-${r.id}`}><Eye className="h-3.5 w-3.5" /></button>
  <button onClick={() => setDetail({ po: r, edit: true })} title="Edit"
    className="rounded p-1.5 text-muted-foreground hover:bg-muted" data-testid={`edit-cpo-${r.id}`}><Pencil className="h-3.5 w-3.5" /></button>
  <a href={r.attachmentUrl} target="_blank" rel="noreferrer" title="Attachment"
     className="rounded p-1.5 text-muted-foreground hover:bg-muted"><Paperclip className="h-3.5 w-3.5" /></a>
  <button onClick={() => del.mutate({ id: r.id })} title="Delete"
    className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
    data-testid={`delete-cpo-${r.id}`}><Trash2 className="h-3.5 w-3.5" /></button>
</div>
```

(e) mount the dialog after `<CreateClientPODialog … />`:

```tsx
<ClientPODetailDialog po={detail?.po ?? null} startInEdit={detail?.edit ?? false} onClose={() => setDetail(null)} />
```

- [ ] **Step 3: Add edit mode to `CreatePartnerPODialog.tsx`.** (a) Import `useUpdatePartnerPurchaseOrder` and `type PartnerPurchaseOrder` from `@workspace/api-client-react`; (b) change the signature to `({ open, onClose, editPo }: { open: boolean; onClose: () => void; editPo?: PartnerPurchaseOrder | null })`; (c) add `const update = useUpdatePartnerPurchaseOrder();`; (d) **replace** the open-reset effect with the prefill-aware version, and add the saved-counts effect:

```tsx
useEffect(() => {
  if (!open) return;
  if (editPo) {
    setPartnerId(String(editPo.partnerId));
    setClientId(String(editPo.clientId));
    setCpoId(String(editPo.clientPurchaseOrderId));
    setStartDate(editPo.startDate); setEndDate(editPo.endDate);
  } else {
    setPartnerId(""); setClientId(""); setCpoId(""); setStartDate(""); setEndDate(""); setItems([]);
  }
}, [open, editPo]);

// In edit mode, after items seed from payable events, apply saved selections + counts.
useEffect(() => {
  if (!editPo || items.length === 0) return;
  setItems(prev => prev.map(i => {
    const saved = editPo.items.find(s => s.clientEventId === i.clientEventId);
    return saved ? { ...i, selected: true, eventCount: saved.eventCount } : i;
  }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [editPo, selectedClient]);
```

(e) disable the basis selects in edit mode: add `disabled={!!editPo}` to the Partner, Client, and CPO `<Select>` (combine with the existing `disabled` where present, e.g. `disabled={!!editPo || !partnerId}`); (f) replace the submit body's create call with a branch:

```tsx
const payload = { startDate, endDate, items: chosen.map(i => ({ clientEventId: i.clientEventId, eventName: i.eventName, cacRate: i.cacRate, eventCount: i.eventCount })) };
if (editPo) {
  await update.mutateAsync({ id: editPo.id, data: payload });
} else {
  await create.mutateAsync({ data: { partnerId: Number(partnerId), clientPurchaseOrderId: Number(cpoId), ...payload } });
}
```

(g) **Important:** guard the two cascade-reset effects so they don't wipe the prefilled values in edit mode. Add `if (editPo) return;` as the first line of both the `[partnerId]` effect and the `[clientId]` effect. (Safe because Partner/Client/CPO selects are disabled in edit mode, so no cascade reset is ever needed there.)

- [ ] **Step 4: Wire Edit into `PartnerPOTab.tsx`.** (a) Add `Pencil` to the lucide import and `type PartnerPurchaseOrder` to the api-client-react import; (b) add state `const [editPo, setEditPo] = useState<PartnerPurchaseOrder | null>(null);`; (c) add an Edit button before Delete in the actions cell:

```tsx
<button onClick={() => setEditPo(r)} title="Edit"
  className="rounded p-1.5 text-muted-foreground hover:bg-muted" data-testid={`edit-ppo-${r.id}`}><Pencil className="h-3.5 w-3.5" /></button>
```

(d) mount an edit instance alongside the create dialog:

```tsx
<CreatePartnerPODialog open={!!editPo} editPo={editPo} onClose={() => setEditPo(null)} />
```

- [ ] **Step 5: Typecheck** Run: `pnpm --filter @workspace/web typecheck` — PASS. (If `ClientPurchaseOrder`/`PartnerPurchaseOrder` aren't exported from `@workspace/api-client-react`, import them from its `api.schemas` entry — check `lib/api-client-react/src/index.ts`.)

- [ ] **Step 6: Commit**

```bash
git add app/components/purchase-orders
git commit -m "feat: view + edit actions for client and partner POs"
```

---

## Task 20: Full verification + manual QA

**Files:** none (verification)

- [ ] **Step 1: Typecheck the whole workspace** Run: `pnpm run typecheck` Expected: PASS.

- [ ] **Step 2: Run all tests** Run (from `app/`): `pnpm test` Expected: all PASS (including the new po-codes, po-totals, client-purchase-orders, partner-purchase-orders tests).

- [ ] **Step 3: Build** Run: `pnpm --filter @workspace/web build` Expected: build succeeds, `/purchase-orders` and `/purchase-orders/ppo/[id]` routes compiled.

- [ ] **Step 4: Manual QA checklist** (run `pnpm --filter @workspace/web dev`, log in as admin):
  - Sidebar shows **Purchase Orders**; hidden for a role without `View Purchase Orders`.
  - **Clients tab:** create a CPO (pick client + upload a file) → row appears with a `CPO-YYYY-####` code, correct client + buying house, your name in Created By; Attachment opens the file; Delete removes it.
  - **Partners tab:** click **Create** → pick partner → client list narrows to that partner's clients → pick a CPO → set dates → events appear with their **payout** CAC rates → tick events, enter counts → per-row budget and **Total** compute live (e.g., `0.80 × 1000 = $800`) → Create → row appears with correct Total; chevron expands the event breakdown.
  - Try to **delete that CPO** from the Clients tab → blocked with "Remove linked Partner POs first" (409).
  - **CPO View** opens a read-only detail; **CPO Edit** lets you change the client / replace the attachment and saves; the row reflects the change.
  - **PPO Edit** opens the dialog with Partner/Client/CPO locked, duration + event counts prefilled and editable; saving updates the Total and the expanded breakdown.
  - **View** a PPO → invoice renders (Advengers header, vendor KYC, Client/Agency/Duration/Event/CAC/Count/Budget table, total, clause placeholder, computer-generated note, footer) → **Download PDF** saves `PPO-YYYY-####.pdf`.

- [ ] **Step 5: Final commit** (if any fixes were needed during QA)

```bash
git add -A
git commit -m "fix: purchase orders QA polish"
```

---

## Outstanding (from user, non-blocking)

- Replace `app/public/advengers-logo.png` with the real Advengers logo.
- Replace the `CLAUSE` placeholder in `PartnerInvoice.tsx` with final legal text.
- Create the `po-attachments` Supabase storage bucket (public) before testing uploads.
