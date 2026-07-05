# Billing Summary & Billing Detail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Financials *Transactions* and old *Billings* pages with a PO/event-based billing model surfaced as two pages — **Billing Summary** and **Billing Detail** — plus global **Tax Settings**, a client **Bulk Discount %**, per-billing invoice generation, and **Payments** repointed onto the new billings.

**Architecture:** DB-first, following the monorepo flow: Drizzle schema (`lib/db/src/schema`) → push to DB (`drizzle-kit push`) → OpenAPI (`lib/api-spec/openapi.yaml`) → orval codegen (`lib/api-zod` + `lib/api-client-react`) → Next.js route handlers (`app/app/api`) → App Router pages (`app/app/(dashboard)`). A single pure util `app/lib/compute-billing.ts` holds all billing math (server + client), mirroring the existing `app/lib/compute-row.ts`.

**Tech Stack:** PostgreSQL + Drizzle ORM, Next.js 15 App Router, OpenAPI 3.1 + orval, React Query, react-hook-form + zod, shadcn/ui, vitest, html2canvas + jsPDF.

**Spec:** `docs/superpowers/specs/2026-07-05-billing-summary-detail-design.md`

---

## File Structure

**New — DB schema** (`lib/db/src/schema/`)
- `tax-settings.ts` — single global-row table (Remittance/Sales/WHT %).
- `billings.ts` — billing header (one per Client PO), with snapshotted tax rates + status + invoice code.
- `billing-lines.ts` — one row per partner within a billing.
- `billing-event-items.ts` — one row per event within a partner line (snapshot of rates + count).
- `payment-billings.ts` — payment↔billing allocation join.

**New — API** (`app/app/api/`)
- `tax-settings/route.ts` — GET + PUT the single settings row.
- `billings/route.ts` — GET list, POST create.
- `billings/[id]/route.ts` — GET detail, PATCH, DELETE.
- `billings/[id]/status/route.ts` — PATCH status.
- `billings/[id]/invoice/route.ts` — POST generate invoice code.

**New — pages/components** (`app/`)
- `lib/compute-billing.ts` — pure billing math (server + client).
- `app/(dashboard)/billings/summary/page.tsx` — Billing Summary.
- `app/(dashboard)/billings/detail/page.tsx` — Billing Detail.
- `app/(dashboard)/billings/[id]/invoice/page.tsx` — invoice view.
- `components/billings/CreateBillingDialog.tsx` — create/edit dialog.
- `components/billings/BillingRows.tsx` — shared expandable row renderer (summary + detail columns).
- `components/billings/StatusSelect.tsx` — status dropdown.
- `components/billings/BillingInvoice.tsx` — print-ready invoice document.

**Changed**
- `lib/db/src/schema/{clients,payments,index}.ts` — client BD add + tax-field drop; payments `paymentDate`; index exports.
- `lib/api-spec/openapi.yaml` — new tags/paths/schemas (+ regen).
- `app/app/api/clients/**` — BD field; drop tax fields.
- `app/app/api/payments/**` — allocate against billings.
- `app/app/api/clients/[id]/purchase-orders/route.ts` — `period` filter.
- `app/app/api/partner-purchase-orders/route.ts` — `clientPurchaseOrderId` filter.
- `app/app/(dashboard)/payments/page.tsx` — settle billings + date received.
- `app/app/(dashboard)/settings/page.tsx` — Tax Settings card.
- `app/app/(dashboard)/clients/page.tsx` — BD field, drop tax fields.
- `app/components/layout/Sidebar.tsx` — remove Transactions; add Billing Summary + Billing Detail.
- `app/scripts/seed.ts` — permissions + seed a `tax_settings` row.

---

## Task 1: DB schemas

**Files:**
- Create: `lib/db/src/schema/tax-settings.ts`, `billings.ts`, `billing-lines.ts`, `billing-event-items.ts`, `payment-billings.ts`
- Modify: `lib/db/src/schema/clients.ts`, `lib/db/src/schema/payments.ts`, `lib/db/src/schema/index.ts`

- [ ] **Step 1: Create `lib/db/src/schema/tax-settings.ts`**

```typescript
import { pgTable, serial, numeric, timestamp } from "drizzle-orm/pg-core";

// Global tax configuration. The app maintains exactly one row (id = 1).
export const taxSettingsTable = pgTable("tax_settings", {
  id: serial("id").primaryKey(),
  remittanceTaxPct: numeric("remittance_tax_pct", { precision: 6, scale: 2 }).notNull(),
  salesTaxPct: numeric("sales_tax_pct", { precision: 6, scale: 2 }).notNull(),
  withholdingTaxPct: numeric("withholding_tax_pct", { precision: 6, scale: 2 }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type TaxSettings = typeof taxSettingsTable.$inferSelect;
```

- [ ] **Step 2: Create `lib/db/src/schema/billings.ts`**

```typescript
import { pgTable, serial, integer, text, numeric, boolean, timestamp } from "drizzle-orm/pg-core";
import { clientsTable } from "./clients";
import { clientPurchaseOrdersTable } from "./client-purchase-orders";
import { usersTable } from "./auth";

export const billingsTable = pgTable("billings", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "restrict" }),
  clientPurchaseOrderId: integer("client_purchase_order_id").notNull()
    .references(() => clientPurchaseOrdersTable.id, { onDelete: "restrict" }),
  period: text("period").notNull(), // YYYY-MM, from the CPO
  forexSellingRate: numeric("forex_selling_rate", { precision: 10, scale: 4 }).notNull(),
  forexBuyingRate: numeric("forex_buying_rate", { precision: 10, scale: 4 }).notNull(),
  bulkDiscountPct: numeric("bulk_discount_pct", { precision: 6, scale: 2 }).notNull(),
  whtApplied: boolean("wht_applied").notNull().default(false),
  // Snapshot of global tax rates at creation time
  remittanceTaxPct: numeric("remittance_tax_pct", { precision: 6, scale: 2 }).notNull(),
  salesTaxPct: numeric("sales_tax_pct", { precision: 6, scale: 2 }).notNull(),
  withholdingTaxPct: numeric("withholding_tax_pct", { precision: 6, scale: 2 }).notNull(),
  status: text("status").notNull().default("pending"), // pending | approved | dispute
  invoiceCode: text("invoice_code").unique(),
  invoiceGeneratedAt: timestamp("invoice_generated_at", { withTimezone: true }),
  notes: text("notes"),
  createdById: integer("created_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type Billing = typeof billingsTable.$inferSelect;
```

- [ ] **Step 3: Create `lib/db/src/schema/billing-lines.ts`**

```typescript
import { pgTable, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { billingsTable } from "./billings";
import { partnersTable } from "./partners";
import { partnerPurchaseOrdersTable } from "./partner-purchase-orders";

export const billingLinesTable = pgTable("billing_lines", {
  id: serial("id").primaryKey(),
  billingId: integer("billing_id").notNull().references(() => billingsTable.id, { onDelete: "cascade" }),
  partnerId: integer("partner_id").notNull().references(() => partnersTable.id, { onDelete: "restrict" }),
  partnerPurchaseOrderId: integer("partner_purchase_order_id")
    .references(() => partnerPurchaseOrdersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BillingLine = typeof billingLinesTable.$inferSelect;
```

- [ ] **Step 4: Create `lib/db/src/schema/billing-event-items.ts`**

```typescript
import { pgTable, serial, integer, text, numeric } from "drizzle-orm/pg-core";
import { billingLinesTable } from "./billing-lines";
import { clientEventsTable } from "./client-events";

export const billingEventItemsTable = pgTable("billing_event_items", {
  id: serial("id").primaryKey(),
  billingLineId: integer("billing_line_id").notNull().references(() => billingLinesTable.id, { onDelete: "cascade" }),
  clientEventId: integer("client_event_id").notNull().references(() => clientEventsTable.id, { onDelete: "restrict" }),
  eventName: text("event_name").notNull(),                              // snapshot
  billableRate: numeric("billable_rate", { precision: 12, scale: 4 }).notNull(), // snapshot (client)
  payoutRate: numeric("payout_rate", { precision: 12, scale: 4 }).notNull(),     // snapshot (partner)
  eventCount: integer("event_count").notNull(),
});

export type BillingEventItem = typeof billingEventItemsTable.$inferSelect;
```

- [ ] **Step 5: Create `lib/db/src/schema/payment-billings.ts`**

```typescript
import { pgTable, serial, integer, numeric, unique } from "drizzle-orm/pg-core";
import { paymentsTable } from "./payments";
import { billingsTable } from "./billings";

export const paymentBillingsTable = pgTable("payment_billings", {
  id: serial("id").primaryKey(),
  paymentId: integer("payment_id").notNull().references(() => paymentsTable.id, { onDelete: "cascade" }),
  billingId: integer("billing_id").notNull().references(() => billingsTable.id, { onDelete: "cascade" }),
  amountApplied: numeric("amount_applied", { precision: 14, scale: 2 }).notNull(),
}, (t) => ({ uniqPaymentBilling: unique().on(t.paymentId, t.billingId) }));

export type PaymentBilling = typeof paymentBillingsTable.$inferSelect;
```

- [ ] **Step 6: Modify `lib/db/src/schema/clients.ts`** — add `bulkDiscountPct`; remove the two tax fields.

Replace the two lines:
```typescript
  salesTaxPct: numeric("sales_tax_pct", { precision: 6, scale: 2 }),
  withholdingTaxPct: numeric("withholding_tax_pct", { precision: 6, scale: 2 }),
```
with:
```typescript
  bulkDiscountPct: numeric("bulk_discount_pct", { precision: 6, scale: 2 }),
```

- [ ] **Step 7: Modify `lib/db/src/schema/payments.ts`** — add a `paymentDate` column.

Read the file. Add `import { ..., date } from "drizzle-orm/pg-core"` to the existing import, and add this column inside `pgTable("payments", { ... })` (after `mode`):
```typescript
  paymentDate: date("payment_date"),
```

- [ ] **Step 8: Update `lib/db/src/schema/index.ts`** — add the new exports at the end:

```typescript
export * from "./tax-settings";
export * from "./billings";
export * from "./billing-lines";
export * from "./billing-event-items";
export * from "./payment-billings";
```

- [ ] **Step 9: Typecheck the db package**

Run: `pnpm --filter @workspace/db exec tsc --noEmit -p tsconfig.json` (or `pnpm -w run typecheck:libs`)
Expected: no errors. Fix any import typos.

- [ ] **Step 10: Commit**

```bash
git add lib/db/src/schema/
git commit -m "feat(db): add billing, tax-settings, payment-billings schemas; client BD; payment date"
```

---

## Task 2: Push schema to DB + seed

**Files:** Modify `app/scripts/seed.ts`

- [ ] **Step 1: Push the schema** (dev DB, no production data — destructive push is acceptable)

Run: `pnpm --filter @workspace/db push`
If it prompts about dropping `clients.sales_tax_pct` / `clients.withholding_tax_pct` and creating the new tables, accept. If it refuses non-interactively, run `pnpm --filter @workspace/db push-force`.
Expected: "Changes applied".

- [ ] **Step 2: Seed a `tax_settings` row + add permissions** — READ `app/scripts/seed.ts` first.

Add near the other seed inserts a single tax-settings upsert:
```typescript
import { taxSettingsTable } from "@workspace/db";
// ...
const existingTax = await db.select().from(taxSettingsTable).limit(1);
if (existingTax.length === 0) {
  await db.insert(taxSettingsTable).values({
    remittanceTaxPct: "15", salesTaxPct: "15", withholdingTaxPct: "7",
  });
}
```

In the same file, find the role→permissions arrays. Add `"View Billing Detail"` to every role array that already contains `"View Billings"` (so Admin/Manager/Viewer keep parity). Admin/Manager already have `"Edit Billings"`; leave Viewer without it.

- [ ] **Step 3: Run the seed**

Run: `cd app && pnpm db:seed`
Expected: completes without error; a `tax_settings` row exists.

- [ ] **Step 4: Commit**

```bash
git add app/scripts/seed.ts
git commit -m "feat(seed): tax_settings default row + View Billing Detail permission"
```

---

## Task 3: `compute-billing.ts` (pure math, TDD)

**Files:**
- Create: `app/lib/compute-billing.ts`
- Test: `app/lib/compute-billing.test.ts`

- [ ] **Step 1: Write the failing test** — `app/lib/compute-billing.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { computeBilling, whtGrossUpRate } from "./compute-billing";

describe("computeBilling — sample invoice, WHT off", () => {
  const r = computeBilling({
    events: [
      { eventCount: 1000, billableRate: 1.12, payoutRate: 0.90 },
      { eventCount: 1000, billableRate: 0.40, payoutRate: 0.32 },
    ],
    forexSellingRate: 280, forexBuyingRate: 295,
    remittanceTaxPct: 15, salesTaxPct: 15, withholdingTaxPct: 7,
    bulkDiscountPct: 20, whtApplied: false,
  });
  it("net totals", () => {
    expect(r.netTotalUsd).toBeCloseTo(1520, 2);
    expect(r.netTotalPkr).toBeCloseTo(425600, 2);
  });
  it("gross, sales tax, invoice", () => {
    expect(r.grossTotalPkr).toBeCloseTo(500705.88, 1);
    expect(r.salesTax).toBeCloseTo(75105.88, 1);
    expect(r.totalInvoice).toBeCloseTo(575811.76, 1);
  });
  it("deductions + net receivable", () => {
    expect(r.lessWht).toBeCloseTo(40306.82, 1);
    expect(r.lessSst).toBeCloseTo(75105.88, 1);
    expect(r.lessBd).toBeCloseTo(100141.18, 1);
    expect(r.netReceivable).toBeCloseTo(360257.88, 1);
  });
  it("payable + margin", () => {
    expect(r.netPayableUsd).toBeCloseTo(1220, 2);
    expect(r.netPayablePkr).toBeCloseTo(359900, 2);
    expect(r.netMargin).toBeCloseTo(357.88, 1);
  });
});

describe("whtGrossUpRate", () => {
  it("= ((1+ST)*WHT)/(1-((1+ST)*WHT))", () => {
    expect(whtGrossUpRate(15, 7)).toBeCloseTo(0.087548, 5);
  });
});

describe("computeBilling — WHT on grosses up the invoice", () => {
  const base = {
    events: [{ eventCount: 1000, billableRate: 1.12, payoutRate: 0.9 }],
    forexSellingRate: 280, forexBuyingRate: 295,
    remittanceTaxPct: 15, salesTaxPct: 15, withholdingTaxPct: 7, bulkDiscountPct: 20,
  };
  it("total invoice is higher when whtApplied", () => {
    const off = computeBilling({ ...base, whtApplied: false });
    const on = computeBilling({ ...base, whtApplied: true });
    expect(on.totalInvoice).toBeGreaterThan(off.totalInvoice);
    expect(on.grossTotalPkr).toBeCloseTo(off.grossTotalPkr * (1 + whtGrossUpRate(15, 7)), 4);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `cd app && pnpm vitest run lib/compute-billing.test.ts`
Expected: FAIL — cannot find module `./compute-billing`.

- [ ] **Step 3: Implement `app/lib/compute-billing.ts`**

```typescript
// Single source of truth for billing math (server + client), mirroring
// the pattern of compute-row.ts. All *Pct inputs are percentages (15 = 15%).

export interface BillingEventInput {
  eventCount: number;
  billableRate: number; // client rate, USD
  payoutRate: number;   // partner rate, USD
}

export interface ComputeBillingInput {
  events: BillingEventInput[];
  forexSellingRate: number;
  forexBuyingRate: number;
  remittanceTaxPct: number;
  salesTaxPct: number;
  withholdingTaxPct: number;
  bulkDiscountPct: number;
  whtApplied: boolean;
}

export interface ComputeBillingResult {
  netTotalUsd: number;
  netTotalPkr: number;
  grossTotalPkr: number;
  salesTax: number;
  totalInvoice: number;
  lessWht: number;
  lessSst: number;
  lessBd: number;
  netReceivable: number;
  netPayableUsd: number;
  netPayablePkr: number;
  netMargin: number;
}

/** g = ((1+ST)·WHT) / (1 − (1+ST)·WHT), where ST and WHT are fractions. */
export function whtGrossUpRate(salesTaxPct: number, withholdingTaxPct: number): number {
  const k = (1 + salesTaxPct / 100) * (withholdingTaxPct / 100);
  return k / (1 - k);
}

export function computeBilling(input: ComputeBillingInput): ComputeBillingResult {
  const {
    events, forexSellingRate, forexBuyingRate,
    remittanceTaxPct, salesTaxPct, withholdingTaxPct, bulkDiscountPct, whtApplied,
  } = input;

  const netTotalUsd = events.reduce((s, e) => s + e.eventCount * e.billableRate, 0);
  const netTotalPkr = netTotalUsd * forexSellingRate;

  let grossTotalPkr = netTotalPkr / (1 - remittanceTaxPct / 100);
  if (whtApplied) grossTotalPkr *= 1 + whtGrossUpRate(salesTaxPct, withholdingTaxPct);

  const salesTax = grossTotalPkr * (salesTaxPct / 100);
  const totalInvoice = grossTotalPkr + salesTax;

  const lessWht = totalInvoice * (withholdingTaxPct / 100);
  const lessSst = salesTax;
  const lessBd = grossTotalPkr * (bulkDiscountPct / 100);
  const netReceivable = totalInvoice - lessWht - lessSst - lessBd;

  const netPayableUsd = events.reduce((s, e) => s + e.eventCount * e.payoutRate, 0);
  const netPayablePkr = netPayableUsd * forexBuyingRate;
  const netMargin = netReceivable - netPayablePkr;

  return {
    netTotalUsd, netTotalPkr, grossTotalPkr, salesTax, totalInvoice,
    lessWht, lessSst, lessBd, netReceivable, netPayableUsd, netPayablePkr, netMargin,
  };
}
```

- [ ] **Step 4: Run the test — verify it passes**

Run: `cd app && pnpm vitest run lib/compute-billing.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add app/lib/compute-billing.ts app/lib/compute-billing.test.ts
git commit -m "feat(billing): compute-billing util with sample-verified math + tests"
```

---

## Task 4: OpenAPI additions

**Files:** Modify `lib/api-spec/openapi.yaml`

Read the file first. Add the tags, paths, and component schemas below in the matching sections. Orval derives names from `operationId`: e.g. `createBilling` → body `CreateBillingBody` + hook `useCreateBilling`; `listBillings` → `ListBillingsQueryParams` + `ListBillingsResponse` + `useListBillings` + `getListBillingsQueryKey`.

- [ ] **Step 1: Add tags** (after the existing tags list)

```yaml
  - name: tax-settings
    description: Global tax configuration
  - name: billings
    description: PO/event-based billing, summary and detail
```

- [ ] **Step 2: Add tax-settings paths**

```yaml
  /tax-settings:
    get:
      operationId: getTaxSettings
      tags: [tax-settings]
      responses:
        "200":
          description: The global tax settings
          content:
            application/json:
              schema: { $ref: "#/components/schemas/TaxSettings" }
    put:
      operationId: updateTaxSettings
      tags: [tax-settings]
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/TaxSettingsInput" }
      responses:
        "200":
          description: Updated tax settings
          content:
            application/json:
              schema: { $ref: "#/components/schemas/TaxSettings" }
```

- [ ] **Step 3: Add billings paths**

```yaml
  /billings:
    get:
      operationId: listBillings
      tags: [billings]
      parameters:
        - { name: clientId, in: query, schema: { type: ["integer", "null"] } }
        - { name: period,   in: query, schema: { type: ["string", "null"] } }
        - { name: status,   in: query, schema: { type: ["string", "null"] } }
      responses:
        "200":
          description: List of billings
          content:
            application/json:
              schema:
                type: array
                items: { $ref: "#/components/schemas/BillingSummary" }
    post:
      operationId: createBilling
      tags: [billings]
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/BillingInput" }
      responses:
        "201":
          description: Created billing
          content:
            application/json:
              schema: { $ref: "#/components/schemas/BillingDetail" }

  /billings/{id}:
    get:
      operationId: getBilling
      tags: [billings]
      parameters:
        - { name: id, in: path, required: true, schema: { type: integer } }
      responses:
        "200":
          description: Billing detail
          content:
            application/json:
              schema: { $ref: "#/components/schemas/BillingDetail" }
    patch:
      operationId: updateBilling
      tags: [billings]
      parameters:
        - { name: id, in: path, required: true, schema: { type: integer } }
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/BillingInput" }
      responses:
        "200":
          description: Updated billing
          content:
            application/json:
              schema: { $ref: "#/components/schemas/BillingDetail" }
    delete:
      operationId: deleteBilling
      tags: [billings]
      parameters:
        - { name: id, in: path, required: true, schema: { type: integer } }
      responses:
        "204": { description: Deleted }

  /billings/{id}/status:
    patch:
      operationId: updateBillingStatus
      tags: [billings]
      parameters:
        - { name: id, in: path, required: true, schema: { type: integer } }
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/BillingStatusInput" }
      responses:
        "200":
          description: Updated billing
          content:
            application/json:
              schema: { $ref: "#/components/schemas/BillingDetail" }

  /billings/{id}/invoice:
    post:
      operationId: generateBillingInvoice
      tags: [billings]
      parameters:
        - { name: id, in: path, required: true, schema: { type: integer } }
      responses:
        "200":
          description: Billing with generated invoiceCode
          content:
            application/json:
              schema: { $ref: "#/components/schemas/BillingDetail" }
        "409": { description: Billing is not approved }
```

- [ ] **Step 4: Add component schemas** (in `components.schemas`)

```yaml
    TaxSettings:
      type: object
      required: [id, remittanceTaxPct, salesTaxPct, withholdingTaxPct]
      properties:
        id: { type: integer }
        remittanceTaxPct: { type: number }
        salesTaxPct: { type: number }
        withholdingTaxPct: { type: number }

    TaxSettingsInput:
      type: object
      required: [remittanceTaxPct, salesTaxPct, withholdingTaxPct]
      properties:
        remittanceTaxPct: { type: number }
        salesTaxPct: { type: number }
        withholdingTaxPct: { type: number }

    BillingEventItemInput:
      type: object
      required: [clientEventId, eventName, billableRate, payoutRate, eventCount]
      properties:
        clientEventId: { type: integer }
        eventName: { type: string }
        billableRate: { type: number }
        payoutRate: { type: number }
        eventCount: { type: integer }

    BillingLineInput:
      type: object
      required: [partnerId, items]
      properties:
        partnerId: { type: integer }
        partnerPurchaseOrderId: { type: ["integer", "null"] }
        items:
          type: array
          items: { $ref: "#/components/schemas/BillingEventItemInput" }

    BillingInput:
      type: object
      required: [clientId, clientPurchaseOrderId, period, forexSellingRate, forexBuyingRate, bulkDiscountPct, whtApplied, lines]
      properties:
        clientId: { type: integer }
        clientPurchaseOrderId: { type: integer }
        period: { type: string }
        forexSellingRate: { type: number }
        forexBuyingRate: { type: number }
        bulkDiscountPct: { type: number }
        whtApplied: { type: boolean }
        notes: { type: ["string", "null"] }
        lines:
          type: array
          items: { $ref: "#/components/schemas/BillingLineInput" }

    BillingStatusInput:
      type: object
      required: [status]
      properties:
        status: { type: string, enum: [pending, approved, dispute] }

    BillingEventItem:
      type: object
      required: [id, clientEventId, eventName, billableRate, payoutRate, eventCount]
      properties:
        id: { type: integer }
        clientEventId: { type: integer }
        eventName: { type: string }
        billableRate: { type: number }
        payoutRate: { type: number }
        eventCount: { type: integer }

    BillingLine:
      type: object
      required: [id, partnerId, partnerName, items]
      properties:
        id: { type: integer }
        partnerId: { type: integer }
        partnerName: { type: string }
        partnerPurchaseOrderId: { type: ["integer", "null"] }
        items:
          type: array
          items: { $ref: "#/components/schemas/BillingEventItem" }

    BillingSummary:
      type: object
      required: [id, clientId, clientName, buyingHouseName, cpoCode, period, status,
                 forexSellingRate, forexBuyingRate, bulkDiscountPct, whtApplied,
                 remittanceTaxPct, salesTaxPct, withholdingTaxPct,
                 totalInvoice, netReceivable, netMargin, createdAt]
      properties:
        id: { type: integer }
        clientId: { type: integer }
        clientName: { type: string }
        buyingHouseName: { type: ["string", "null"] }
        cpoCode: { type: string }
        period: { type: string }
        status: { type: string }
        invoiceCode: { type: ["string", "null"] }
        forexSellingRate: { type: number }
        forexBuyingRate: { type: number }
        bulkDiscountPct: { type: number }
        whtApplied: { type: boolean }
        remittanceTaxPct: { type: number }
        salesTaxPct: { type: number }
        withholdingTaxPct: { type: number }
        totalInvoice: { type: number }
        netReceivable: { type: number }
        netMargin: { type: number }
        notes: { type: ["string", "null"] }
        createdByName: { type: ["string", "null"] }
        createdAt: { type: string }
        lines:
          type: array
          items: { $ref: "#/components/schemas/BillingLine" }

    BillingDetail:
      allOf:
        - $ref: "#/components/schemas/BillingSummary"
        - type: object
          required: [lines]
          properties:
            lines:
              type: array
              items: { $ref: "#/components/schemas/BillingLine" }
```

- [ ] **Step 5: Modify existing schemas**

In `Client`, `ClientInput`, and `ClientUpdate` (whatever the client schemas are called): **remove** `salesTaxPct` and `withholdingTaxPct` properties (and from any `required` list), **add**:
```yaml
        bulkDiscountPct: { type: ["number", "null"] }
```

In `PaymentInput` and `PaymentDetail`: **add** `paymentDate` and switch allocations from `billId` to `billingId`:
```yaml
        paymentDate: { type: ["string", "null"] }
```
For the allocations array items, replace the `billId` property with:
```yaml
              billingId: { type: integer }
```
(keep `amountApplied`; in `PaymentDetail` allocations also keep/replace the display fields with `billingCode`/`invoiceCode` as a string — add `billingLabel: { type: string }`).

In the `listPartnerPurchaseOrders` GET operation, add a query param:
```yaml
        - { name: clientPurchaseOrderId, in: query, schema: { type: ["integer", "null"] } }
```

In the clients `.../purchase-orders` GET operation (list a client's CPOs), add:
```yaml
        - { name: period, in: query, schema: { type: ["string", "null"] } }
```

- [ ] **Step 6: Commit**

```bash
git add lib/api-spec/openapi.yaml
git commit -m "feat(spec): tax-settings + billings endpoints; client BD; payment billing allocations"
```

---

## Task 5: Run codegen

- [ ] **Step 1: Run**

Run: `pnpm --filter @workspace/api-spec codegen`
Expected: orval success for `zod` and `api-client-react`; `typecheck:libs` exits 0.

- [ ] **Step 2: Verify generated names exist**

Run: `grep -n "useListBillings\|useCreateBilling\|useGetTaxSettings\|useUpdateBillingStatus\|useGenerateBillingInvoice" lib/api-client-react/src/generated/*.ts | head`
Expected: matches for each hook.

- [ ] **Step 3: Commit**

```bash
git add lib/api-zod/src/generated lib/api-client-react/src/generated
git commit -m "feat(codegen): regenerate for tax-settings + billings"
```

---

## Task 6: Tax Settings API + Settings card

**Files:**
- Create: `app/app/api/tax-settings/route.ts`
- Modify: `app/app/(dashboard)/settings/page.tsx`

- [ ] **Step 1: Create `app/app/api/tax-settings/route.ts`**

```typescript
import { NextResponse } from "next/server";
import { db, taxSettingsTable } from "@workspace/db";
import { UpdateTaxSettingsBody } from "@workspace/api-zod";

export const runtime = "nodejs";

const DEFAULTS = { remittanceTaxPct: "15", salesTaxPct: "15", withholdingTaxPct: "7" };

async function getOrCreate() {
  const [row] = await db.select().from(taxSettingsTable).limit(1);
  if (row) return row;
  const [created] = await db.insert(taxSettingsTable).values(DEFAULTS).returning();
  return created;
}

function map(r: typeof taxSettingsTable.$inferSelect) {
  return {
    id: r.id,
    remittanceTaxPct: Number(r.remittanceTaxPct),
    salesTaxPct: Number(r.salesTaxPct),
    withholdingTaxPct: Number(r.withholdingTaxPct),
  };
}

export async function GET(): Promise<Response> {
  return NextResponse.json(map(await getOrCreate()));
}

export async function PUT(req: Request): Promise<Response> {
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = UpdateTaxSettingsBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const current = await getOrCreate();
  const [row] = await db.update(taxSettingsTable).set({
    remittanceTaxPct: String(parsed.data.remittanceTaxPct),
    salesTaxPct: String(parsed.data.salesTaxPct),
    withholdingTaxPct: String(parsed.data.withholdingTaxPct),
  }).where(eq(taxSettingsTable.id, current.id)).returning();
  return NextResponse.json(map(row));
}
```
Add the import `import { eq } from "drizzle-orm";` at the top.

- [ ] **Step 2: Add a Tax Settings card to `app/app/(dashboard)/settings/page.tsx`** — READ the file first to match its card/section pattern, then add a card using `useGetTaxSettings()` + `useUpdateTaxSettings()`:

```tsx
// inside the settings page, following the existing card pattern:
function TaxSettingsCard() {
  const { data } = useGetTaxSettings();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState({ remittanceTaxPct: 0, salesTaxPct: 0, withholdingTaxPct: 0 });
  useEffect(() => { if (data) setForm({
    remittanceTaxPct: data.remittanceTaxPct, salesTaxPct: data.salesTaxPct, withholdingTaxPct: data.withholdingTaxPct,
  }); }, [data]);
  const save = useUpdateTaxSettings({ mutation: {
    onSuccess: () => { qc.invalidateQueries({ queryKey: getGetTaxSettingsQueryKey() }); toast({ title: "Tax settings saved" }); },
    onError: () => toast({ title: "Failed to save", variant: "destructive" }),
  }});
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-3">
      <h2 className="text-sm font-semibold">Tax Settings</h2>
      <div className="grid grid-cols-3 gap-3">
        {(["remittanceTaxPct", "salesTaxPct", "withholdingTaxPct"] as const).map(k => (
          <label key={k} className="text-xs space-y-1">
            <span className="text-muted-foreground">
              {k === "remittanceTaxPct" ? "Remittance %" : k === "salesTaxPct" ? "Sales Tax %" : "Withholding %"}
            </span>
            <Input type="number" step="0.01" value={form[k]}
              onChange={e => setForm(f => ({ ...f, [k]: parseFloat(e.target.value) || 0 }))} />
          </label>
        ))}
      </div>
      <Button size="sm" onClick={() => save.mutate({ data: form })} disabled={save.isPending}>
        {save.isPending ? "Saving..." : "Save"}
      </Button>
    </div>
  );
}
```
Import the generated hooks (`useGetTaxSettings`, `useUpdateTaxSettings`, `getGetTaxSettingsQueryKey`) from `@workspace/api-client-react`, and render `<TaxSettingsCard />` in the page. Reuse the page's existing `useQueryClient`, `useToast`, `Input`, `Button` imports (add if missing).

- [ ] **Step 3: Verify**

Run: `cd app && pnpm dev`, open `/settings`, edit a rate, Save → toast; reload → value persists.

- [ ] **Step 4: Commit**

```bash
git add app/app/api/tax-settings app/app/\(dashboard\)/settings/page.tsx
git commit -m "feat(settings): global Tax Settings card + API"
```

---

## Task 7: Client Bulk Discount (drop tax fields)

**Files:** Modify `app/app/api/clients/route.ts`, `app/app/api/clients/[id]/route.ts`, `app/app/(dashboard)/clients/page.tsx`

- [ ] **Step 1: Update client API routes** — READ both route files. In the `map`/response builder and the insert/update `.values({...})`, **remove** every reference to `salesTaxPct` and `withholdingTaxPct`, and **add** `bulkDiscountPct`:

In the response map:
```typescript
bulkDiscountPct: r.bulkDiscountPct != null ? Number(r.bulkDiscountPct) : null,
```
In insert/update values:
```typescript
bulkDiscountPct: parsed.data.bulkDiscountPct != null ? String(parsed.data.bulkDiscountPct) : null,
```

- [ ] **Step 2: Update `app/app/(dashboard)/clients/page.tsx`** — READ the file. In the client form schema + fields, **remove** the Sales Tax % and WHT % inputs, **add** a Bulk Discount % input:

```tsx
<FormField control={form.control} name="bulkDiscountPct" render={({ field }) => (
  <FormItem><FormLabel>Bulk Discount %</FormLabel>
    <FormControl><Input type="number" step="0.01" min={0} {...field}
      value={field.value ?? ""} onChange={e => field.onChange(parseFloat(e.target.value) || 0)} /></FormControl>
    <FormMessage />
  </FormItem>
)} />
```
Update the zod schema: drop `salesTaxPct`/`withholdingTaxPct`, add `bulkDiscountPct: z.number().min(0).nullable().optional()`.

- [ ] **Step 3: Verify**

Run: `cd app && pnpm typecheck` → 0 errors. In the app, create/edit a client, set Bulk Discount %, save, reload → persists.

- [ ] **Step 4: Commit**

```bash
git add app/app/api/clients app/app/\(dashboard\)/clients/page.tsx
git commit -m "feat(clients): add Bulk Discount %, drop per-client tax fields"
```

---

## Task 8: Billings API routes

**Files:**
- Create: `app/app/api/billings/route.ts`, `billings/[id]/route.ts`, `billings/[id]/status/route.ts`, `billings/[id]/invoice/route.ts`

- [ ] **Step 1: Create `app/app/api/billings/route.ts`** (list + create; exports the shared `mapBilling`)

```typescript
import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import {
  db, billingsTable, billingLinesTable, billingEventItemsTable,
  clientsTable, buyingHousesTable, clientPurchaseOrdersTable, partnersTable,
  usersTable, taxSettingsTable,
} from "@workspace/db";
import { CreateBillingBody } from "@workspace/api-zod";
import { getSession } from "@/lib/auth/session";
import { computeBilling } from "@/lib/compute-billing";

export const runtime = "nodejs";

type BillingRow = typeof billingsTable.$inferSelect;

// Full billing shape used by both list (BillingSummary) and detail (BillingDetail).
export async function mapBilling(b: BillingRow) {
  const [client] = await db.select({ name: clientsTable.name, buyingHouseId: clientsTable.buyingHouseId })
    .from(clientsTable).where(eq(clientsTable.id, b.clientId));
  let buyingHouseName: string | null = null;
  if (client?.buyingHouseId != null) {
    const [bh] = await db.select({ name: buyingHousesTable.name })
      .from(buyingHousesTable).where(eq(buyingHousesTable.id, client.buyingHouseId));
    buyingHouseName = bh?.name ?? null;
  }
  const [cpo] = await db.select({ code: clientPurchaseOrdersTable.code })
    .from(clientPurchaseOrdersTable).where(eq(clientPurchaseOrdersTable.id, b.clientPurchaseOrderId));
  let createdByName: string | null = null;
  if (b.createdById != null) {
    const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, b.createdById));
    createdByName = u?.name ?? null;
  }

  const lineRows = await db.select().from(billingLinesTable).where(eq(billingLinesTable.billingId, b.id));
  const lines = [];
  let totalInvoice = 0, netReceivable = 0, netMargin = 0;
  for (const ln of lineRows) {
    const [partner] = await db.select({ name: partnersTable.name }).from(partnersTable).where(eq(partnersTable.id, ln.partnerId));
    const itemRows = await db.select().from(billingEventItemsTable).where(eq(billingEventItemsTable.billingLineId, ln.id));
    const c = computeBilling({
      events: itemRows.map(it => ({
        eventCount: it.eventCount, billableRate: Number(it.billableRate), payoutRate: Number(it.payoutRate),
      })),
      forexSellingRate: Number(b.forexSellingRate), forexBuyingRate: Number(b.forexBuyingRate),
      remittanceTaxPct: Number(b.remittanceTaxPct), salesTaxPct: Number(b.salesTaxPct),
      withholdingTaxPct: Number(b.withholdingTaxPct), bulkDiscountPct: Number(b.bulkDiscountPct),
      whtApplied: b.whtApplied,
    });
    totalInvoice += c.totalInvoice; netReceivable += c.netReceivable; netMargin += c.netMargin;
    lines.push({
      id: ln.id, partnerId: ln.partnerId, partnerName: partner?.name ?? "—",
      partnerPurchaseOrderId: ln.partnerPurchaseOrderId ?? null,
      items: itemRows.map(it => ({
        id: it.id, clientEventId: it.clientEventId, eventName: it.eventName,
        billableRate: Number(it.billableRate), payoutRate: Number(it.payoutRate), eventCount: it.eventCount,
      })),
    });
  }

  return {
    id: b.id, clientId: b.clientId, clientName: client?.name ?? "—", buyingHouseName,
    cpoCode: cpo?.code ?? "—", period: b.period, status: b.status, invoiceCode: b.invoiceCode ?? null,
    forexSellingRate: Number(b.forexSellingRate), forexBuyingRate: Number(b.forexBuyingRate),
    bulkDiscountPct: Number(b.bulkDiscountPct), whtApplied: b.whtApplied,
    remittanceTaxPct: Number(b.remittanceTaxPct), salesTaxPct: Number(b.salesTaxPct),
    withholdingTaxPct: Number(b.withholdingTaxPct),
    totalInvoice, netReceivable, netMargin,
    notes: b.notes ?? null, createdByName, createdAt: b.createdAt.toISOString(), lines,
  };
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const clientId = url.searchParams.get("clientId");
  const period = url.searchParams.get("period");
  const status = url.searchParams.get("status");
  const conds = [];
  if (clientId) conds.push(eq(billingsTable.clientId, Number(clientId)));
  if (period) conds.push(eq(billingsTable.period, period));
  if (status) conds.push(eq(billingsTable.status, status));
  const rows = await db.select().from(billingsTable)
    .where(conds.length ? and(...conds) : undefined).orderBy(billingsTable.createdAt);
  return NextResponse.json(await Promise.all(rows.map(mapBilling)));
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = CreateBillingBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const user = await getSession();

  const [tax] = await db.select().from(taxSettingsTable).limit(1);
  if (!tax) return NextResponse.json({ error: "Tax settings not configured" }, { status: 400 });

  const [billing] = await db.insert(billingsTable).values({
    clientId: parsed.data.clientId,
    clientPurchaseOrderId: parsed.data.clientPurchaseOrderId,
    period: parsed.data.period,
    forexSellingRate: String(parsed.data.forexSellingRate),
    forexBuyingRate: String(parsed.data.forexBuyingRate),
    bulkDiscountPct: String(parsed.data.bulkDiscountPct),
    whtApplied: parsed.data.whtApplied,
    remittanceTaxPct: String(tax.remittanceTaxPct),
    salesTaxPct: String(tax.salesTaxPct),
    withholdingTaxPct: String(tax.withholdingTaxPct),
    status: "pending",
    notes: parsed.data.notes ?? null,
    createdById: user?.sub ?? null,
  }).returning();

  for (const line of parsed.data.lines) {
    const [ln] = await db.insert(billingLinesTable).values({
      billingId: billing.id, partnerId: line.partnerId,
      partnerPurchaseOrderId: line.partnerPurchaseOrderId ?? null,
    }).returning();
    if (line.items.length) {
      await db.insert(billingEventItemsTable).values(line.items.map(it => ({
        billingLineId: ln.id, clientEventId: it.clientEventId, eventName: it.eventName,
        billableRate: String(it.billableRate), payoutRate: String(it.payoutRate), eventCount: it.eventCount,
      })));
    }
  }
  return NextResponse.json(await mapBilling(billing), { status: 201 });
}
```

- [ ] **Step 2: Create `app/app/api/billings/[id]/route.ts`** (get/patch/delete). Next 15 route params are async.

```typescript
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, billingsTable, billingLinesTable, billingEventItemsTable } from "@workspace/db";
import { UpdateBillingBody } from "@workspace/api-zod";
import { mapBilling } from "../route";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const [b] = await db.select().from(billingsTable).where(eq(billingsTable.id, Number(id)));
  if (!b) return NextResponse.json({ error: "Billing not found" }, { status: 404 });
  return NextResponse.json(await mapBilling(b));
}

async function replaceLines(billingId: number, lines: { partnerId: number; partnerPurchaseOrderId?: number | null; items: { clientEventId: number; eventName: string; billableRate: number; payoutRate: number; eventCount: number }[] }[]) {
  const existing = await db.select({ id: billingLinesTable.id }).from(billingLinesTable).where(eq(billingLinesTable.billingId, billingId));
  for (const ln of existing) await db.delete(billingEventItemsTable).where(eq(billingEventItemsTable.billingLineId, ln.id));
  await db.delete(billingLinesTable).where(eq(billingLinesTable.billingId, billingId));
  for (const line of lines) {
    const [ln] = await db.insert(billingLinesTable).values({
      billingId, partnerId: line.partnerId, partnerPurchaseOrderId: line.partnerPurchaseOrderId ?? null,
    }).returning();
    if (line.items.length) {
      await db.insert(billingEventItemsTable).values(line.items.map(it => ({
        billingLineId: ln.id, clientEventId: it.clientEventId, eventName: it.eventName,
        billableRate: String(it.billableRate), payoutRate: String(it.payoutRate), eventCount: it.eventCount,
      })));
    }
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = UpdateBillingBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const [b] = await db.update(billingsTable).set({
    clientId: parsed.data.clientId,
    clientPurchaseOrderId: parsed.data.clientPurchaseOrderId,
    period: parsed.data.period,
    forexSellingRate: String(parsed.data.forexSellingRate),
    forexBuyingRate: String(parsed.data.forexBuyingRate),
    bulkDiscountPct: String(parsed.data.bulkDiscountPct),
    whtApplied: parsed.data.whtApplied,
    notes: parsed.data.notes ?? null,
  }).where(eq(billingsTable.id, Number(id))).returning();
  if (!b) return NextResponse.json({ error: "Billing not found" }, { status: 404 });
  await replaceLines(b.id, parsed.data.lines);
  return NextResponse.json(await mapBilling(b));
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const [row] = await db.delete(billingsTable).where(eq(billingsTable.id, Number(id))).returning();
  if (!row) return NextResponse.json({ error: "Billing not found" }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 3: Create `app/app/api/billings/[id]/status/route.ts`**

```typescript
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, billingsTable } from "@workspace/db";
import { UpdateBillingStatusBody } from "@workspace/api-zod";
import { mapBilling } from "../../route";

export const runtime = "nodejs";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = UpdateBillingStatusBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const [b] = await db.update(billingsTable).set({ status: parsed.data.status })
    .where(eq(billingsTable.id, Number(id))).returning();
  if (!b) return NextResponse.json({ error: "Billing not found" }, { status: 404 });
  return NextResponse.json(await mapBilling(b));
}
```

- [ ] **Step 4: Create `app/app/api/billings/[id]/invoice/route.ts`** (Approved-only, idempotent, per-client-per-year sequence)

```typescript
import { NextResponse } from "next/server";
import { eq, and, isNotNull, count, sql } from "drizzle-orm";
import { db, billingsTable, clientsTable } from "@workspace/db";
import { formatPoCode } from "@/lib/po-codes";
import { mapBilling } from "../../route";

export const runtime = "nodejs";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const [b] = await db.select().from(billingsTable).where(eq(billingsTable.id, Number(id)));
  if (!b) return NextResponse.json({ error: "Billing not found" }, { status: 404 });
  if (b.status !== "approved") return NextResponse.json({ error: "Billing must be approved to generate an invoice" }, { status: 409 });
  if (b.invoiceCode) return NextResponse.json(await mapBilling(b)); // idempotent

  const [client] = await db.select({ codePrefix: clientsTable.codePrefix }).from(clientsTable).where(eq(clientsTable.id, b.clientId));
  const prefix = client?.codePrefix?.trim();
  if (!prefix) return NextResponse.json({ error: "Set a code prefix on the client first" }, { status: 400 });

  const now = new Date();
  const [{ value }] = await db.select({ value: count() }).from(billingsTable).where(and(
    eq(billingsTable.clientId, b.clientId),
    isNotNull(billingsTable.invoiceCode),
    sql`extract(year from ${billingsTable.invoiceGeneratedAt}) = ${now.getFullYear()}`,
  ));
  const invoiceCode = formatPoCode(prefix, now, Number(value) + 1);
  const [updated] = await db.update(billingsTable)
    .set({ invoiceCode, invoiceGeneratedAt: now }).where(eq(billingsTable.id, b.id)).returning();
  return NextResponse.json(await mapBilling(updated));
}
```

- [ ] **Step 5: Verify**

Run: `cd app && pnpm typecheck` → 0 errors. With `pnpm dev` running, `curl -s localhost:3000/api/billings` returns `[]` (empty array, 200).

- [ ] **Step 6: Commit**

```bash
git add app/app/api/billings
git commit -m "feat(api): billings CRUD, status, and invoice-generation routes"
```

---

## Task 9: Billing creation helper endpoints

**Files:**
- Create: `app/app/api/partners/[id]/payable-events/route.ts`
- Modify: `app/app/api/partner-purchase-orders/route.ts`, `app/app/api/clients/[id]/purchase-orders/route.ts`
- Modify: `lib/api-spec/openapi.yaml` (payable-events path) → re-run codegen

- [ ] **Step 1: Add the `payable-events` path to `lib/api-spec/openapi.yaml`**

```yaml
  /partners/{id}/payable-events:
    get:
      operationId: listPartnerPayableEvents
      tags: [partners]
      parameters:
        - { name: id, in: path, required: true, schema: { type: integer } }
        - { name: clientId, in: query, required: true, schema: { type: integer } }
      responses:
        "200":
          description: Client events with billable + partner payout rates
          content:
            application/json:
              schema:
                type: array
                items:
                  type: object
                  required: [clientEventId, name, billableRate, payoutRate]
                  properties:
                    clientEventId: { type: integer }
                    name: { type: string }
                    billableRate: { type: number }
                    payoutRate: { type: number }
```

- [ ] **Step 2: Re-run codegen + commit**

```bash
pnpm --filter @workspace/api-spec codegen
git add lib/api-spec/openapi.yaml lib/api-zod/src/generated lib/api-client-react/src/generated
git commit -m "feat(spec): partner payable-events helper endpoint"
```

- [ ] **Step 3: Create `app/app/api/partners/[id]/payable-events/route.ts`**

```typescript
import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db, clientEventsTable, partnerEventPayoutsTable } from "@workspace/db";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const clientId = new URL(req.url).searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId is required" }, { status: 400 });

  const rows = await db
    .select({
      clientEventId: clientEventsTable.id,
      name: clientEventsTable.name,
      billableRate: clientEventsTable.billableRate,
      payoutRate: partnerEventPayoutsTable.payoutRate,
    })
    .from(clientEventsTable)
    .innerJoin(partnerEventPayoutsTable, and(
      eq(partnerEventPayoutsTable.clientEventId, clientEventsTable.id),
      eq(partnerEventPayoutsTable.partnerId, Number(id)),
    ))
    .where(eq(clientEventsTable.clientId, Number(clientId)));

  return NextResponse.json(rows.map(r => ({
    clientEventId: r.clientEventId, name: r.name,
    billableRate: Number(r.billableRate), payoutRate: Number(r.payoutRate),
  })));
}
```

- [ ] **Step 4: Add the `clientPurchaseOrderId` filter to `app/app/api/partner-purchase-orders/route.ts`** — READ the file. In its `GET`, read the query param and add a `where` condition:

```typescript
const cpoId = new URL(req.url).searchParams.get("clientPurchaseOrderId");
// ...when building the query:
const rows = await db.select().from(partnerPurchaseOrdersTable)
  .where(cpoId ? eq(partnerPurchaseOrdersTable.clientPurchaseOrderId, Number(cpoId)) : undefined)
  .orderBy(partnerPurchaseOrdersTable.createdAt);
```
(Ensure `eq` is imported and the existing `GET(req: Request)` signature accepts `req`.)

- [ ] **Step 5: Add the `period` filter to `app/app/api/clients/[id]/purchase-orders/route.ts`** — READ the file. The CPO code embeds `MMYY`; a `period` of `YYYY-MM` maps to `MMYY`. After fetching the client's CPOs, filter by matching month:

```typescript
const period = new URL(req.url).searchParams.get("period"); // "YYYY-MM"
// ...after loading `rows` (the client's CPOs):
const filtered = period
  ? rows.filter(r => {
      const [y, m] = period.split("-");
      return r.code.includes(`-${m}${y.slice(2)}-`); // PREFIX-MMYY-NNNN
    })
  : rows;
// return `filtered` instead of `rows`
```

- [ ] **Step 6: Verify + commit**

Run: `cd app && pnpm typecheck` → 0 errors.
```bash
git add app/app/api/partners app/app/api/partner-purchase-orders app/app/api/clients
git commit -m "feat(api): payable-events + CPO/period filters for billing creation"
```

---

## Task 10: Create Billing dialog

**Files:**
- Create: `app/components/billings/CreateBillingDialog.tsx`

This dialog is reused for create and edit. It fetches CPOs (by client+month), shows the CPO's Partner POs for reference, lets the user build partner lines with manually-entered event counts (rates auto-fetched), and previews the computed total.

- [ ] **Step 1: Create `app/components/billings/CreateBillingDialog.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  useListClients, useListPartners, useCreateBilling, useUpdateBilling,
} from "@workspace/api-client-react";
import type { BillingDetail } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { computeBilling } from "@/lib/compute-billing";

type PayableEvent = { clientEventId: number; name: string; billableRate: number; payoutRate: number };
type Cpo = { id: number; code: string };
type Ppo = { id: number; code: string; partnerId: number; partnerName?: string; items?: { eventName: string; eventCount: number; cacRate: number }[] };
type LineItem = { clientEventId: number; eventName: string; billableRate: number; payoutRate: number; eventCount: number };
type Line = { partnerId: number | null; partnerPurchaseOrderId: number | null; items: LineItem[] };

function fmt(n: number) { return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export function CreateBillingDialog({ open, editBilling, onClose, onSuccess }: {
  open: boolean; editBilling?: BillingDetail; onClose: () => void; onSuccess: () => void;
}) {
  const { toast } = useToast();
  const { data: clients } = useListClients();
  const { data: partners } = useListPartners();

  const [clientId, setClientId] = useState<number | null>(null);
  const [period, setPeriod] = useState("");            // YYYY-MM
  const [cpoId, setCpoId] = useState<number | null>(null);
  const [cpos, setCpos] = useState<Cpo[]>([]);
  const [ppos, setPpos] = useState<Ppo[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [forexSellingRate, setForexSell] = useState(0);
  const [forexBuyingRate, setForexBuy] = useState(0);
  const [bulkDiscountPct, setBd] = useState(0);
  const [whtApplied, setWht] = useState(false);
  const [notes, setNotes] = useState("");
  const [tax, setTax] = useState({ remittanceTaxPct: 0, salesTaxPct: 0, withholdingTaxPct: 0 });

  // Load snapshot rates for the live preview + client BD default.
  useEffect(() => { if (open) fetch("/api/tax-settings").then(r => r.json()).then(setTax).catch(() => {}); }, [open]);

  useEffect(() => {
    if (open && editBilling) {
      setClientId(editBilling.clientId); setPeriod(editBilling.period);
      setForexSell(editBilling.forexSellingRate); setForexBuy(editBilling.forexBuyingRate);
      setBd(editBilling.bulkDiscountPct); setWht(editBilling.whtApplied); setNotes(editBilling.notes ?? "");
      setLines((editBilling.lines ?? []).map(l => ({
        partnerId: l.partnerId, partnerPurchaseOrderId: l.partnerPurchaseOrderId ?? null,
        items: l.items.map(it => ({ clientEventId: it.clientEventId, eventName: it.eventName, billableRate: it.billableRate, payoutRate: it.payoutRate, eventCount: it.eventCount })),
      })));
    } else if (open) {
      setClientId(null); setPeriod(""); setCpoId(null); setCpos([]); setPpos([]); setLines([]);
      setForexSell(0); setForexBuy(0); setBd(0); setWht(false); setNotes("");
    }
  }, [open, editBilling]);

  // Prefill BD from the selected client.
  useEffect(() => {
    if (clientId && clients) {
      const c = clients.find(x => x.id === clientId) as { bulkDiscountPct?: number | null } | undefined;
      if (c?.bulkDiscountPct != null && !editBilling) setBd(c.bulkDiscountPct);
    }
  }, [clientId, clients, editBilling]);

  // Load CPOs for client + month.
  useEffect(() => {
    if (clientId && period) {
      fetch(`/api/clients/${clientId}/purchase-orders?period=${period}`).then(r => r.json())
        .then((rows: Cpo[]) => setCpos(rows)).catch(() => setCpos([]));
    } else setCpos([]);
  }, [clientId, period]);

  // Load the CPO's partner POs (reference).
  useEffect(() => {
    if (cpoId) {
      fetch(`/api/partner-purchase-orders?clientPurchaseOrderId=${cpoId}`).then(r => r.json())
        .then((rows: Ppo[]) => setPpos(rows)).catch(() => setPpos([]));
    } else setPpos([]);
  }, [cpoId]);

  const create = useCreateBilling({ mutation: {
    onSuccess: () => { onSuccess(); onClose(); toast({ title: "Billing created" }); },
    onError: () => toast({ title: "Failed to create billing", variant: "destructive" }),
  }});
  const update = useUpdateBilling({ mutation: {
    onSuccess: () => { onSuccess(); onClose(); toast({ title: "Billing updated" }); },
    onError: () => toast({ title: "Failed to update billing", variant: "destructive" }),
  }});

  const addLine = () => setLines(ls => [...ls, { partnerId: null, partnerPurchaseOrderId: null, items: [] }]);
  const removeLine = (i: number) => setLines(ls => ls.filter((_, idx) => idx !== i));

  // When a partner is chosen for a line, load its payable events for this client.
  const setLinePartner = async (i: number, partnerId: number) => {
    let events: PayableEvent[] = [];
    if (clientId) {
      try { events = await fetch(`/api/partners/${partnerId}/payable-events?clientId=${clientId}`).then(r => r.json()); } catch { /* keep empty */ }
    }
    setLines(ls => ls.map((l, idx) => idx === i ? {
      ...l, partnerId,
      partnerPurchaseOrderId: ppos.find(p => p.partnerId === partnerId)?.id ?? null,
      items: events.map(e => ({ clientEventId: e.clientEventId, eventName: e.name, billableRate: e.billableRate, payoutRate: e.payoutRate, eventCount: 0 })),
    } : l));
  };

  const setCount = (li: number, ii: number, count: number) =>
    setLines(ls => ls.map((l, idx) => idx === li
      ? { ...l, items: l.items.map((it, j) => j === ii ? { ...it, eventCount: count } : it) } : l));

  const preview = lines.reduce((acc, l) => {
    const c = computeBilling({
      events: l.items, forexSellingRate, forexBuyingRate,
      remittanceTaxPct: tax.remittanceTaxPct, salesTaxPct: tax.salesTaxPct,
      withholdingTaxPct: tax.withholdingTaxPct, bulkDiscountPct, whtApplied,
    });
    return { totalInvoice: acc.totalInvoice + c.totalInvoice, netMargin: acc.netMargin + c.netMargin };
  }, { totalInvoice: 0, netMargin: 0 });

  const submit = () => {
    if (!clientId || !cpoId || !period) { toast({ title: "Client, month and CPO are required", variant: "destructive" }); return; }
    const validLines = lines.filter(l => l.partnerId && l.items.length);
    if (!validLines.length) { toast({ title: "Add at least one partner line", variant: "destructive" }); return; }
    const data = {
      clientId, clientPurchaseOrderId: cpoId, period,
      forexSellingRate, forexBuyingRate, bulkDiscountPct, whtApplied, notes: notes || null,
      lines: validLines.map(l => ({
        partnerId: l.partnerId!, partnerPurchaseOrderId: l.partnerPurchaseOrderId,
        items: l.items.map(it => ({ clientEventId: it.clientEventId, eventName: it.eventName, billableRate: it.billableRate, payoutRate: it.payoutRate, eventCount: it.eventCount })),
      })),
    };
    if (editBilling) update.mutate({ id: editBilling.id, data });
    else create.mutate({ data });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{editBilling ? "Edit Billing" : "Create Billing"}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <label className="text-xs space-y-1"><span className="text-muted-foreground">Client</span>
              <Select value={clientId ? String(clientId) : ""} onValueChange={v => setClientId(Number(v))}>
                <SelectTrigger><SelectValue placeholder="Client" /></SelectTrigger>
                <SelectContent>{clients?.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </label>
            <label className="text-xs space-y-1"><span className="text-muted-foreground">Month</span>
              <Input type="month" value={period} onChange={e => setPeriod(e.target.value)} />
            </label>
            <label className="text-xs space-y-1"><span className="text-muted-foreground">Client PO</span>
              <Select value={cpoId ? String(cpoId) : ""} onValueChange={v => setCpoId(Number(v))}>
                <SelectTrigger><SelectValue placeholder="CPO" /></SelectTrigger>
                <SelectContent>{cpos.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.code}</SelectItem>)}</SelectContent>
              </Select>
            </label>
          </div>

          {ppos.length > 0 && (
            <div className="rounded-lg border border-border bg-muted/20 p-3 text-xs">
              <p className="font-medium mb-1">Partner POs under this CPO (reference)</p>
              {ppos.map(p => (
                <div key={p.id} className="text-muted-foreground">
                  {p.code} · {p.partnerName ?? `Partner ${p.partnerId}`}
                  {p.items?.length ? ` — ${p.items.map(i => `${i.eventName} ×${i.eventCount}`).join(", ")}` : ""}
                </div>
              ))}
            </div>
          )}

          <div className="space-y-3">
            {lines.map((l, li) => (
              <div key={li} className="rounded-lg border border-border p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Select value={l.partnerId ? String(l.partnerId) : ""} onValueChange={v => setLinePartner(li, Number(v))}>
                    <SelectTrigger className="w-56"><SelectValue placeholder="Partner" /></SelectTrigger>
                    <SelectContent>{partners?.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}</SelectContent>
                  </Select>
                  <Button variant="ghost" size="sm" className="ml-auto h-7 w-7 p-0 text-red-600" onClick={() => removeLine(li)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {l.items.length === 0 && l.partnerId && (
                  <p className="text-[11px] text-muted-foreground">No payable events configured for this partner + client.</p>
                )}
                {l.items.map((it, ii) => (
                  <div key={it.clientEventId} className="grid grid-cols-4 gap-2 items-center text-xs">
                    <span className="font-medium">{it.eventName}</span>
                    <span className="text-muted-foreground">Bill {it.billableRate} · Pay {it.payoutRate}</span>
                    <Input type="number" min={0} placeholder="Count" value={it.eventCount || ""}
                      onChange={e => setCount(li, ii, parseInt(e.target.value) || 0)} className="h-7" />
                    <span className="text-right">${fmt(it.eventCount * it.billableRate)}</span>
                  </div>
                ))}
              </div>
            ))}
            <Button variant="outline" size="sm" className="gap-1.5" onClick={addLine}><Plus className="h-3.5 w-3.5" /> Add Partner</Button>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <label className="text-xs space-y-1"><span className="text-muted-foreground">Forex Selling</span>
              <Input type="number" step="0.0001" value={forexSellingRate || ""} onChange={e => setForexSell(parseFloat(e.target.value) || 0)} /></label>
            <label className="text-xs space-y-1"><span className="text-muted-foreground">Forex Buying</span>
              <Input type="number" step="0.0001" value={forexBuyingRate || ""} onChange={e => setForexBuy(parseFloat(e.target.value) || 0)} /></label>
            <label className="text-xs space-y-1"><span className="text-muted-foreground">Bulk Discount %</span>
              <Input type="number" step="0.01" value={bulkDiscountPct || ""} onChange={e => setBd(parseFloat(e.target.value) || 0)} /></label>
          </div>

          <label className="flex items-center gap-2 text-xs">
            <Checkbox checked={whtApplied} onCheckedChange={v => setWht(Boolean(v))} /> Apply Withholding Tax gross-up
          </label>

          <Textarea rows={2} placeholder="Notes..." value={notes} onChange={e => setNotes(e.target.value)} />

          <div className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2 text-xs">
            <span>Total Invoice: <b>PKR {fmt(preview.totalInvoice)}</b></span>
            <span>Net Margin: <b>PKR {fmt(preview.netMargin)}</b></span>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={submit} disabled={create.isPending || update.isPending}>
              {create.isPending || update.isPending ? "Saving..." : editBilling ? "Update" : "Create Billing"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify**

Run: `cd app && pnpm typecheck` → 0 errors. (Rendered/tested end-to-end in Task 11 once the page mounts it.)

- [ ] **Step 3: Commit**

```bash
git add app/components/billings/CreateBillingDialog.tsx
git commit -m "feat(billing): create/edit billing dialog with reference POs + live preview"
```

---

## Task 11: Sidebar + Billing Summary page

**Files:**
- Create: `app/components/billings/StatusSelect.tsx`, `app/app/(dashboard)/billings/summary/page.tsx`
- Modify: `app/components/layout/Sidebar.tsx`

- [ ] **Step 1: Rewire the sidebar** — READ `app/components/layout/Sidebar.tsx`. In the Financials group nav array: **remove** the Transactions entry; **replace** the single Billings entry with two entries (keep Payments and Cost as-is):

```tsx
{ label: "Billing Summary", href: "/billings/summary", permission: "View Billings" },
{ label: "Billing Detail",  href: "/billings/detail",  permission: "View Billing Detail" },
```
Match the existing entry shape (icon/label/href/permission) used by the other Financials items.

- [ ] **Step 2: Create `app/components/billings/StatusSelect.tsx`**

```tsx
"use client";

import { useUpdateBillingStatus, getListBillingsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const COLORS: Record<string, string> = {
  pending: "text-yellow-700 dark:text-yellow-400",
  approved: "text-emerald-700 dark:text-emerald-400",
  dispute: "text-red-700 dark:text-red-400",
};

export function StatusSelect({ billingId, status }: { billingId: number; status: string }) {
  const qc = useQueryClient();
  const mut = useUpdateBillingStatus({ mutation: {
    onSuccess: () => qc.invalidateQueries({ queryKey: getListBillingsQueryKey() }),
  }});
  return (
    <Select value={status} onValueChange={v => mut.mutate({ id: billingId, data: { status: v } })}>
      <SelectTrigger className={cn("h-7 w-28 text-xs capitalize", COLORS[status])}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="pending">Pending</SelectItem>
        <SelectItem value="approved">Approved</SelectItem>
        <SelectItem value="dispute">Dispute</SelectItem>
      </SelectContent>
    </Select>
  );
}
```

- [ ] **Step 3: Create `app/app/(dashboard)/billings/summary/page.tsx`**

```tsx
"use client";

import { useState } from "react";
import { Plus, ChevronRight, Pencil, Trash2 } from "lucide-react";
import {
  useListBillings, useDeleteBilling, getListBillingsQueryKey,
} from "@workspace/api-client-react";
import type { BillingSummary, BillingDetail } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { computeBilling } from "@/lib/compute-billing";
import { cn } from "@/lib/utils";
import { PermissionGuard } from "@/components/PermissionGuard";
import { CreateBillingDialog } from "@/components/billings/CreateBillingDialog";
import { StatusSelect } from "@/components/billings/StatusSelect";

function fmt(n: number) { return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

function lineCompute(b: BillingSummary, line: BillingSummary["lines"][number]) {
  return computeBilling({
    events: line.items.map(it => ({ eventCount: it.eventCount, billableRate: it.billableRate, payoutRate: it.payoutRate })),
    forexSellingRate: b.forexSellingRate, forexBuyingRate: b.forexBuyingRate,
    remittanceTaxPct: b.remittanceTaxPct, salesTaxPct: b.salesTaxPct,
    withholdingTaxPct: b.withholdingTaxPct, bulkDiscountPct: b.bulkDiscountPct, whtApplied: b.whtApplied,
  });
}

export default function BillingSummaryPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: billings, isLoading } = useListBillings({});
  const [addOpen, setAddOpen] = useState(false);
  const [editBilling, setEditBilling] = useState<BillingDetail | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  const del = useDeleteBilling({ mutation: {
    onSuccess: () => { qc.invalidateQueries({ queryKey: getListBillingsQueryKey() }); toast({ title: "Billing deleted" }); },
    onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
  }});

  const openEdit = async (id: number) => {
    const detail: BillingDetail = await fetch(`/api/billings/${id}`).then(r => r.json());
    setEditBilling(detail);
  };

  return (
    <PermissionGuard permission="View Billings">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Billing Summary</h1>
            <p className="text-sm text-muted-foreground">{billings?.length ?? 0} billings</p>
          </div>
          <Button size="sm" className="gap-1.5 text-xs" onClick={() => setAddOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Create Billing
          </Button>
        </div>

        <div className="rounded-2xl border border-border bg-card shadow-sm overflow-x-auto">
          <table className="w-full min-w-max">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {["", "Client", "Agency", "Month", "CPO", "Total Invoice (PKR)", "Status", "Actions"].map(h => (
                  <th key={h} className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                [...Array(3)].map((_, i) => (
                  <tr key={i} className="border-b border-border">{[...Array(8)].map((_, j) => <td key={j} className="px-3 py-2"><Skeleton className="h-3 w-16" /></td>)}</tr>
                ))
              ) : !billings?.length ? (
                <tr><td colSpan={8} className="px-5 py-10 text-center text-sm text-muted-foreground">No billings yet</td></tr>
              ) : billings.map(b => (
                <BillingGroup key={b.id} b={b} expanded={expanded === b.id}
                  onToggle={() => setExpanded(expanded === b.id ? null : b.id)}
                  onEdit={() => openEdit(b.id)}
                  onDelete={() => { if (confirm("Delete this billing?")) del.mutate({ id: b.id }); }} />
              ))}
            </tbody>
          </table>
        </div>

        <CreateBillingDialog open={addOpen || editBilling != null} editBilling={editBilling ?? undefined}
          onClose={() => { setAddOpen(false); setEditBilling(null); }}
          onSuccess={() => qc.invalidateQueries({ queryKey: getListBillingsQueryKey() })} />
      </div>
    </PermissionGuard>
  );
}

function BillingGroup({ b, expanded, onToggle, onEdit, onDelete }: {
  b: BillingSummary; expanded: boolean; onToggle: () => void; onEdit: () => void; onDelete: () => void;
}) {
  return (
    <>
      <tr className="border-b border-border hover:bg-muted/20">
        <td className="px-3 py-2">
          <button onClick={onToggle}><ChevronRight className={cn("h-4 w-4 transition-transform", expanded && "rotate-90")} /></button>
        </td>
        <td className="px-3 py-2 text-xs font-semibold">{b.clientName}</td>
        <td className="px-3 py-2 text-xs">{b.buyingHouseName ?? "—"}</td>
        <td className="px-3 py-2 text-xs">{b.period}</td>
        <td className="px-3 py-2 text-xs">{b.cpoCode}</td>
        <td className="px-3 py-2 text-xs font-semibold">{fmt(b.totalInvoice)}</td>
        <td className="px-3 py-2"><StatusSelect billingId={b.id} status={b.status} /></td>
        <td className="px-3 py-2">
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onEdit}><Pencil className="h-3 w-3" /></Button>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-red-600" onClick={onDelete}><Trash2 className="h-3 w-3" /></Button>
          </div>
        </td>
      </tr>
      {expanded && b.lines.map(line => {
        const c = lineCompute(b, line);
        return (
          <tr key={line.id} className="border-b border-border bg-muted/10 text-xs">
            <td></td>
            <td className="px-3 py-2" colSpan={2}>
              <span className="font-medium">{line.partnerName}</span>
              <span className="text-muted-foreground ml-2">
                {line.items.map(it => `${it.eventName} ×${it.eventCount} @ ${it.billableRate}`).join("  ·  ")}
              </span>
            </td>
            <td className="px-3 py-2" colSpan={2}>USD {fmt(c.netTotalUsd)} · Forex {b.forexSellingRate} · PKR {fmt(c.netTotalPkr)}</td>
            <td className="px-3 py-2">Gross {fmt(c.grossTotalPkr)} · Tax {fmt(c.salesTax)} · <b>Inv {fmt(c.totalInvoice)}</b></td>
            <td colSpan={2}></td>
          </tr>
        );
      })}
    </>
  );
}
```

- [ ] **Step 2 (verify) → Step 4: Verify + commit**

Run: `cd app && pnpm dev`. Open `/billings/summary`; **Create Billing** → pick a client, month, CPO, add a partner line, enter counts, forex, save. Row appears; expand shows the partner breakdown; the status dropdown updates.

```bash
git add app/components/billings/StatusSelect.tsx app/app/\(dashboard\)/billings/summary app/components/layout/Sidebar.tsx
git commit -m "feat(billing): Billing Summary page, status dropdown, sidebar rewire"
```

---

## Task 12: Billing Detail page

**Files:**
- Create: `app/app/(dashboard)/billings/detail/page.tsx`

Same billing rows as Summary, plus the deduction columns (Less WHT / Less SST / Less BD / Net Receivable), the payable block (payout, net payable USD, forex buying, net payable PKR, Net Margin), and a **Generate Invoice** button enabled only when `status = approved`.

- [ ] **Step 1: Create `app/app/(dashboard)/billings/detail/page.tsx`**

```tsx
"use client";

import { useState } from "react";
import { FileText } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useListBillings, useGenerateBillingInvoice, getListBillingsQueryKey,
} from "@workspace/api-client-react";
import type { BillingSummary } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { computeBilling } from "@/lib/compute-billing";
import { cn } from "@/lib/utils";
import { PermissionGuard } from "@/components/PermissionGuard";
import { StatusSelect } from "@/components/billings/StatusSelect";

function fmt(n: number) { return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export default function BillingDetailPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const router = useRouter();
  const { data: billings, isLoading } = useListBillings({});

  const gen = useGenerateBillingInvoice({ mutation: {
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: getListBillingsQueryKey() });
      toast({ title: `Invoice ${data.invoiceCode} generated` });
      router.push(`/billings/${data.id}/invoice`);
    },
    onError: () => toast({ title: "Approve the billing before generating an invoice", variant: "destructive" }),
  }});

  return (
    <PermissionGuard permission="View Billing Detail">
      <div className="space-y-4">
        <div><h1 className="text-xl font-bold">Billing Detail</h1>
          <p className="text-sm text-muted-foreground">{billings?.length ?? 0} billings</p></div>

        <div className="rounded-2xl border border-border bg-card shadow-sm overflow-x-auto">
          <table className="w-full min-w-max">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {["Client", "Partner", "Month", "Total Invoice", "Less WHT", "Less SST", "Less BD", "Net Receivable",
                  "Net Payable (PKR)", "Net Margin", "Status", "Invoice"].map(h => (
                  <th key={h} className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                [...Array(3)].map((_, i) => (
                  <tr key={i} className="border-b border-border">{[...Array(12)].map((_, j) => <td key={j} className="px-3 py-2"><Skeleton className="h-3 w-16" /></td>)}</tr>
                ))
              ) : !billings?.length ? (
                <tr><td colSpan={12} className="px-5 py-10 text-center text-sm text-muted-foreground">No billings yet</td></tr>
              ) : billings.map(b => <DetailRows key={b.id} b={b}
                onInvoice={() => gen.mutate({ id: b.id })} />)}
            </tbody>
          </table>
        </div>
      </div>
    </PermissionGuard>
  );
}

function DetailRows({ b, onInvoice }: { b: BillingSummary; onInvoice: () => void }) {
  return (
    <>
      {b.lines.map((line, idx) => {
        const c = computeBilling({
          events: line.items.map(it => ({ eventCount: it.eventCount, billableRate: it.billableRate, payoutRate: it.payoutRate })),
          forexSellingRate: b.forexSellingRate, forexBuyingRate: b.forexBuyingRate,
          remittanceTaxPct: b.remittanceTaxPct, salesTaxPct: b.salesTaxPct,
          withholdingTaxPct: b.withholdingTaxPct, bulkDiscountPct: b.bulkDiscountPct, whtApplied: b.whtApplied,
        });
        return (
          <tr key={line.id} className="border-b border-border hover:bg-muted/20 text-xs">
            <td className="px-3 py-2 font-semibold">{idx === 0 ? b.clientName : ""}</td>
            <td className="px-3 py-2">{line.partnerName}</td>
            <td className="px-3 py-2">{b.period}</td>
            <td className="px-3 py-2 font-semibold">{fmt(c.totalInvoice)}</td>
            <td className="px-3 py-2 text-red-600">({fmt(c.lessWht)})</td>
            <td className="px-3 py-2 text-red-600">({fmt(c.lessSst)})</td>
            <td className="px-3 py-2 text-red-600">({fmt(c.lessBd)})</td>
            <td className="px-3 py-2 font-semibold">{fmt(c.netReceivable)}</td>
            <td className="px-3 py-2">{fmt(c.netPayablePkr)}</td>
            <td className={cn("px-3 py-2 font-semibold", c.netMargin < 0 ? "text-red-600" : "text-emerald-600")}>{fmt(c.netMargin)}</td>
            {idx === 0 && (
              <>
                <td className="px-3 py-2" rowSpan={b.lines.length}><StatusSelect billingId={b.id} status={b.status} /></td>
                <td className="px-3 py-2" rowSpan={b.lines.length}>
                  {b.invoiceCode ? (
                    <a href={`/billings/${b.id}/invoice`} className="text-primary underline text-[11px]">{b.invoiceCode}</a>
                  ) : (
                    <Button variant="outline" size="sm" className="h-7 gap-1 text-[11px]"
                      disabled={b.status !== "approved"} onClick={onInvoice}>
                      <FileText className="h-3 w-3" /> Generate
                    </Button>
                  )}
                </td>
              </>
            )}
          </tr>
        );
      })}
    </>
  );
}
```

- [ ] **Step 2: Verify + commit**

Run: `/billings/detail` shows deduction + payable + margin columns. A `pending` billing's Generate button is disabled; set it Approved → Generate produces an invoice code and navigates to the invoice.

```bash
git add app/app/\(dashboard\)/billings/detail
git commit -m "feat(billing): Billing Detail page with deductions, margin, invoice generation"
```

---

## Task 13: Invoice document + PDF

**Files:**
- Create: `app/components/billings/BillingInvoice.tsx`, `app/app/(dashboard)/billings/[id]/invoice/page.tsx`

- [ ] **Step 1: Create `app/components/billings/BillingInvoice.tsx`** — a print-ready node mirroring `PartnerInvoice` styling. READ `app/components/purchase-orders/PartnerInvoice.tsx` to match the header/logo/footer markup, then:

```tsx
"use client";

import type { BillingDetail } from "@workspace/api-client-react";
import { computeBilling } from "@/lib/compute-billing";

function fmt(n: number) { return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export function BillingInvoice({ b, innerRef }: { b: BillingDetail; innerRef: React.Ref<HTMLDivElement> }) {
  const totals = b.lines.reduce((acc, line) => {
    const c = computeBilling({
      events: line.items.map(it => ({ eventCount: it.eventCount, billableRate: it.billableRate, payoutRate: it.payoutRate })),
      forexSellingRate: b.forexSellingRate, forexBuyingRate: b.forexBuyingRate,
      remittanceTaxPct: b.remittanceTaxPct, salesTaxPct: b.salesTaxPct,
      withholdingTaxPct: b.withholdingTaxPct, bulkDiscountPct: b.bulkDiscountPct, whtApplied: b.whtApplied,
    });
    return {
      netTotalUsd: acc.netTotalUsd + c.netTotalUsd, netTotalPkr: acc.netTotalPkr + c.netTotalPkr,
      grossTotalPkr: acc.grossTotalPkr + c.grossTotalPkr, salesTax: acc.salesTax + c.salesTax,
      totalInvoice: acc.totalInvoice + c.totalInvoice,
    };
  }, { netTotalUsd: 0, netTotalPkr: 0, grossTotalPkr: 0, salesTax: 0, totalInvoice: 0 });

  return (
    <div ref={innerRef} className="bg-white text-black mx-auto p-10" style={{ width: 794 }}>
      <div className="flex items-start justify-between">
        <img src="/advengers-logo.png" alt="Advengers" className="h-12" />
        <div className="text-right">
          <h1 className="text-2xl font-bold tracking-wide">INVOICE</h1>
          <p className="text-sm">Invoice No: {b.invoiceCode ?? "—"}</p>
          <p className="text-sm">Date: {b.invoiceGeneratedAt ? new Date(b.invoiceGeneratedAt).toLocaleDateString() : new Date().toLocaleDateString()}</p>
        </div>
      </div>
      <hr className="my-4 border-gray-300" />
      <div className="text-sm">
        <p className="font-semibold">Bill To</p>
        <p>{b.clientName}</p>
        {b.buyingHouseName && <p>Agency: {b.buyingHouseName}</p>}
      </div>
      <table className="w-full mt-6 text-xs border-collapse">
        <thead>
          <tr className="bg-gray-100">
            {["Partner", "Agency", "Event", "Rate", "Count", "Line Total (USD)"].map(h =>
              <th key={h} className="border border-gray-300 px-2 py-1 text-left">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {b.lines.flatMap(line => line.items.map(it => (
            <tr key={`${line.id}-${it.id}`}>
              <td className="border border-gray-300 px-2 py-1">{line.partnerName}</td>
              <td className="border border-gray-300 px-2 py-1">{b.buyingHouseName ?? "—"}</td>
              <td className="border border-gray-300 px-2 py-1">{it.eventName}</td>
              <td className="border border-gray-300 px-2 py-1">{it.billableRate}</td>
              <td className="border border-gray-300 px-2 py-1">{it.eventCount}</td>
              <td className="border border-gray-300 px-2 py-1 text-right">{fmt(it.eventCount * it.billableRate)}</td>
            </tr>
          )))}
        </tbody>
      </table>
      <div className="mt-4 ml-auto w-72 text-xs space-y-1">
        <Row label="Total of Events (USD)" value={fmt(totals.netTotalUsd)} />
        <Row label={`Forex Rate`} value={String(b.forexSellingRate)} />
        <Row label="Net Total (PKR)" value={fmt(totals.netTotalPkr)} />
        <Row label="Gross Total (PKR)" value={fmt(totals.grossTotalPkr)} />
        <Row label={`Sales Tax @ ${b.salesTaxPct}%`} value={fmt(totals.salesTax)} />
        <Row label="Total Invoice Amount" value={fmt(totals.totalInvoice)} bold />
      </div>
      <hr className="my-6 border-gray-300" />
      <p className="text-xs">Payment Terms: {(b as { paymentTerms?: string }).paymentTerms ?? "As agreed"}</p>
      <p className="text-xs mt-2 italic">This is a system generated document and does not require a physical signature.</p>
      <p className="text-[10px] text-center text-gray-500 mt-8">
        Advengers — Office #2, 1st Floor, Bldg #87-C, 11th Commercial St, Phase II Ext, DHA, Karachi, 74700 · www.advengers.com.pk
      </p>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? "font-bold border-t border-gray-300 pt-1" : ""}`}>
      <span>{label}</span><span>PKR {value}</span>
    </div>
  );
}
```
(If the client's payment terms are needed, extend `mapBilling` in `app/app/api/billings/route.ts` to also join `payment_terms` via `clients.paymentTermsId` and add a `paymentTerms` string to the response + `BillingSummary` schema. Otherwise the "As agreed" fallback is used.)

- [ ] **Step 2: Create `app/app/(dashboard)/billings/[id]/invoice/page.tsx`**

```tsx
"use client";

import { useRef, useState, useEffect } from "react";
import { useParams } from "next/navigation";
import type { BillingDetail } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { BillingInvoice } from "@/components/billings/BillingInvoice";

export default function InvoicePage() {
  const { id } = useParams<{ id: string }>();
  const ref = useRef<HTMLDivElement>(null);
  const [b, setB] = useState<BillingDetail | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { fetch(`/api/billings/${id}`).then(r => r.json()).then(setB); }, [id]);

  const download = async () => {
    if (!ref.current || !b) return;
    setBusy(true);
    try {
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
      const canvas = await html2canvas(ref.current, { scale: 2 });
      const img = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ unit: "px", format: "a4" });
      const w = pdf.internal.pageSize.getWidth();
      const h = (canvas.height * w) / canvas.width;
      pdf.addImage(img, "PNG", 0, 0, w, h);
      pdf.save(`${b.invoiceCode ?? "invoice"}.pdf`);
    } finally { setBusy(false); }
  };

  if (!b) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={download} disabled={busy}>{busy ? "Generating…" : "Download PDF"}</Button>
      </div>
      <div className="overflow-x-auto"><BillingInvoice b={b} innerRef={ref} /></div>
    </div>
  );
}
```

- [ ] **Step 3: Verify + commit**

Generate an invoice from Billing Detail → invoice page renders; **Download PDF** saves `{PREFIX-MMYY-NNNN}.pdf`.

```bash
git add app/components/billings/BillingInvoice.tsx app/app/\(dashboard\)/billings/\[id\]/invoice
git commit -m "feat(billing): invoice document + PDF download"
```

---

## Task 14: Repoint Payments onto billings

**Files:**
- Modify: `app/app/api/payments/route.ts`, `app/app/api/payments/[id]/route.ts`, `app/app/(dashboard)/payments/page.tsx`

- [ ] **Step 1: Update the payments API** — READ both route files. Replace `paymentBillsTable`/`billsTable` usage with `paymentBillingsTable`/`billingsTable`, and read `paymentDate`. In `mapPayment`, build allocations from `payment_billings` joined to `billings`:

```typescript
import { db, paymentsTable, paymentBillingsTable, billingsTable } from "@workspace/db";
// ...
const pbRows = await db.select().from(paymentBillingsTable)
  .innerJoin(billingsTable, eq(paymentBillingsTable.billingId, billingsTable.id))
  .where(eq(paymentBillingsTable.paymentId, p.id));
const allocations = pbRows.map(({ payment_billings: pb, billings: bl }) => ({
  billingId: pb.billingId,
  billingLabel: bl.invoiceCode ?? `Billing #${bl.id}`,
  amountApplied: Number(pb.amountApplied),
}));
```
In create/update: compute `totalAmount = Σ amountApplied`, insert `paymentDate: parsed.data.paymentDate ?? null`, and write allocations to `paymentBillingsTable` with `billingId`. (Mirror the existing create/update flow, swapping the table + `billId → billingId`.)

- [ ] **Step 2: Update `app/app/(dashboard)/payments/page.tsx`** — READ the file. Changes:
  - Swap `useListBills` → `useListBillings({})`; the settle-able list = billings where `status === "approved"` (or `invoiceCode != null`).
  - Allocation `billId` → `billingId`; the checkbox row shows `bill.invoiceCode ?? "Billing #"+bill.id` and `Pending: PKR fmtNum(bill.netReceivable - alreadyAllocated)`.
  - Compute `alreadyAllocated` per billing from `useListPayments()` allocations (sum `amountApplied` where `a.billingId === billing.id`, excluding the payment being edited).
  - Add a **Date Received** input bound to `paymentDate` (type `date`); keep mode, notes, and the `receiptUrl` attachment upload as-is.
  - Update the `allocationSchema` field name to `billingId`, and the table column that renders `a.billNumber` → `a.billingLabel`.

```tsx
// allocation schema
const allocationSchema = z.object({ billingId: z.number(), amountApplied: z.number().min(0) });
// payment schema adds:
paymentDate: z.string().optional(),
// settle-able list:
{(billings ?? []).filter(b => b.status === "approved").map(b => { /* checkbox row using b.netReceivable */ })}
```

- [ ] **Step 3: Verify + commit**

Record a payment against one or more approved billings; allocations, date received, and receipt attachment save and display; edit/delete work.

```bash
git add app/app/api/payments app/app/\(dashboard\)/payments/page.tsx
git commit -m "feat(payments): settle billings (multi-allocation), date received, receipt"
```

---

## Task 15: Self-review, typecheck, and QA polish

- [ ] **Step 1: Full typecheck + tests**

Run: `pnpm typecheck` (root) → 0 errors. `cd app && pnpm vitest run` → all pass (incl. `compute-billing`).

- [ ] **Step 2: End-to-end smoke** (with `pnpm dev`)
  1. Settings → set Remittance 15, Sales 15, WHT 7, Save.
  2. Client → set Bulk Discount 20.
  3. Ensure the client has events with billable rates and a partner with payout rates + a CPO for the month.
  4. Billing Summary → Create Billing → verify totals preview matches the sample math when using the sample inputs.
  5. Set status Approved → Billing Detail → Generate Invoice → Download PDF.
  6. Payments → settle the billing; confirm pending decreases.

- [ ] **Step 3: Confirm removals** — Transactions is gone from the sidebar; `/billings/summary` and `/billings/detail` are the only billing nav entries; Analytics pages still load (unchanged).

- [ ] **Step 4: Commit any polish**

```bash
git add -A
git commit -m "chore(billing): typecheck, tests, and QA polish"
```

---

## Self-Review checklist (run before handing off)

- **Spec coverage:** Tax Settings (T2,T6) · client BD + drop tax (T1,T7) · billing model tables (T1) · compute math (T3) · billings API + status + invoice (T8) · creation helpers (T9) · Create dialog (T10) · Summary page + status + sidebar (T11) · Detail page + deductions + margin + invoice button (T12) · invoice doc + PDF (T13) · payments repoint + date received (T14). All spec sections mapped.
- **Placeholder scan:** none — every code step is complete.
- **Type consistency:** `computeBilling` signature identical across T3/T10/T11/T12/T13; billing response shape (`lines[].items[]`, `netReceivable`, `netMargin`, `totalInvoice`) consistent between `mapBilling` (T8) and all consumers; allocation key `billingId` consistent across T14 API + page.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-05-billing-summary-detail.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — I execute tasks in this session using executing-plans, batch execution with checkpoints for review.

Which approach?