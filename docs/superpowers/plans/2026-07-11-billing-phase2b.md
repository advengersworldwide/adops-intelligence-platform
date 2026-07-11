# Billing Phase 2B — Payment Status + Terms/Days + Client Aging — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a payment **status** lifecycle (Pending → Received; paid totals/progress/aging count only received), give payment terms a **days** duration, and show a color-coded **aging** indicator on the Billing Summary (green → yellow → red from the invoice date per the client's terms).

**Architecture:** DB-first — schema (`payment_terms.days`, `payments.status`) → deterministic raw-DDL migration + backfill → OpenAPI + codegen → API routes (payment status endpoint; `mapBilling` counts only received + returns term days) → UI (terms `days` input, a payment `StatusSelect`, Summary aging pill). A pure `app/lib/aging.ts` util (TDD) holds the color/days-left rule and is reused by client billing now and partner billing in Phase 2C.

**Tech Stack:** PostgreSQL + Drizzle, Next.js 15, OpenAPI 3.1 + orval, React Query, shadcn/ui, vitest, `pg`.

**Spec:** `docs/superpowers/specs/2026-07-11-billing-phase2-design.md` (Phase 2B + shared aging model).

---

## File Structure

- **Create** `app/lib/aging.ts` (+ `aging.test.ts`) — pure aging rule.
- **Modify** `lib/db/src/schema/payment-terms.ts` (+ `days`), `lib/db/src/schema/payments.ts` (+ `status`).
- **Create** `app/app/api/payments/[id]/status/route.ts` — PATCH payment status.
- **Modify** `lib/api-spec/openapi.yaml` (+ codegen) — term `days`, payment `status`, `updatePaymentStatus`, billing `paymentTermDays`.
- **Modify** `app/app/api/payments/route.ts` + `[id]/route.ts` — persist/return `status`.
- **Modify** `app/app/api/billings/route.ts` — `amountPaid` counts only received; return `paymentTermDays`.
- **Modify** `app/app/(dashboard)/settings/page.tsx` — terms `days` input.
- **Create** `app/components/payments/PaymentStatusSelect.tsx`; **Modify** `app/app/(dashboard)/payments/page.tsx` — status column + control.
- **Modify** `app/app/(dashboard)/billings/summary/page.tsx` — aging pill column.

Work happens in a dedicated worktree off `main` (created before Task 1).

---

## Task 1: Aging util (TDD)

**Files:** Create `app/lib/aging.ts`, `app/lib/aging.test.ts`

- [ ] **Step 1: Write the failing test** — `app/lib/aging.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { computeAging } from "./aging";

const now = new Date("2026-02-01T00:00:00Z");
const d = (s: string) => new Date(s + "T00:00:00Z");

describe("computeAging", () => {
  it("neutral when settled", () => {
    expect(computeAging({ start: d("2026-01-01"), termDays: 30, now, settled: true }).color).toBe("neutral");
  });
  it("neutral when no term days", () => {
    expect(computeAging({ start: d("2026-01-01"), termDays: null, now, settled: false }).color).toBe("neutral");
  });
  it("neutral when no start", () => {
    expect(computeAging({ start: null, termDays: 30, now, settled: false }).color).toBe("neutral");
  });
  it("green at/under half term", () => {
    const r = computeAging({ start: d("2026-01-22"), termDays: 30, now, settled: false }); // elapsed 10
    expect(r.color).toBe("green"); expect(r.daysLeft).toBe(20); expect(r.overdue).toBe(false);
  });
  it("yellow past half, not overdue", () => {
    const r = computeAging({ start: d("2026-01-12"), termDays: 30, now, settled: false }); // elapsed 20
    expect(r.color).toBe("yellow"); expect(r.daysLeft).toBe(10); expect(r.overdue).toBe(false);
  });
  it("red once overdue (negative daysLeft)", () => {
    const r = computeAging({ start: d("2025-12-23"), termDays: 30, now, settled: false }); // elapsed 40
    expect(r.color).toBe("red"); expect(r.overdue).toBe(true); expect(r.daysLeft).toBe(-10);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `cd app && pnpm vitest run lib/aging.test.ts` → FAIL (cannot find `./aging`).

- [ ] **Step 3: Implement `app/lib/aging.ts`**

```typescript
// Shared aging rule for receivable/payable due-date indicators.
// green while elapsed <= half the term, yellow past half, red once overdue.
export interface AgingInput {
  start: Date | null;
  termDays: number | null;
  now: Date;
  settled: boolean;
}
export interface AgingResult {
  daysLeft: number | null;
  color: "green" | "yellow" | "red" | "neutral";
  overdue: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function computeAging({ start, termDays, now, settled }: AgingInput): AgingResult {
  if (settled || !start || termDays == null) {
    return { daysLeft: null, color: "neutral", overdue: false };
  }
  const elapsed = Math.floor((now.getTime() - start.getTime()) / DAY_MS);
  const daysLeft = termDays - elapsed;
  const overdue = elapsed > termDays;
  const color = overdue ? "red" : elapsed > termDays / 2 ? "yellow" : "green";
  return { daysLeft, color, overdue };
}
```

- [ ] **Step 4: Run the test — verify it passes**

Run: `cd app && pnpm vitest run lib/aging.test.ts` → 6 passing.

- [ ] **Step 5: Commit**

```bash
git add app/lib/aging.ts app/lib/aging.test.ts
git commit -m "feat(aging): shared computeAging util (green/yellow/red) with tests"
```

---

## Task 2: Schema + migration (`payment_terms.days`, `payments.status`)

**Files:** Modify `lib/db/src/schema/payment-terms.ts`, `lib/db/src/schema/payments.ts`

- [ ] **Step 1: Add `days` to `payment-terms.ts`**

Add to the `pgTable("payment_terms", { … })` (import `integer` from `drizzle-orm/pg-core`):
```typescript
  days: integer("days"),
```

- [ ] **Step 2: Add `status` to `payments.ts`**

READ the file. Add to the `pgTable("payments", { … })`:
```typescript
  status: text("status").notNull().default("pending"),
```
(`text` is already imported.)

- [ ] **Step 3: Typecheck the db package**

Run: `pnpm -w run typecheck:libs` → 0 errors.

- [ ] **Step 4: Apply the migration to the dev DB (deterministic raw DDL)**

Create `lib/db/_apply-2b.mjs` (temporary; delete after):
```javascript
import pg from "pg";
const { Client } = pg;
const DDL = `
ALTER TABLE payment_terms ADD COLUMN IF NOT EXISTS days integer;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';
-- All rows that exist now are historical receipts → mark them received.
UPDATE payments SET status = 'received';
`;
const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }
const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query(DDL);
const cols = await client.query(
  `SELECT table_name, column_name FROM information_schema.columns
   WHERE (table_name='payment_terms' AND column_name='days')
      OR (table_name='payments' AND column_name='status')`);
console.log("added:", cols.rows.map(r => `${r.table_name}.${r.column_name}`).join(", "));
const [{ count }] = (await client.query(`SELECT count(*) FROM payments WHERE status='received'`)).rows;
console.log("payments backfilled to received:", count);
await client.end();
console.log("2B SCHEMA APPLIED OK");
```
Run from the worktree root, loading `DATABASE_URL` from `.env`:
```bash
export DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | head -1 | sed -E 's/^DATABASE_URL=//; s/^"//; s/"$//')"
cd lib/db && node _apply-2b.mjs && rm _apply-2b.mjs
```
Expected: `added: payment_terms.days, payments.status`, a backfill count, `2B SCHEMA APPLIED OK`. Then the temp script is deleted (do NOT commit it).

- [ ] **Step 5: Commit the schema**

```bash
git add lib/db/src/schema/payment-terms.ts lib/db/src/schema/payments.ts
git commit -m "feat(db): payment_terms.days + payments.status (backfilled received)"
```

---

## Task 3: OpenAPI + codegen

**Files:** Modify `lib/api-spec/openapi.yaml`; regenerate.

READ the file; adapt to the real schema/operation names (as in Phase 1).

- [ ] **Step 1: Payment terms `days`** — in `PaymentTerm` and `PaymentTermInput` schemas add:
```yaml
        days: { type: ["integer", "null"] }
```

- [ ] **Step 2: Payment `status`** — in `PaymentDetail` and `PaymentInput` add:
```yaml
        status: { type: string }
```

- [ ] **Step 3: New status endpoint path**
```yaml
  /payments/{id}/status:
    patch:
      operationId: updatePaymentStatus
      tags: [payments]
      parameters:
        - { name: id, in: path, required: true, schema: { type: integer } }
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/PaymentStatusInput" }
      responses:
        "200":
          description: Updated payment
          content:
            application/json:
              schema: { $ref: "#/components/schemas/PaymentDetail" }
```
Add component schema:
```yaml
    PaymentStatusInput:
      type: object
      required: [status]
      properties:
        status: { type: string, enum: [pending, received] }
```

- [ ] **Step 4: Billing `paymentTermDays`** — in `BillingSummary` properties add (not required):
```yaml
        paymentTermDays: { type: ["integer", "null"] }
```

- [ ] **Step 5: Codegen + verify + commit**

```bash
pnpm --filter @workspace/api-spec codegen
```
Verify: `grep -n "useUpdatePaymentStatus" lib/api-client-react/src/generated/api.ts` and `grep -n "paymentTermDays\|\"days\"\|status" lib/api-zod/src/generated/types/paymentDetail.ts lib/api-zod/src/generated/types/paymentTerm.ts lib/api-zod/src/generated/types/billingSummary.ts`. Expect matches.
```bash
git add lib/api-spec/openapi.yaml lib/api-zod/src/generated lib/api-client-react/src/generated
git commit -m "feat(spec): payment status + term days + updatePaymentStatus"
```

---

## Task 4: Payments API — persist/return status + status endpoint

**Files:** Modify `app/app/api/payments/route.ts`, `app/app/api/payments/[id]/route.ts`; Create `app/app/api/payments/[id]/status/route.ts`

- [ ] **Step 1: `mapPayment` returns `status`** — in BOTH `payments/route.ts` and `payments/[id]/route.ts`, add `status: p.status` to the object `mapPayment` returns (next to `paymentDate`).

- [ ] **Step 2: POST + PATCH persist status** — in `payments/route.ts` POST `.values({...})` add `status: parsed.data.status ?? "pending"`. In `payments/[id]/route.ts` PATCH `.set({...})` add `status: parsed.data.status ?? "pending"` (only if the body carries it; keep the rest unchanged). Over-allocation validation stays as-is (it already counts ALL allocations).

- [ ] **Step 3: Create `app/app/api/payments/[id]/status/route.ts`**

```typescript
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, paymentsTable, paymentBillingsTable, billingsTable } from "@workspace/db";
import { UpdatePaymentStatusBody } from "@workspace/api-zod";

export const runtime = "nodejs";

async function mapPayment(p: typeof paymentsTable.$inferSelect) {
  const pbRows = await db.select().from(paymentBillingsTable)
    .innerJoin(billingsTable, eq(paymentBillingsTable.billingId, billingsTable.id))
    .where(eq(paymentBillingsTable.paymentId, p.id));
  const allocations = pbRows.map(({ payment_billings: pb, billings: bl }) => ({
    billingId: pb.billingId, billingLabel: bl.invoiceCode ?? `Billing #${bl.id}`, amountApplied: Number(pb.amountApplied),
  }));
  return {
    id: p.id, mode: p.mode, totalAmount: Number(p.totalAmount), notes: p.notes ?? null,
    chequeImageUrl: p.chequeImageUrl ?? null, receiptUrl: p.receiptUrl ?? null,
    paymentDate: p.paymentDate ?? null, status: p.status, createdBy: p.createdBy ?? null,
    createdAt: p.createdAt.toISOString(), allocations,
  };
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = UpdatePaymentStatusBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const [p] = await db.update(paymentsTable).set({ status: parsed.data.status })
    .where(eq(paymentsTable.id, Number(id))).returning();
  if (!p) return NextResponse.json({ error: "Payment not found" }, { status: 404 });
  return NextResponse.json(await mapPayment(p));
}
```

- [ ] **Step 4: Verify + commit**

Run: `cd app && pnpm typecheck` → 0 errors.
```bash
git add app/app/api/payments
git commit -m "feat(payments): status field + PATCH /payments/{id}/status endpoint"
```

---

## Task 5: Billings API — received-only paid + term days

**Files:** Modify `app/app/api/billings/route.ts`

- [ ] **Step 1: `amountPaid` counts only received payments**

READ `mapBilling`. Its `amountPaid` currently sums `paymentBillingsTable.amountApplied` for the billing. Change that query to join `paymentsTable` and filter `status = 'received'`:
```typescript
import { and } from "drizzle-orm"; // ensure imported
import { paymentsTable } from "@workspace/db"; // ensure imported
// ...
const paidRows = await db.select({ amt: paymentBillingsTable.amountApplied })
  .from(paymentBillingsTable)
  .innerJoin(paymentsTable, eq(paymentBillingsTable.paymentId, paymentsTable.id))
  .where(and(eq(paymentBillingsTable.billingId, b.id), eq(paymentsTable.status, "received")));
const amountPaid = paidRows.reduce((s, r) => s + Number(r.amt), 0);
```
(`billingNetReceivable` is unchanged — it's the receivable, independent of payments.)

- [ ] **Step 2: Return `paymentTermDays`**

`mapBilling` already resolves the client's payment term name via `client.paymentTermsId` → `paymentTermsTable`. Extend that select to also fetch `days`, and add to the returned object:
```typescript
// where it selects the payment term:
const [pt] = await db.select({ name: paymentTermsTable.name, days: paymentTermsTable.days })
  .from(paymentTermsTable).where(eq(paymentTermsTable.id, client.paymentTermsId));
// ...
paymentTerms: pt?.name ?? null,
paymentTermDays: pt?.days ?? null,
```
(If the current code resolved paymentTerms slightly differently, adapt — the goal: the response includes `paymentTermDays: number | null`.)

- [ ] **Step 3: Verify + commit**

Run: `cd app && pnpm typecheck` → 0 errors. With the dev server, `curl -s localhost:<port>/api/billings` shows `paymentTermDays` on each billing and `amountPaid` reflecting only received payments (a billing whose only payment is still `pending` now shows `amountPaid: 0`).
```bash
git add app/app/api/billings/route.ts
git commit -m "feat(billing): amountPaid counts only received payments; return paymentTermDays"
```

---

## Task 6: Payment terms UI — add `days`

**Files:** Modify `app/app/(dashboard)/settings/page.tsx`

- [ ] **Step 1: Add a days input to the payment-terms editor**

READ `settings/page.tsx` — it manages payment terms (create/list, using `useCreatePaymentTerm`/`useListPaymentTerms`). Add a **Days** numeric input next to the term Name field, and include `days` in the create (and edit, if present) payload:
```tsx
// alongside the name input in the create form:
<Input type="number" min={0} placeholder="Days (e.g. 30)" value={days}
  onChange={e => setDays(e.target.value)} className="w-28" />
// in the submit payload:
days: days.trim() !== "" ? parseInt(days, 10) : null,
```
Show the `days` value in the terms list (e.g. `{term.name} · Net {term.days ?? "—"}`). Adapt to the file's existing form state pattern.

- [ ] **Step 2: Verify + commit**

Run: `cd app && pnpm typecheck` → 0 errors. In the app, create/edit a payment term with days → persists and lists.
```bash
git add app/app/\(dashboard\)/settings/page.tsx
git commit -m "feat(settings): payment terms gain a Days duration"
```

---

## Task 7: Payments page — status control + column

**Files:** Create `app/components/payments/PaymentStatusSelect.tsx`; Modify `app/app/(dashboard)/payments/page.tsx`

- [ ] **Step 1: Create `app/components/payments/PaymentStatusSelect.tsx`**

```tsx
"use client";

import { useUpdatePaymentStatus, getListPaymentsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const COLORS: Record<string, string> = {
  pending: "text-yellow-700 dark:text-yellow-400",
  received: "text-emerald-700 dark:text-emerald-400",
};

export function PaymentStatusSelect({ paymentId, status }: { paymentId: number; status: string }) {
  const qc = useQueryClient();
  const mut = useUpdatePaymentStatus({ mutation: {
    onSuccess: () => qc.invalidateQueries({ queryKey: getListPaymentsQueryKey() }),
  }});
  return (
    <Select value={status} onValueChange={v => mut.mutate({ id: paymentId, data: { status: v as "pending" | "received" } })}>
      <SelectTrigger className={cn("h-7 w-28 text-xs capitalize", COLORS[status])}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="pending">Pending</SelectItem>
        <SelectItem value="received">Received</SelectItem>
      </SelectContent>
    </Select>
  );
}
```
(Verify `useUpdatePaymentStatus` mutate arg shape in the generated `api.ts`; adapt if different.)

- [ ] **Step 2: Wire it into the payments list**

READ `payments/page.tsx`. Add a **Status** column: insert `"Status"` into the table header array (e.g. after `"Date Received"`), and render `<PaymentStatusSelect paymentId={p.id} status={p.status} />` in a matching `<td>` in the payment row. Update the skeleton row cell count + empty-state `colSpan` to match the new header count. Import `PaymentStatusSelect`. New payments created via the dialog remain `pending` by default (no status control needed in the create dialog for now).

- [ ] **Step 3: Verify + commit**

Run: `cd app && pnpm typecheck` → 0 errors. A newly recorded payment shows **Pending** and does not yet count toward its billing's Paid/progress; switching it to **Received** makes the billing's Paid/progress update on the Summary.
```bash
git add app/components/payments/PaymentStatusSelect.tsx app/app/\(dashboard\)/payments/page.tsx
git commit -m "feat(payments): Pending/Received status control on the payments list"
```

---

## Task 8: Billing Summary aging indicator

**Files:** Modify `app/app/(dashboard)/billings/summary/page.tsx`

- [ ] **Step 1: Add an Aging column using `computeAging`**

READ the file. Add import:
```typescript
import { computeAging } from "@/lib/aging";
```
Insert an **"Aging"** header (e.g. after `"Progress"`, before `"Status"`). In the collapsed `BillingGroup` row, compute and render a pill:
```tsx
const aging = computeAging({
  start: b.invoiceGeneratedAt ? new Date(b.invoiceGeneratedAt) : null,
  termDays: b.paymentTermDays ?? null,
  now: new Date(),
  settled: b.netReceivable > 0 && b.amountPaid >= b.netReceivable - 0.01,
});
const agingPill: Record<string, string> = {
  green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  yellow: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  red: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  neutral: "bg-muted text-muted-foreground",
};
// cell:
<td className="px-3 py-2">
  <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold", agingPill[aging.color])}>
    {aging.color === "neutral" ? (b.invoiceCode ? "Settled" : "—")
      : aging.overdue ? `Overdue ${Math.abs(aging.daysLeft ?? 0)}d`
      : `${aging.daysLeft}d left`}
  </span>
</td>
```
(`cn` is already imported in this file.) Update the header count and bump the skeleton row cells, the empty-state `colSpan`, and the expandable sub-row trailing `colSpan` all by 1 (header grew from 12 → 13). Recount so each sub-row totals 13.

- [ ] **Step 2: Verify + commit**

Run: `cd app && pnpm typecheck` → 0 errors. `pnpm vitest run` → all pass. On `/billings/summary`: a freshly invoiced billing (within its term) shows a green "N d left" pill; past half-term shows yellow; overdue shows red "Overdue N d"; a fully-received billing shows neutral "Settled"; a billing with no generated invoice or no term shows "—".
```bash
git add app/app/\(dashboard\)/billings/summary/page.tsx
git commit -m "feat(billing): color-coded aging indicator on Billing Summary"
```

---

## Self-Review checklist (run before handing off)

- **Spec coverage (2B):** aging util (T1) · `payment_terms.days` + `payments.status` schema/migration/backfill (T2) · OpenAPI/codegen for status/days/endpoint/termDays (T3) · payment status API + endpoint (T4) · amountPaid received-only + termDays (T5) · terms days UI (T6) · payment StatusSelect (T7) · Summary aging pill (T8). All covered.
- **Placeholder scan:** none — complete code in each step; UI tasks give concrete code + instruct reading the target file for exact insertion.
- **Type consistency:** `computeAging({ start, termDays, now, settled })` used identically in T1 and T8; payment `status` values `pending`/`received` consistent across T3/T4/T7; `paymentTermDays` name consistent T3/T5/T8; `useUpdatePaymentStatus.mutate({ id, data: { status } })` matches the generated hook shape.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-11-billing-phase2b.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, two-stage review.
2. **Inline Execution** — run tasks here with checkpoints.

After 2B lands I'll write the 2C plan (partner subsystem).
