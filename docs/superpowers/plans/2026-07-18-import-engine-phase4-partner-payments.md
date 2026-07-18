# Import Engine — Phase 4 (Partner Payments) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a flat Partner Payments importer that references a partner bill by code, enforces over-allocation against the bill's remaining, and wires into the `/upload` type picker.

**Architecture:** A `FlatImportDescriptor` that resolves a partner bill by `PBILL-` code (deriving `partnerId`), validates amount/status/date, dedups by `(billId, amount, date)`, and errors on over-allocation using a per-bill running total tracked in a mutable `batchAllocated` map on the load-context (so multi-row files are checked cumulatively in dry-run and commit alike). No code generation, no engine/route changes.

**Tech Stack:** Next.js 15 App Router, Drizzle ORM (node-postgres), Zod (orval), React Query, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-18-import-engine-phase4-partner-payments-design.md`

**Commands:**
- App tests: `pnpm --filter @workspace/web test [name]`
- App typecheck: `pnpm --filter @workspace/web typecheck` (NOT `pnpm run typecheck` — pre-existingly red on unrelated `scripts/src/seed.ts`)
- App build: `pnpm --filter @workspace/web build`

---

## File structure

**Created:**
- `app/lib/import/descriptors/partner-payments.columns.ts` — client-safe columns + `partnerPaymentsMeta`.
- `app/lib/import/descriptors/partner-payments.ts` (+ test) — the `FlatImportDescriptor`.
- `app/app/api/import/[type]/partner-payments-route.test.ts` — route test.

**Modified:**
- `app/lib/import/registry.ts` — register `partnerPaymentsDescriptor`.
- `app/lib/import/catalog.ts` — add `partnerPaymentsMeta` to `importCatalog`.
- `app/app/(dashboard)/upload/page.tsx` — add `partner-payments` → `getListPartnerPaymentsQueryKey` to `listKeyByType`.

**Reused unchanged:** `types.ts`, `run-import.ts` (flat path), `cpo-helpers.ts` (`parseDateCell`), the generic `/api/import/{type}` route.

---

## Task 1: Partner Payments columns + descriptor `resolveRow`

**Files:**
- Create: `app/lib/import/descriptors/partner-payments.columns.ts`
- Create: `app/lib/import/descriptors/partner-payments.ts`
- Test: `app/lib/import/descriptors/partner-payments.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// app/lib/import/descriptors/partner-payments.test.ts
import { describe, it, expect, vi } from "vitest";

// The descriptor (after Task 2) imports @workspace/db, which throws at module-load
// without DATABASE_URL. Mock it so the pure resolveRow tests can load/run.
vi.mock("@workspace/db", () => ({ db: {}, partnerPaymentsTable: {}, partnerBillsTable: {} }));

import { partnerPaymentsDescriptor as d, type PpayContext } from "./partner-payments";

function ctx(over: Partial<PpayContext> = {}): PpayContext {
  return {
    billByCode: new Map([["PBILL-ACME-0126-0001", { id: 5, partnerId: 3, amount: 1500, remaining: 1500 }]]),
    existingDedupKeys: new Set<string>(),
    batchAllocated: new Map<number, number>(),
    ...over,
  };
}
const cells = (o: Partial<Record<string, string>>) => ({
  partnerBillCode: "", amount: "", status: "", mode: "", paymentDate: "", notes: "", ...o,
});

describe("partnerPayments.resolveRow", () => {
  it("resolves a valid payment, deriving partnerId from the bill", () => {
    const r = d.resolveRow(cells({ partnerBillCode: "PBILL-ACME-0126-0001", amount: "500.00", status: "settled", mode: "wire" }), 1, ctx(), new Set());
    expect(r.status).toBe("valid");
    expect(r.payload).toMatchObject({ partnerId: 3, partnerBillId: 5, amount: 500, status: "settled", mode: "wire" });
  });

  it("defaults status to pending when blank", () => {
    const r = d.resolveRow(cells({ partnerBillCode: "PBILL-ACME-0126-0001", amount: "10" }), 1, ctx(), new Set());
    expect(r.status).toBe("valid");
    expect(r.payload!.status).toBe("pending");
  });

  it("errors on unknown bill code", () => {
    const r = d.resolveRow(cells({ partnerBillCode: "PBILL-X-0000-0000", amount: "10" }), 1, ctx(), new Set());
    expect(r.status).toBe("error");
    expect(r.messages[0]).toContain("Unknown partner bill");
  });

  it("errors on a non-positive or non-finite amount", () => {
    expect(d.resolveRow(cells({ partnerBillCode: "PBILL-ACME-0126-0001", amount: "0" }), 1, ctx(), new Set()).status).toBe("error");
    expect(d.resolveRow(cells({ partnerBillCode: "PBILL-ACME-0126-0001", amount: "Infinity" }), 1, ctx(), new Set()).status).toBe("error");
    expect(d.resolveRow(cells({ partnerBillCode: "PBILL-ACME-0126-0001", amount: "" }), 1, ctx(), new Set()).status).toBe("error");
  });

  it("errors on an invalid status", () => {
    const r = d.resolveRow(cells({ partnerBillCode: "PBILL-ACME-0126-0001", amount: "10", status: "approved" }), 1, ctx(), new Set());
    expect(r.status).toBe("error");
    expect(r.messages[0]).toContain("Invalid status");
  });

  it("errors when a single payment exceeds the bill remaining", () => {
    const c = ctx({ billByCode: new Map([["PBILL-ACME-0126-0001", { id: 5, partnerId: 3, amount: 1500, remaining: 400 }]]) });
    const r = d.resolveRow(cells({ partnerBillCode: "PBILL-ACME-0126-0001", amount: "500" }), 1, c, new Set());
    expect(r.status).toBe("error");
    expect(r.messages[0]).toContain("exceeds remaining");
  });

  it("errors when cumulative in-batch payments exceed the bill remaining", () => {
    const c = ctx(); // remaining 1500
    const seen = new Set<string>();
    const a = d.resolveRow(cells({ partnerBillCode: "PBILL-ACME-0126-0001", amount: "1000" }), 1, c, seen);
    const b = d.resolveRow(cells({ partnerBillCode: "PBILL-ACME-0126-0001", amount: "800" }), 2, c, seen);
    expect(a.status).toBe("valid");
    expect(b.status).toBe("error");
    expect(b.messages[0]).toContain("exceeds remaining");
  });

  it("skips a duplicate of an existing payment (same bill, amount & date)", () => {
    const c = ctx({ existingDedupKeys: new Set(["5|500|2026-02-05"]) });
    const r = d.resolveRow(cells({ partnerBillCode: "PBILL-ACME-0126-0001", amount: "500", paymentDate: "2026-02-05" }), 1, c, new Set());
    expect(r.status).toBe("skip");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/web test partner-payments`
Expected: FAIL with "Cannot find module './partner-payments'".

- [ ] **Step 3: Write the columns/metadata file**

```typescript
// app/lib/import/descriptors/partner-payments.columns.ts
import type { ColumnSpec } from "../types";

export const partnerPaymentsColumns: ColumnSpec[] = [
  { key: "partnerBillCode", label: "Partner Bill Code", required: true, aliases: ["billcode", "pbill", "partnerbill"], example: "PBILL-ACME-0126-0001", note: "Must match an existing partner bill; the partner is taken from the bill." },
  { key: "amount", label: "Amount (USD)", required: true, aliases: ["amt", "paid"], example: "500.00", note: "USD paid; cannot exceed the bill's remaining unpaid amount." },
  { key: "status", label: "Status", required: false, aliases: [], example: "settled", note: "pending (default) or settled." },
  { key: "mode", label: "Mode", required: false, aliases: ["method"], example: "wire", note: "Payment method, e.g. wire or cheque." },
  { key: "paymentDate", label: "Payment Date", required: false, aliases: ["date", "paidon"], example: "2026-02-05", note: "YYYY-MM-DD." },
  { key: "notes", label: "Notes", required: false, aliases: ["note"], example: "", note: "Optional free text." },
];

export const partnerPaymentsMeta = {
  type: "partner-payments",
  label: "Partner Payments",
  columns: partnerPaymentsColumns,
  sampleRows: [
    ["PBILL-ACME-0126-0001", "500.00", "settled", "wire", "2026-02-05", "First tranche"],
    ["PBILL-ACME-0126-0001", "1000.00", "pending", "wire", "2026-02-20", ""],
  ],
};
```

- [ ] **Step 4: Write the descriptor with `resolveRow` (stub `loadContext`/`commit`)**

```typescript
// app/lib/import/descriptors/partner-payments.ts
import type { FlatImportDescriptor, RowResult } from "../types";
import { parseDateCell } from "./cpo-helpers";
import { partnerPaymentsColumns } from "./partner-payments.columns";

export interface PpayContext {
  billByCode: Map<string, { id: number; partnerId: number; amount: number; remaining: number }>;
  existingDedupKeys: Set<string>;        // `${billId}|${amount}|${paymentDate}`
  batchAllocated: Map<number, number>;   // billId -> USD allocated by valid rows so far (mutated during a run)
}

export interface PpayPayload {
  partnerId: number;
  partnerBillId: number;
  amount: number;
  mode: string | null;
  status: string;
  paymentDate: string | null;
  notes: string | null;
}

const VALID_STATUS = new Set(["pending", "settled"]);

function dedupKey(billId: number, amount: number, paymentDate: string | null): string {
  return `${billId}|${amount}|${paymentDate ?? ""}`;
}

function resolveRow(
  cells: Record<string, string>,
  rowNumber: number,
  ctx: PpayContext,
  seen: Set<string>,
): RowResult<PpayPayload> {
  const messages: string[] = [];
  const error = (msg: string): RowResult<PpayPayload> => ({ rowNumber, status: "error", messages: [msg] });

  const billCode = cells.partnerBillCode.trim();
  if (!billCode) return error("Partner Bill Code is required");
  const bill = ctx.billByCode.get(billCode);
  if (!bill) return error(`Unknown partner bill code: "${billCode}"`);

  const amountStr = cells.amount.trim();
  const amount = Number(amountStr);
  if (!amountStr || !Number.isFinite(amount) || amount <= 0) return error(`Invalid amount "${cells.amount}"`);

  const status = (cells.status.trim() || "pending").toLowerCase();
  if (!VALID_STATUS.has(status)) return error(`Invalid status "${cells.status}" (expected pending or settled)`);

  const paymentDate = parseDateCell(cells.paymentDate, "Payment Date", messages);
  if (messages.length) return { rowNumber, status: "error", messages };

  // Dedup first, so a re-import of the same payment skips rather than erroring on over-allocation.
  const key = dedupKey(bill.id, amount, paymentDate);
  if (ctx.existingDedupKeys.has(key)) return { rowNumber, status: "skip", messages: ["Duplicate of an existing payment (same bill, amount & date)"] };
  if (seen.has(key)) return { rowNumber, status: "skip", messages: ["Duplicate payment in file (same bill, amount & date)"] };

  const available = bill.remaining - (ctx.batchAllocated.get(bill.id) ?? 0);
  if (amount > available + 0.01) {
    return error(`Amount ${amount} exceeds remaining ${available.toFixed(2)} on bill ${billCode}`);
  }

  ctx.batchAllocated.set(bill.id, (ctx.batchAllocated.get(bill.id) ?? 0) + amount);
  seen.add(key);
  return {
    rowNumber,
    status: "valid",
    messages: [],
    payload: {
      partnerId: bill.partnerId, partnerBillId: bill.id, amount,
      mode: cells.mode.trim() || null, status,
      paymentDate, notes: cells.notes.trim() || null,
    },
  };
}

export const partnerPaymentsDescriptor: FlatImportDescriptor<PpayContext, PpayPayload> = {
  type: "partner-payments",
  label: "Partner Payments",
  columns: partnerPaymentsColumns,
  // Implemented in Task 2:
  async loadContext(): Promise<PpayContext> {
    throw new Error("not implemented");
  },
  resolveRow,
  async commit(): Promise<void> {
    throw new Error("not implemented");
  },
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @workspace/web test partner-payments`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add app/lib/import/descriptors/partner-payments.columns.ts app/lib/import/descriptors/partner-payments.ts app/lib/import/descriptors/partner-payments.test.ts
git commit -m "feat(import): partner-payments columns + row resolution"
```

---

## Task 2: Partner Payments `loadContext`/`commit` + registry + catalog + page + route test

**Files:**
- Modify: `app/lib/import/descriptors/partner-payments.ts`
- Modify: `app/lib/import/registry.ts`
- Modify: `app/lib/import/catalog.ts`
- Modify: `app/app/(dashboard)/upload/page.tsx`
- Create: `app/app/api/import/[type]/partner-payments-route.test.ts`

- [ ] **Step 1: Add imports + implement `loadContext`/`commit`**

At the top of `app/lib/import/descriptors/partner-payments.ts` add (with the existing imports):

```typescript
import { db, partnerPaymentsTable, partnerBillsTable } from "@workspace/db";
import type { ImportSession } from "../types";
```

Replace the `loadContext` stub body with:

```typescript
  async loadContext(): Promise<PpayContext> {
    const bills = await db
      .select({ id: partnerBillsTable.id, code: partnerBillsTable.code, partnerId: partnerBillsTable.partnerId, amount: partnerBillsTable.amount })
      .from(partnerBillsTable);
    const payments = await db
      .select({ partnerBillId: partnerPaymentsTable.partnerBillId, amount: partnerPaymentsTable.amount, paymentDate: partnerPaymentsTable.paymentDate })
      .from(partnerPaymentsTable);

    const allocatedByBill = new Map<number, number>();
    const existingDedupKeys = new Set<string>();
    for (const p of payments) {
      allocatedByBill.set(p.partnerBillId, (allocatedByBill.get(p.partnerBillId) ?? 0) + Number(p.amount));
      existingDedupKeys.add(`${p.partnerBillId}|${Number(p.amount)}|${p.paymentDate ?? ""}`);
    }

    const billByCode = new Map<string, { id: number; partnerId: number; amount: number; remaining: number }>();
    for (const b of bills) {
      const amt = Number(b.amount);
      billByCode.set(b.code, { id: b.id, partnerId: b.partnerId, amount: amt, remaining: amt - (allocatedByBill.get(b.id) ?? 0) });
    }

    return { billByCode, existingDedupKeys, batchAllocated: new Map() };
  },
```

Replace the `commit` stub body with:

```typescript
  async commit(payloads: PpayPayload[], _ctx: PpayContext, session: ImportSession): Promise<void> {
    await db.transaction(async (tx) => {
      for (const p of payloads) {
        await tx.insert(partnerPaymentsTable).values({
          partnerId: p.partnerId,
          partnerBillId: p.partnerBillId,
          sourceClientPaymentId: null,
          amount: String(p.amount),
          mode: p.mode,
          status: p.status,
          attachmentUrl: null,
          paymentDate: p.paymentDate,
          notes: p.notes,
          createdById: session.userId,
        });
      }
    });
  },
```

- [ ] **Step 2: Register the descriptor**

In `app/lib/import/registry.ts`, add the import and the registry entry:

```typescript
import { partnerPaymentsDescriptor } from "./descriptors/partner-payments";
```

and add to the `registry` object (after the partner-bills entry):

```typescript
  [partnerPaymentsDescriptor.type]: partnerPaymentsDescriptor,
```

- [ ] **Step 3: Add to the catalog**

In `app/lib/import/catalog.ts`, add the import and extend `importCatalog`:

```typescript
import { partnerPaymentsMeta } from "./descriptors/partner-payments.columns";
```

Add `partnerPaymentsMeta` to the end of the `importCatalog` array (after `partnerBillsMeta`).

- [ ] **Step 4: Wire list-invalidation on the page**

In `app/app/(dashboard)/upload/page.tsx`:
- Add `getListPartnerPaymentsQueryKey` to the existing import from `@workspace/api-client-react`.
- Add an entry to the `listKeyByType` map:

```typescript
  "partner-payments": getListPartnerPaymentsQueryKey,
```

- [ ] **Step 5: Write the route test**

```typescript
// app/app/api/import/[type]/partner-payments-route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const insertValues = vi.fn();
const transaction = vi.fn(async (cb: (tx: unknown) => Promise<void>) =>
  cb({ insert: () => ({ values: insertValues }) }),
);

const partnerBillsTable = { __t: "pbill" };
const partnerPaymentsTable = { __t: "ppay" };

let data: Record<string, unknown[]> = {};

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: (t: { __t: string }) => data[t.__t] ?? [] }),
    transaction,
  },
  partnerBillsTable, partnerPaymentsTable,
}));

vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(async () => ({ sub: 42, name: "T", email: "t@x.com", role: "Admin", isSystem: true })),
}));

function call(type: string, body: unknown) {
  return import("./route").then(({ POST }) =>
    POST(
      new Request(`http://localhost/api/import/${type}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ type }) },
    ),
  );
}

beforeEach(() => {
  insertValues.mockClear();
  transaction.mockClear();
  data = {
    pbill: [{ id: 5, code: "PBILL-ACME-0126-0001", partnerId: 3, amount: "1500.00" }],
    ppay: [],
  };
});

// mapping: partnerBillCode, amount, status, mode, paymentDate, notes
const MAPPING = { partnerBillCode: 0, amount: 1, status: 2, mode: 3, paymentDate: 4, notes: 5 };

describe("POST /api/import/partner-payments", () => {
  it("dry-run reports one valid row and does not write", async () => {
    const res = await call("partner-payments", {
      mapping: MAPPING,
      rows: [["PBILL-ACME-0126-0001", "500.00", "settled", "wire", "2026-02-05", ""]],
      dryRun: true,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(1);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("commit inserts a payment with partnerId derived from the bill", async () => {
    const res = await call("partner-payments", {
      mapping: MAPPING,
      rows: [["PBILL-ACME-0126-0001", "500.00", "settled", "wire", "2026-02-05", "Jan"]],
      dryRun: false,
    });
    expect(res.status).toBe(200);
    expect(transaction).toHaveBeenCalledTimes(1);
    const inserted = insertValues.mock.calls[0][0];
    expect(inserted).toMatchObject({ partnerId: 3, partnerBillId: 5, amount: "500", status: "settled", sourceClientPaymentId: null, attachmentUrl: null, createdById: 42 });
  });

  it("errors the second row when two payments jointly exceed the bill remaining", async () => {
    const res = await call("partner-payments", {
      mapping: MAPPING,
      rows: [
        ["PBILL-ACME-0126-0001", "1000", "", "", "", ""],
        ["PBILL-ACME-0126-0001", "800", "", "", "", ""],
      ],
      dryRun: true,
    });
    const body = await res.json();
    expect(body.valid).toBe(1);
    expect(body.errored).toBe(1);
  });
});
```

- [ ] **Step 6: Run tests + typecheck + build**

Run: `pnpm --filter @workspace/web test partner-payments`
Expected: PASS (resolveRow suite + route suite).
Run: `pnpm --filter @workspace/web typecheck`
Expected: PASS.
Run: `pnpm --filter @workspace/web build`
Expected: PASS (the `/upload` page now lists "Partner Payments"; still DB-free client bundle — the page imports the catalog, not the descriptor).

- [ ] **Step 7: Commit**

```bash
git add app/lib/import/descriptors/partner-payments.ts app/lib/import/registry.ts app/lib/import/catalog.ts "app/app/(dashboard)/upload/page.tsx" app/app/api/import/[type]/partner-payments-route.test.ts
git commit -m "feat(import): partner-payments loadContext/commit + registry/catalog/page wiring + route test"
```

---

## Task 3: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Typecheck (app + libs)**

Run: `pnpm --filter @workspace/web typecheck`
Expected: PASS.
Run: `pnpm -w run typecheck:libs`
Expected: PASS.

- [ ] **Step 2: Full app test suite**

Run: `pnpm --filter @workspace/web test`
Expected: PASS — all prior tests plus the new partner-payments descriptor + route tests.

- [ ] **Step 3: Build**

Run: `pnpm --filter @workspace/web build`
Expected: PASS.

- [ ] **Step 4: End-to-end dogfood (manual, needs login + DB)**

Against the running app, as a user with "Upload Data":
- Select **Partner Payments**; confirm the "Expected columns" table lists the 6 columns and "Download sample CSV" produces the two sample rows.
- Import a payment against a real partner bill (`PBILL-…`) → a partner payment is created with `partnerId` from the bill and the stored amount; the bill's paid/remaining figures update.
- Import a payment larger than the bill's remaining → it shows as an **error** in preview and is excluded.
- Re-import the same payment (same bill/amount/date) → it shows as **skipped**.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "test(import): phase 4 verification fixes"
```

---

## Self-review notes (for the implementer)

- **Flat pattern reuse:** `partner-payments.ts` mirrors the client-PO / partner-bills descriptors — typed as its concrete `FlatImportDescriptor` variant (registry holds the union). No engine change. **No code generation** (`partner_payments` has no code column).
- **Over-allocation uses `ctx.batchAllocated`** (a mutable map) so cumulative in-batch checking works; it's populated by `resolveRow` on the valid path and is exercised in both dry-run and commit (both call `resolveRow`). `commit` ignores it (`_ctx`).
- **Dedup runs before over-allocation** so a re-imported (already-recorded) payment skips instead of erroring. Dedup-key amounts are `Number()`-normalized on both sides (`loadContext` existing keys and `resolveRow`) so `"500.00"` and `500` match.
- **`partnerId` is derived from the resolved bill**, never from a column. `sourceClientPaymentId` and attachments are inserted null.
- **Generated hook:** `getListPartnerPaymentsQueryKey` is confirmed present in `lib/api-client-react/src/generated/api.ts`; no codegen needed.
