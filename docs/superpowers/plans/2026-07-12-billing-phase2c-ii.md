# Billing Phase 2C-ii — Partner Payments + Payments Tabs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add **Partner Payments** — record disbursements to partners (each tagged to one **partner bill** and the **funding client payment** that sources it), with a Pending→Settled status; drive a **progress bar** on the Partner Billing list from settled payments; and restructure **Payments** into **Client | Partner** tabs.

**Architecture:** DB-first — `partner_payments` schema → additive migration → OpenAPI + codegen → partner-payments CRUD + status routes → UI. Mirrors the existing client-payment machinery: `PaymentStatusSelect` → `PartnerPaymentStatusSelect` (pending↔settled), the client Summary progress bar → the Partner Billing progress bar, and the over-allocation rule (validation counts **all** partner payments to a bill; **paid/progress/aging** count only **settled** ones). `mapPartnerBill` gains `amountPaid` (Σ settled partner payments) so the bill list can show Paid/Pending/Progress and mark the aging pill settled. The existing Payments page body becomes the Client tab; a new Partner tab holds partner disbursements.

**Tech Stack:** PostgreSQL + Drizzle, Next.js 15, OpenAPI 3.1 + orval, React Query, shadcn/ui (Tabs, Select, Progress, Dialog), `pg`.

**Spec:** `docs/superpowers/specs/2026-07-11-billing-phase2-design.md` (§10 partner payments, §Phase 2C, §Data model changes). **Builds on** Phase 2C-i (`partner_bills` + Partner Billing tab + `AgingPill`, on `main`).

---

## File Structure

- **Create** `lib/db/src/schema/partner-payments.ts`; **Modify** `lib/db/src/schema/index.ts`.
- **Modify** `lib/api-spec/openapi.yaml` (partner-payments paths/schemas + `PartnerBill.amountPaid`) (+ codegen).
- **Create** `app/app/api/partner-payments/route.ts`, `partner-payments/[id]/route.ts`, `partner-payments/[id]/status/route.ts`.
- **Modify** `app/app/api/partner-bills/route.ts` (`mapPartnerBill` → `amountPaid`).
- **Create** `app/components/payments/PartnerPaymentStatusSelect.tsx`; **Modify** `app/components/billings/PartnerBillingTab.tsx` (Paid/Pending/Progress columns + settled aging).
- **Create** `app/components/payments/CreatePartnerPaymentDialog.tsx`, `app/components/payments/PartnerPaymentsTab.tsx`.
- **Create** `app/components/payments/ClientPaymentsTab.tsx` (extracted page body); **Rewrite** `app/app/(dashboard)/payments/page.tsx` as the tabs shell.

Work happens in a dedicated worktree off `main` (created before Task 1). No Sidebar change — the `/payments` nav item is unchanged; the page becomes tabbed internally.

---

## Task 1: `partner_payments` schema + migration

**Files:** Create `lib/db/src/schema/partner-payments.ts`; Modify `lib/db/src/schema/index.ts`

- [ ] **Step 1: Create `lib/db/src/schema/partner-payments.ts`**

```typescript
import { pgTable, serial, integer, text, numeric, date, timestamp } from "drizzle-orm/pg-core";
import { partnersTable } from "./partners";
import { partnerBillsTable } from "./partner-bills";
import { paymentsTable } from "./payments";
import { usersTable } from "./auth";

export const partnerPaymentsTable = pgTable("partner_payments", {
  id: serial("id").primaryKey(),
  partnerId: integer("partner_id").notNull().references(() => partnersTable.id, { onDelete: "restrict" }),
  partnerBillId: integer("partner_bill_id").notNull().references(() => partnerBillsTable.id, { onDelete: "cascade" }),
  sourceClientPaymentId: integer("source_client_payment_id").references(() => paymentsTable.id, { onDelete: "set null" }),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),        // USD
  mode: text("mode"),
  status: text("status").notNull().default("pending"),                     // pending | settled
  attachmentUrl: text("attachment_url"),
  paymentDate: date("payment_date"),
  notes: text("notes"),
  createdById: integer("created_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PartnerPayment = typeof partnerPaymentsTable.$inferSelect;
```

- [ ] **Step 2: Export from `lib/db/src/schema/index.ts`** — add at the end:
```typescript
export * from "./partner-payments";
```

- [ ] **Step 3: Typecheck libs**

Run: `pnpm -w run typecheck:libs`
Expected: 0 errors.

- [ ] **Step 4: Apply migration to the dev DB** — create `lib/db/_apply-2cii.mjs` (temporary; delete after):
```javascript
import pg from "pg";
const { Client } = pg;
const DDL = `
CREATE TABLE IF NOT EXISTS partner_payments (
  id serial PRIMARY KEY,
  partner_id integer NOT NULL REFERENCES partners(id) ON DELETE restrict,
  partner_bill_id integer NOT NULL REFERENCES partner_bills(id) ON DELETE cascade,
  source_client_payment_id integer REFERENCES payments(id) ON DELETE set null,
  amount numeric(14,2) NOT NULL,
  mode text,
  status text NOT NULL DEFAULT 'pending',
  attachment_url text,
  payment_date date,
  notes text,
  created_by_id integer REFERENCES users(id) ON DELETE set null,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
`;
const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }
const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query(DDL);
const t = await client.query(`SELECT to_regclass('public.partner_payments') AS tbl`);
console.log("partner_payments:", t.rows[0].tbl);
await client.end();
console.log("2C-ii SCHEMA APPLIED OK");
```
Run from the worktree root:
```bash
export DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | head -1 | sed -E 's/^DATABASE_URL=//; s/^"//; s/"$//')"
cd lib/db && node _apply-2cii.mjs && rm _apply-2cii.mjs
```
Expected: `partner_payments: partner_payments`, `2C-ii SCHEMA APPLIED OK`, temp script deleted (do NOT commit it).

- [ ] **Step 5: Commit**
```bash
git add lib/db/src/schema/partner-payments.ts lib/db/src/schema/index.ts
git commit -m "feat(db): partner_payments table"
```

---

## Task 2: OpenAPI + codegen

**Files:** Modify `lib/api-spec/openapi.yaml`; regenerate. READ the file around the partner-bills section (~line 2781) and the payments paths (~line 1158) to match real conventions before editing.

- [ ] **Step 1: Add tag** (in the top-level `tags:` list, after `partner-bills`): 
```yaml
  - { name: partner-payments, description: Disbursements to partners }
```

- [ ] **Step 2: Add paths** (place after the `/partner-bills/{id}` path block):
```yaml
  /partner-payments:
    get:
      operationId: listPartnerPayments
      tags: [partner-payments]
      responses:
        "200":
          description: List of partner payments
          content:
            application/json:
              schema: { type: array, items: { $ref: "#/components/schemas/PartnerPayment" } }
    post:
      operationId: createPartnerPayment
      tags: [partner-payments]
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/PartnerPaymentInput" }
      responses:
        "201":
          description: Created
          content:
            application/json:
              schema: { $ref: "#/components/schemas/PartnerPayment" }
  /partner-payments/{id}:
    patch:
      operationId: updatePartnerPayment
      tags: [partner-payments]
      parameters: [ { name: id, in: path, required: true, schema: { type: integer } } ]
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/PartnerPaymentInput" }
      responses:
        "200":
          description: Updated
          content:
            application/json:
              schema: { $ref: "#/components/schemas/PartnerPayment" }
    delete:
      operationId: deletePartnerPayment
      tags: [partner-payments]
      parameters: [ { name: id, in: path, required: true, schema: { type: integer } } ]
      responses:
        "204": { description: Deleted }
  /partner-payments/{id}/status:
    patch:
      operationId: updatePartnerPaymentStatus
      tags: [partner-payments]
      parameters: [ { name: id, in: path, required: true, schema: { type: integer } } ]
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/PartnerPaymentStatusInput" }
      responses:
        "200":
          description: Updated
          content:
            application/json:
              schema: { $ref: "#/components/schemas/PartnerPayment" }
```

- [ ] **Step 3: Add component schemas** (place after the `PartnerBill` schema, ~line 2814):
```yaml
    PartnerPaymentInput:
      type: object
      required: [partnerBillId, amount, mode]
      properties:
        partnerBillId: { type: integer }
        sourceClientPaymentId: { type: ["integer", "null"] }
        amount: { type: number }
        mode: { type: string }
        status: { type: string }
        paymentDate: { type: ["string", "null"] }
        attachmentUrl: { type: ["string", "null"] }
        notes: { type: ["string", "null"] }
    PartnerPayment:
      type: object
      required: [id, partnerId, partnerName, partnerBillId, partnerBillCode, amount, status, createdAt]
      properties:
        id: { type: integer }
        partnerId: { type: integer }
        partnerName: { type: string }
        partnerBillId: { type: integer }
        partnerBillCode: { type: string }
        clientId: { type: ["integer", "null"] }
        clientName: { type: ["string", "null"] }
        sourceClientPaymentId: { type: ["integer", "null"] }
        sourceClientPaymentLabel: { type: ["string", "null"] }
        amount: { type: number }
        mode: { type: ["string", "null"] }
        status: { type: string }
        paymentDate: { type: ["string", "null"] }
        attachmentUrl: { type: ["string", "null"] }
        notes: { type: ["string", "null"] }
        createdByName: { type: ["string", "null"] }
        createdAt: { type: string }
    PartnerPaymentStatusInput:
      type: object
      required: [status]
      properties:
        status: { type: string, enum: [pending, settled] }
```

- [ ] **Step 4: Add `amountPaid` to the existing `PartnerBill` schema** — in the `PartnerBill` block (~line 2794), add `amountPaid` to `required` and to `properties`:
  - Change the `required:` line to include `amountPaid`:
    ```yaml
      required: [id, code, partnerId, partnerName, amount, amountPaid, createdAt]
    ```
  - Add under `properties:` (right after the `amount: { type: number }` line):
    ```yaml
        amountPaid: { type: number }
    ```

- [ ] **Step 5: Codegen + verify + commit**
```bash
pnpm --filter @workspace/api-spec codegen
```
Verify the hooks + types generated:
```bash
grep -n "useListPartnerPayments\|useCreatePartnerPayment\|useUpdatePartnerPaymentStatus" lib/api-client-react/src/generated/api.ts
ls lib/api-zod/src/generated/types/partnerPayment*.ts
grep -n "amountPaid" lib/api-zod/src/generated/types/partnerBill.ts
```
Expected: the three hooks present; `partnerPayment.ts` + `partnerPaymentInput.ts` exist; `amountPaid` in `partnerBill.ts`.
```bash
git add lib/api-spec/openapi.yaml lib/api-zod/src/generated lib/api-client-react/src/generated
git commit -m "feat(spec): partner-payments endpoints + PartnerBill.amountPaid"
```

---

## Task 3: Partner payments API + `mapPartnerBill` amountPaid

**Files:** Create `app/app/api/partner-payments/route.ts`, `partner-payments/[id]/route.ts`, `partner-payments/[id]/status/route.ts`; Modify `app/app/api/partner-bills/route.ts`

- [ ] **Step 1: Create `app/app/api/partner-payments/route.ts`**

```typescript
import { NextResponse } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import {
  db, partnerPaymentsTable, partnerBillsTable, partnersTable, clientsTable, paymentsTable, usersTable,
} from "@workspace/db";
import { CreatePartnerPaymentBody } from "@workspace/api-zod";
import { getSession } from "@/lib/auth/session";

export const runtime = "nodejs";

type Row = typeof partnerPaymentsTable.$inferSelect;

function fmtUsd(n: number) { return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export async function mapPartnerPayment(r: Row) {
  const [partner] = await db.select({ name: partnersTable.name }).from(partnersTable).where(eq(partnersTable.id, r.partnerId));
  const [bill] = await db.select({ code: partnerBillsTable.code, clientId: partnerBillsTable.clientId })
    .from(partnerBillsTable).where(eq(partnerBillsTable.id, r.partnerBillId));
  const client = bill?.clientId
    ? (await db.select({ name: clientsTable.name }).from(clientsTable).where(eq(clientsTable.id, bill.clientId)))[0]
    : null;
  let sourceClientPaymentLabel: string | null = null;
  if (r.sourceClientPaymentId != null) {
    const [src] = await db.select({ id: paymentsTable.id, total: paymentsTable.totalAmount, date: paymentsTable.paymentDate })
      .from(paymentsTable).where(eq(paymentsTable.id, r.sourceClientPaymentId));
    if (src) sourceClientPaymentLabel = `#${src.id} · PKR ${fmtUsd(Number(src.total))}${src.date ? " · " + src.date : ""}`;
  }
  let createdByName: string | null = null;
  if (r.createdById != null) {
    const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, r.createdById));
    createdByName = u?.name ?? null;
  }
  return {
    id: r.id, partnerId: r.partnerId, partnerName: partner?.name ?? "—",
    partnerBillId: r.partnerBillId, partnerBillCode: bill?.code ?? "—",
    clientId: bill?.clientId ?? null, clientName: client?.name ?? null,
    sourceClientPaymentId: r.sourceClientPaymentId ?? null, sourceClientPaymentLabel,
    amount: Number(r.amount), mode: r.mode ?? null, status: r.status,
    paymentDate: r.paymentDate ?? null, attachmentUrl: r.attachmentUrl ?? null,
    notes: r.notes ?? null, createdByName, createdAt: r.createdAt.toISOString(),
  };
}

// Remaining USD that can still be allocated to a bill: bill.amount − Σ(all partner payments to it),
// optionally excluding one payment id (when editing that payment). Matches the client rule where
// over-allocation validation counts ALL allocations (pending + settled) so two payments can't
// jointly over-promise a bill, while paid/progress/aging count only settled.
export async function billRemaining(partnerBillId: number, excludePaymentId?: number): Promise<{ amount: number; remaining: number } | null> {
  const [bill] = await db.select({ amount: partnerBillsTable.amount }).from(partnerBillsTable).where(eq(partnerBillsTable.id, partnerBillId));
  if (!bill) return null;
  const rows = await db.select({ amt: partnerPaymentsTable.amount }).from(partnerPaymentsTable)
    .where(excludePaymentId != null
      ? and(eq(partnerPaymentsTable.partnerBillId, partnerBillId), ne(partnerPaymentsTable.id, excludePaymentId))
      : eq(partnerPaymentsTable.partnerBillId, partnerBillId));
  const allocated = rows.reduce((s, x) => s + Number(x.amt), 0);
  return { amount: Number(bill.amount), remaining: Number(bill.amount) - allocated };
}

// Validate the funding client payment exists and is `received`. Returns an error string or null.
export async function validateSource(sourceClientPaymentId: number | null | undefined): Promise<string | null> {
  if (sourceClientPaymentId == null) return null;
  const [src] = await db.select({ status: paymentsTable.status }).from(paymentsTable).where(eq(paymentsTable.id, sourceClientPaymentId));
  if (!src) return "Funding client payment not found";
  if (src.status !== "received") return "Funding client payment must be received first";
  return null;
}

export async function GET(): Promise<Response> {
  const rows = await db.select().from(partnerPaymentsTable).orderBy(partnerPaymentsTable.createdAt);
  return NextResponse.json(await Promise.all(rows.map(mapPartnerPayment)));
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = CreatePartnerPaymentBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  const [bill] = await db.select({ partnerId: partnerBillsTable.partnerId }).from(partnerBillsTable).where(eq(partnerBillsTable.id, parsed.data.partnerBillId));
  if (!bill) return NextResponse.json({ error: "Partner bill not found" }, { status: 400 });

  const srcErr = await validateSource(parsed.data.sourceClientPaymentId);
  if (srcErr) return NextResponse.json({ error: srcErr }, { status: 400 });

  const rem = await billRemaining(parsed.data.partnerBillId);
  if (!rem) return NextResponse.json({ error: "Partner bill not found" }, { status: 400 });
  if (parsed.data.amount > rem.remaining + 0.01) {
    return NextResponse.json({ error: `Amount exceeds remaining USD ${rem.remaining.toFixed(2)} on this bill` }, { status: 400 });
  }

  const user = await getSession();
  const [row] = await db.insert(partnerPaymentsTable).values({
    partnerId: bill.partnerId,
    partnerBillId: parsed.data.partnerBillId,
    sourceClientPaymentId: parsed.data.sourceClientPaymentId ?? null,
    amount: String(parsed.data.amount),
    mode: parsed.data.mode ?? null,
    status: parsed.data.status ?? "pending",
    attachmentUrl: parsed.data.attachmentUrl ?? null,
    paymentDate: parsed.data.paymentDate ?? null,
    notes: parsed.data.notes ?? null,
    createdById: user?.sub ?? null,
  }).returning();
  return NextResponse.json(await mapPartnerPayment(row), { status: 201 });
}
```
NOTE on `ne` import: `ne` (not-equal) is a standard drizzle-orm operator; confirm it's importable (`import { ne } from "drizzle-orm"`). It is.

- [ ] **Step 2: Create `app/app/api/partner-payments/[id]/route.ts`**

```typescript
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, partnerPaymentsTable, partnerBillsTable } from "@workspace/db";
import { UpdatePartnerPaymentBody } from "@workspace/api-zod";
import { mapPartnerPayment, billRemaining, validateSource } from "../route";

export const runtime = "nodejs";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const paymentId = Number(id);
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = UpdatePartnerPaymentBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  const [bill] = await db.select({ partnerId: partnerBillsTable.partnerId }).from(partnerBillsTable).where(eq(partnerBillsTable.id, parsed.data.partnerBillId));
  if (!bill) return NextResponse.json({ error: "Partner bill not found" }, { status: 400 });

  const srcErr = await validateSource(parsed.data.sourceClientPaymentId);
  if (srcErr) return NextResponse.json({ error: srcErr }, { status: 400 });

  const rem = await billRemaining(parsed.data.partnerBillId, paymentId);
  if (!rem) return NextResponse.json({ error: "Partner bill not found" }, { status: 400 });
  if (parsed.data.amount > rem.remaining + 0.01) {
    return NextResponse.json({ error: `Amount exceeds remaining USD ${rem.remaining.toFixed(2)} on this bill` }, { status: 400 });
  }

  const [row] = await db.update(partnerPaymentsTable).set({
    partnerId: bill.partnerId,
    partnerBillId: parsed.data.partnerBillId,
    sourceClientPaymentId: parsed.data.sourceClientPaymentId ?? null,
    amount: String(parsed.data.amount),
    mode: parsed.data.mode ?? null,
    attachmentUrl: parsed.data.attachmentUrl ?? null,
    paymentDate: parsed.data.paymentDate ?? null,
    notes: parsed.data.notes ?? null,
  }).where(eq(partnerPaymentsTable.id, paymentId)).returning();
  if (!row) return NextResponse.json({ error: "Partner payment not found" }, { status: 404 });
  return NextResponse.json(await mapPartnerPayment(row));
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const [row] = await db.delete(partnerPaymentsTable).where(eq(partnerPaymentsTable.id, Number(id))).returning();
  if (!row) return NextResponse.json({ error: "Partner payment not found" }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
```
(PATCH deliberately does NOT change `status` — status is owned by the dedicated status route, mirroring client payments. Editing a payment keeps its current status.)

- [ ] **Step 3: Create `app/app/api/partner-payments/[id]/status/route.ts`**

```typescript
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, partnerPaymentsTable } from "@workspace/db";
import { UpdatePartnerPaymentStatusBody } from "@workspace/api-zod";
import { mapPartnerPayment } from "../../route";

export const runtime = "nodejs";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = UpdatePartnerPaymentStatusBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const [row] = await db.update(partnerPaymentsTable).set({ status: parsed.data.status })
    .where(eq(partnerPaymentsTable.id, Number(id))).returning();
  if (!row) return NextResponse.json({ error: "Partner payment not found" }, { status: 404 });
  return NextResponse.json(await mapPartnerPayment(row));
}
```

- [ ] **Step 4: Modify `app/app/api/partner-bills/route.ts` — add `amountPaid` (Σ settled partner payments)**

READ the current file. Make these edits:
1. Add `partnerPaymentsTable` to the `@workspace/db` import (the import already pulls several tables + `db`).
2. In `mapPartnerBill`, just before the `return { … }`, compute the settled total:
```typescript
  const paidRows = await db.select({ amt: partnerPaymentsTable.amount }).from(partnerPaymentsTable)
    .where(and(eq(partnerPaymentsTable.partnerBillId, r.id), eq(partnerPaymentsTable.status, "settled")));
  const amountPaid = paidRows.reduce((s, x) => s + Number(x.amt), 0);
```
   (`and` and `eq` are already imported in this file.)
3. Add `amountPaid,` to the returned object (e.g. right after `amount: Number(r.amount),`).

- [ ] **Step 5: Verify + commit**

Run: `cd app && pnpm typecheck`
Expected: 0 errors.
```bash
git add app/app/api/partner-payments app/app/api/partner-bills/route.ts
git commit -m "feat(api): partner-payments CRUD + status; partner-bill amountPaid from settled"
```

---

## Task 4: Partner payment status control + Partner Billing progress bar

**Files:** Create `app/components/payments/PartnerPaymentStatusSelect.tsx`; Modify `app/components/billings/PartnerBillingTab.tsx`

- [ ] **Step 1: Create `app/components/payments/PartnerPaymentStatusSelect.tsx`**

```tsx
"use client";

import {
  useUpdatePartnerPaymentStatus,
  getListPartnerPaymentsQueryKey,
  getListPartnerBillsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const COLORS: Record<string, string> = {
  pending: "text-yellow-700 dark:text-yellow-400",
  settled: "text-emerald-700 dark:text-emerald-400",
};

export function PartnerPaymentStatusSelect({ paymentId, status }: { paymentId: number; status: string }) {
  const qc = useQueryClient();
  const mut = useUpdatePartnerPaymentStatus({ mutation: {
    onSuccess: () => {
      // settling advances the bill's paid/progress/aging, so refresh both lists
      qc.invalidateQueries({ queryKey: getListPartnerPaymentsQueryKey() });
      qc.invalidateQueries({ queryKey: getListPartnerBillsQueryKey() });
    },
  }});
  return (
    <Select value={status} onValueChange={v => mut.mutate({ id: paymentId, data: { status: v as "pending" | "settled" } })}>
      <SelectTrigger className={cn("h-7 w-28 text-xs capitalize", COLORS[status])}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="pending">Pending</SelectItem>
        <SelectItem value="settled">Settled</SelectItem>
      </SelectContent>
    </Select>
  );
}
```

- [ ] **Step 2: Add Paid / Pending / Progress columns + settled aging to `PartnerBillingTab.tsx`**

READ the current `app/components/billings/PartnerBillingTab.tsx` (from 2C-i). Make these edits, mirroring the client Summary progress (`ClientBillingSummaryTab.tsx`):

1. Add imports at the top (with the other UI imports):
```tsx
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
```
2. Add the shared pay-status style/label maps + a helper above the component (mirror `ClientBillingSummaryTab`):
```tsx
type PayStatus = "paid" | "partial" | "unpaid";
const PAY_STATUS_STYLES: Record<PayStatus, string> = {
  paid: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
  partial: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  unpaid: "bg-muted text-muted-foreground",
};
const PAY_STATUS_LABELS: Record<PayStatus, string> = { paid: "Paid", partial: "Partial", unpaid: "Unpaid" };
function billProgress(amount: number, amountPaid: number) {
  const pending = Math.max(0, amount - amountPaid);
  const pct = amount > 0 ? Math.min(100, (amountPaid / amount) * 100) : 0;
  const payStatus: PayStatus = pending <= 0.01 && amount > 0 ? "paid" : amountPaid > 0 ? "partial" : "unpaid";
  return { pending, pct, payStatus };
}
```
3. In the header `<th>` array, insert `"Paid (USD)"`, `"Pending (USD)"`, `"Progress"` **after** `"Amount (USD)"`. The full header array becomes:
```tsx
["#", "PBILL Code", "Partner", "Client", "Their Inv #", "Amount (USD)", "Paid (USD)", "Pending (USD)", "Progress", "Date Received", "Aging", "Attachment", "Actions"]
```
4. Update the skeleton + empty-state `colSpan` from `10` to `13` (there are now 13 columns), and the skeleton's inner `[...Array(10)]` to `[...Array(13)]`.
5. In the body row, right after the Amount `<td>` (`<td className="px-3 py-2 font-semibold">{fmt(b.amount)}</td>`), insert three cells (compute `const { pending, pct, payStatus } = billProgress(b.amount, b.amountPaid);` at the top of the `.map((b, i) => { … })` body — convert the arrow to a block body that `return`s the `<tr>`):
```tsx
<td className="px-3 py-2">{fmt(b.amountPaid)}</td>
<td className="px-3 py-2">{fmt(pending)}</td>
<td className="px-3 py-2">
  <div className="flex items-center gap-2 min-w-[110px]">
    <Progress value={pct} className="h-1.5 flex-1" />
    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap", PAY_STATUS_STYLES[payStatus])}>
      {PAY_STATUS_LABELS[payStatus]}
    </span>
  </div>
</td>
```
6. Change the Aging cell's `settled` from the hardcoded `false` to reflect full settlement:
```tsx
<td className="px-3 py-2"><AgingPill start={b.dateReceived ?? null} termDays={b.partnerTermDays ?? null} settled={b.amount > 0 && b.amountPaid >= b.amount - 0.01} /></td>
```
   (The 2C-i placeholder comment `Aging settled is false here — partner payments/settlement arrive in Phase 2C-ii` can be removed.)

- [ ] **Step 3: Verify + commit**

Run: `cd app && pnpm typecheck`
Expected: 0 errors.
```bash
git add app/components/payments/PartnerPaymentStatusSelect.tsx app/components/billings/PartnerBillingTab.tsx
git commit -m "feat(billing): partner-bill progress bar + settled aging; partner payment status select"
```

---

## Task 5: Create-partner-payment dialog + Partner Payments tab

**Files:** Create `app/components/payments/CreatePartnerPaymentDialog.tsx`, `app/components/payments/PartnerPaymentsTab.tsx`

- [ ] **Step 1: Create `app/components/payments/CreatePartnerPaymentDialog.tsx`**

```tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  useListPartnerBills, useListPartnerPayments, useListPayments,
  useCreatePartnerPayment, useUpdatePartnerPayment,
} from "@workspace/api-client-react";
import type { PartnerPayment } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

function fmt(n: number) { return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

async function uploadFile(file: File): Promise<string> {
  const fd = new FormData(); fd.append("file", file);
  const res = await fetch("/api/uploads/payment-attachment", { method: "POST", body: fd });
  if (!res.ok) throw new Error("Upload failed");
  const { url } = await res.json();
  return url as string;
}

export function CreatePartnerPaymentDialog({ open, editPayment, onClose, onSuccess }: {
  open: boolean; editPayment?: PartnerPayment; onClose: () => void; onSuccess: () => void;
}) {
  const { toast } = useToast();
  const { data: bills } = useListPartnerBills();
  const { data: partnerPayments } = useListPartnerPayments();
  const { data: clientPayments } = useListPayments();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const [partnerBillId, setPartnerBillId] = useState<number | null>(null);
  const [sourceClientPaymentId, setSourceId] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState("online");
  const [status, setStatus] = useState("pending");
  const [paymentDate, setPaymentDate] = useState("");
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (open && editPayment) {
      setPartnerBillId(editPayment.partnerBillId); setSourceId(editPayment.sourceClientPaymentId ?? null);
      setAmount(String(editPayment.amount)); setMode(editPayment.mode ?? "online"); setStatus(editPayment.status);
      setPaymentDate(editPayment.paymentDate ?? ""); setAttachmentUrl(editPayment.attachmentUrl ?? ""); setNotes(editPayment.notes ?? "");
    } else if (open) {
      setPartnerBillId(null); setSourceId(null); setAmount(""); setMode("online"); setStatus("pending");
      setPaymentDate(""); setAttachmentUrl(""); setNotes("");
    }
  }, [open, editPayment]);

  // Remaining USD per bill = bill.amount − Σ(all partner payments to it), excluding the one being edited.
  const remainingByBill = useMemo(() => {
    const allocated = new Map<number, number>();
    for (const p of partnerPayments ?? []) {
      if (editPayment && p.id === editPayment.id) continue;
      allocated.set(p.partnerBillId, (allocated.get(p.partnerBillId) ?? 0) + p.amount);
    }
    const m = new Map<number, number>();
    for (const b of bills ?? []) m.set(b.id, b.amount - (allocated.get(b.id) ?? 0));
    return m;
  }, [bills, partnerPayments, editPayment]);

  const receivedClientPayments = (clientPayments ?? []).filter(p => p.status === "received");
  const selectedRemaining = partnerBillId != null ? (remainingByBill.get(partnerBillId) ?? 0) : 0;
  const overAmount = amount.trim() !== "" && parseFloat(amount) > selectedRemaining + 0.01;

  const pickBill = (id: number) => {
    setPartnerBillId(id);
    const rem = remainingByBill.get(id) ?? 0;
    setAmount(rem > 0 ? String(Number(rem.toFixed(2))) : "0");
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    try { const url = await uploadFile(file); setAttachmentUrl(url); toast({ title: "File uploaded" }); }
    catch { toast({ title: "Upload failed", variant: "destructive" }); }
    finally { setUploading(false); }
  };

  const create = useCreatePartnerPayment({ mutation: {
    onSuccess: () => { onSuccess(); onClose(); toast({ title: "Partner payment recorded" }); },
    onError: () => toast({ title: "Failed to record payment", variant: "destructive" }),
  }});
  const update = useUpdatePartnerPayment({ mutation: {
    onSuccess: () => { onSuccess(); onClose(); toast({ title: "Partner payment updated" }); },
    onError: () => toast({ title: "Failed to update payment", variant: "destructive" }),
  }});

  const submit = () => {
    if (!partnerBillId || !sourceClientPaymentId || amount.trim() === "") {
      toast({ title: "Partner bill, funding payment, and amount are required", variant: "destructive" }); return;
    }
    if (overAmount) { toast({ title: "Amount exceeds the bill's remaining", variant: "destructive" }); return; }
    const data = {
      partnerBillId, sourceClientPaymentId, amount: parseFloat(amount), mode, status,
      paymentDate: paymentDate || null, attachmentUrl: attachmentUrl || null, notes: notes || null,
    };
    if (editPayment) update.mutate({ id: editPayment.id, data }); else create.mutate({ data });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{editPayment ? "Edit Partner Payment" : "Record Partner Payment"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <label className="text-xs space-y-1 block"><span className="text-muted-foreground">Partner Bill</span>
            <Select value={partnerBillId ? String(partnerBillId) : ""} onValueChange={v => pickBill(Number(v))}>
              <SelectTrigger><SelectValue placeholder="Select a partner bill" /></SelectTrigger>
              <SelectContent>
                {(bills ?? []).map(b => {
                  const rem = remainingByBill.get(b.id) ?? 0;
                  return <SelectItem key={b.id} value={String(b.id)} disabled={rem <= 0.01 && b.id !== editPayment?.partnerBillId}>
                    {b.code} · {b.partnerName} · rem ${fmt(rem)}
                  </SelectItem>;
                })}
              </SelectContent>
            </Select>
          </label>
          <label className="text-xs space-y-1 block"><span className="text-muted-foreground">Funding Client Payment (received)</span>
            <Select value={sourceClientPaymentId ? String(sourceClientPaymentId) : ""} onValueChange={v => setSourceId(Number(v))}>
              <SelectTrigger><SelectValue placeholder="Select a received client payment" /></SelectTrigger>
              <SelectContent>
                {receivedClientPayments.length === 0
                  ? <SelectItem value="none" disabled>No received client payments</SelectItem>
                  : receivedClientPayments.map(p => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      #{p.id} · PKR {fmt(p.totalAmount)}{p.paymentDate ? " · " + new Date(p.paymentDate).toLocaleDateString() : ""}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs space-y-1"><span className="text-muted-foreground">Amount (USD)</span>
              <Input type="number" step="0.01" min={0} value={amount} onChange={e => setAmount(e.target.value)}
                className={overAmount ? "border-red-600 focus-visible:ring-red-600" : undefined} />
              {partnerBillId != null && <span className="text-[10px] text-muted-foreground">Remaining: ${fmt(selectedRemaining)}</span>}
              {overAmount && <span className="text-[10px] text-red-600 block">Exceeds remaining</span>}
            </label>
            <label className="text-xs space-y-1"><span className="text-muted-foreground">Mode</span>
              <Select value={mode} onValueChange={setMode}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="online">Online Transfer</SelectItem>
                  <SelectItem value="cheque">Cheque</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                </SelectContent>
              </Select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs space-y-1"><span className="text-muted-foreground">Payment Date</span>
              <Input type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)} /></label>
            <label className="text-xs space-y-1"><span className="text-muted-foreground">Status</span>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="settled">Settled</SelectItem>
                </SelectContent>
              </Select>
            </label>
          </div>
          <label className="text-xs space-y-1 block"><span className="text-muted-foreground">Attachment</span>
            <div className="flex items-center gap-2">
              <Input type="file" accept="image/*,.pdf" ref={fileRef} disabled={uploading}
                onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0])} className="text-xs" />
              {attachmentUrl && <a href={attachmentUrl} target="_blank" rel="noreferrer" className="text-xs text-primary underline">View</a>}
            </div>
          </label>
          <Textarea rows={2} placeholder="Notes..." value={notes} onChange={e => setNotes(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={submit} disabled={create.isPending || update.isPending || uploading || overAmount}>
              {create.isPending || update.isPending ? "Saving..." : editPayment ? "Update" : "Record Payment"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```
VERIFY the generated hook mutate shapes (`useCreatePartnerPayment` → `{ data }`, `useUpdatePartnerPayment` → `{ id, data }`) and that `useListPayments()` rows expose `status`, `totalAmount`, `paymentDate` (they do — see `PaymentDetail`). Adapt if different.

- [ ] **Step 2: Create `app/components/payments/PartnerPaymentsTab.tsx`**

```tsx
"use client";

import { useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import {
  useListPartnerPayments, useDeletePartnerPayment,
  getListPartnerPaymentsQueryKey, getListPartnerBillsQueryKey,
} from "@workspace/api-client-react";
import type { PartnerPayment } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { PartnerPaymentStatusSelect } from "@/components/payments/PartnerPaymentStatusSelect";
import { CreatePartnerPaymentDialog } from "@/components/payments/CreatePartnerPaymentDialog";

function fmt(n: number) { return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export function PartnerPaymentsTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: payments, isLoading } = useListPartnerPayments();
  const [addOpen, setAddOpen] = useState(false);
  const [editPayment, setEditPayment] = useState<PartnerPayment | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: getListPartnerPaymentsQueryKey() });
    qc.invalidateQueries({ queryKey: getListPartnerBillsQueryKey() });
  };
  const del = useDeletePartnerPayment({ mutation: {
    onSuccess: () => { refresh(); toast({ title: "Partner payment deleted" }); },
    onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
  }});

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{payments?.length ?? 0} partner payments</p>
        <Button size="sm" className="gap-1.5 text-xs" onClick={() => setAddOpen(true)}><Plus className="h-3.5 w-3.5" /> Record Partner Payment</Button>
      </div>
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-x-auto">
        <table className="w-full min-w-max">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {["#", "Partner", "Client", "Partner Bill", "Funding Payment", "Amount (USD)", "Mode", "Status", "Date", "Attachment", "Actions"].map(h => (
                <th key={h} className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(3)].map((_, i) => <tr key={i} className="border-b border-border">{[...Array(11)].map((_, j) => <td key={j} className="px-3 py-2"><Skeleton className="h-3 w-16" /></td>)}</tr>)
            ) : !payments?.length ? (
              <tr><td colSpan={11} className="px-5 py-10 text-center text-sm text-muted-foreground">No partner payments yet</td></tr>
            ) : payments.map((p, i) => (
              <tr key={p.id} className="border-b border-border last:border-0 hover:bg-muted/20 text-xs">
                <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                <td className="px-3 py-2">{p.partnerName}</td>
                <td className="px-3 py-2">{p.clientName ?? "—"}</td>
                <td className="px-3 py-2 font-semibold">{p.partnerBillCode}</td>
                <td className="px-3 py-2">{p.sourceClientPaymentLabel ?? "—"}</td>
                <td className="px-3 py-2 font-semibold">{fmt(p.amount)}</td>
                <td className="px-3 py-2 capitalize">{p.mode ?? "—"}</td>
                <td className="px-3 py-2"><PartnerPaymentStatusSelect paymentId={p.id} status={p.status} /></td>
                <td className="px-3 py-2">{p.paymentDate ? new Date(p.paymentDate).toLocaleDateString() : "—"}</td>
                <td className="px-3 py-2">{p.attachmentUrl ? <a href={p.attachmentUrl} target="_blank" rel="noreferrer" className="text-primary underline text-[10px]">View</a> : "—"}</td>
                <td className="px-3 py-2">
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setEditPayment(p)}><Pencil className="h-3 w-3" /></Button>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-red-600" onClick={() => { if (confirm("Delete this partner payment?")) del.mutate({ id: p.id }); }}><Trash2 className="h-3 w-3" /></Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <CreatePartnerPaymentDialog open={addOpen || editPayment != null} editPayment={editPayment ?? undefined}
        onClose={() => { setAddOpen(false); setEditPayment(null); }}
        onSuccess={refresh} />
    </div>
  );
}
```

- [ ] **Step 3: Verify + commit**

Run: `cd app && pnpm typecheck`
Expected: 0 errors.
```bash
git add app/components/payments/CreatePartnerPaymentDialog.tsx app/components/payments/PartnerPaymentsTab.tsx
git commit -m "feat(payments): partner payment dialog + Partner Payments tab"
```

---

## Task 6: Payments Client/Partner tabs shell

**Files:** Create `app/components/payments/ClientPaymentsTab.tsx`; Rewrite `app/app/(dashboard)/payments/page.tsx`

- [ ] **Step 1: Extract the existing Payments page body into `ClientPaymentsTab.tsx`**

READ `app/app/(dashboard)/payments/page.tsx`. Move EVERYTHING except the `PermissionGuard` wrapper and the outer `<h1>Payments</h1>` into `app/components/payments/ClientPaymentsTab.tsx`:
- Move the helper `fmtNum`, the `allocationSchema`/`paymentSchema`/`PaymentForm`, `uploadFile`, the `PaymentDialog` function, and all their imports into the new file.
- Export the page body as `export function ClientPaymentsTab() { … }` — SAME JSX/logic as the current default export, but:
  - Drop the `<PermissionGuard permission="View Payments">` wrapper (the shell owns it).
  - Drop the outer `<h1 className="text-xl font-bold text-foreground">Payments</h1>` (the shell owns the heading). KEEP the `<p>{payments?.length ?? 0} payments</p>` and the "Record Payment" button — restructure the header `<div className="flex items-center justify-between">` so the left side is just the count `<p>` (matching `ClientBillingSummaryTab`'s header).
- KEEP the `PaymentStatusSelect` usage, the table, the dialog, all mutations, and the query invalidations exactly as they are.

The result: `ClientPaymentsTab.tsx` is `"use client"`, self-contained, and renders the current client payments UI minus the guard/title.

- [ ] **Step 2: Rewrite `app/app/(dashboard)/payments/page.tsx` as the tabs shell**

```tsx
"use client";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PermissionGuard } from "@/components/PermissionGuard";
import { ClientPaymentsTab } from "@/components/payments/ClientPaymentsTab";
import { PartnerPaymentsTab } from "@/components/payments/PartnerPaymentsTab";

export default function PaymentsPage() {
  return (
    <PermissionGuard permission="View Payments">
      <div className="space-y-4">
        <h1 className="text-xl font-bold text-foreground">Payments</h1>
        <Tabs defaultValue="client">
          <TabsList>
            <TabsTrigger value="client">Client</TabsTrigger>
            <TabsTrigger value="partner">Partner</TabsTrigger>
          </TabsList>
          <TabsContent value="client"><ClientPaymentsTab /></TabsContent>
          <TabsContent value="partner"><PartnerPaymentsTab /></TabsContent>
        </Tabs>
      </div>
    </PermissionGuard>
  );
}
```

- [ ] **Step 3: Verify + commit**

Run: `cd app && pnpm typecheck` → 0 errors. `pnpm vitest run` → all pass.
Load `/payments`: top tabs **Client | Partner**; Client shows the existing receipts UI (unchanged); Partner shows the Partner Payments table + "Record Partner Payment". Record a partner payment against a bill, toggle it to **Settled**, and confirm the Partner Billing list's Paid/Pending/Progress and aging update.
```bash
git add app/components/payments/ClientPaymentsTab.tsx app/app/\(dashboard\)/payments/page.tsx
git commit -m "feat(payments): Client/Partner tabs shell"
```

---

## Self-Review checklist

- **Spec coverage (2C-ii):** `partner_payments` schema/migration (T1) · openapi/codegen + `PartnerBill.amountPaid` (T2) · partner-payments CRUD + status routes + over-allocation validation + received-source validation + `mapPartnerBill` settled `amountPaid` (T3) · `PartnerPaymentStatusSelect` (pending↔settled) + Partner Billing progress bar + settled aging (T4) · create-partner-payment dialog (bill→funding received payment→amount≤remaining→mode/date/attachment/status) + Partner Payments tab (T5) · Payments Client/Partner tabs shell (T6). Nav item `/payments` unchanged (spec §Navigation — the page is tabbed internally, mirroring 2C-i's Billing shell).
- **Placeholder scan:** none — complete code; UI-extraction step (T6) instructs reading + moving the exact existing code.
- **Type consistency:** `mapPartnerPayment` return shape matches the `PartnerPayment` openapi schema (partnerName, partnerBillCode, clientName, sourceClientPaymentLabel, status). `billRemaining`/`validateSource` are imported by both `[id]/route.ts` and reused in `route.ts`; `mapPartnerPayment` imported by `[id]/route.ts` and `[id]/status/route.ts`. `amountPaid` added to `PartnerBill` (T2) is produced by `mapPartnerBill` (T3) and consumed by `PartnerBillingTab` `billProgress` (T4). Status enums: client `pending|received`, partner `pending|settled` (distinct, matches spec). Over-allocation basis: validation counts ALL partner payments (`billRemaining`); paid/progress/aging count only `settled` (`mapPartnerBill.amountPaid`).
- **Invalidation:** settling/creating/deleting a partner payment invalidates BOTH `getListPartnerPaymentsQueryKey()` and `getListPartnerBillsQueryKey()` so the bill progress bar + aging refresh live (T4 status select, T5 tab + dialog onSuccess).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-12-billing-phase2c-ii.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, two-stage review.
2. **Inline Execution** — run tasks here with checkpoints.

This completes Phase 2C (and Phase 2). After 2C-ii merges, the billing subsystem has full Client + Partner symmetry on both Billing and Payments.
