# Import Engine — Phase 3 (Partner Bills) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a flat Partner Bills importer to the existing engine and wire it into the `/upload` type picker.

**Architecture:** A `FlatImportDescriptor` (like the Client PO one) that resolves partner by name (+ optional client/partner-PO), stores `amount` directly, auto-generates `PBILL-<prefix>-MMYY-NNNN` codes (tagged batch sequencing), and dedups by `(partnerId, invoice number)`. Registered in the registry + catalog so the shared page picks it up. No engine, route, or codegen changes.

**Tech Stack:** Next.js 15 App Router, Drizzle ORM (node-postgres), Zod (orval), React Query, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-18-import-engine-phase3-partner-bills-design.md`

**Commands:**
- App tests: `pnpm --filter @workspace/web test [name]`
- App typecheck: `pnpm --filter @workspace/web typecheck` (NOT `pnpm run typecheck` — pre-existingly red on unrelated `scripts/src/seed.ts`)
- App build: `pnpm --filter @workspace/web build`

---

## File structure

**Created:**
- `app/lib/import/descriptors/partner-bills.columns.ts` — client-safe columns + `partnerBillsMeta` (note + sampleRows).
- `app/lib/import/descriptors/partner-bills.ts` (+ test) — the `FlatImportDescriptor`.
- `app/app/api/import/[type]/partner-bills-route.test.ts` — route test.

**Modified:**
- `app/lib/import/registry.ts` — register `partnerBillsDescriptor`.
- `app/lib/import/catalog.ts` — add `partnerBillsMeta` to `importCatalog`.
- `app/app/(dashboard)/upload/page.tsx` — add `partner-bills` → `getListPartnerBillsQueryKey` to `listKeyByType`.

**Reused unchanged:** `types.ts`, `run-import.ts` (flat path), `cpo-helpers.ts` (`normalizeName`, `parseDateCell`, `isoToLocalDate`, `mmyyKey`), `po-code-seq.ts` (`seedMaxSeq`), `@/lib/po-codes` (`formatPoCode`), the generic `/api/import/{type}` route.

---

## Task 1: Partner Bills columns + descriptor `resolveRow`

**Files:**
- Create: `app/lib/import/descriptors/partner-bills.columns.ts`
- Create: `app/lib/import/descriptors/partner-bills.ts`
- Test: `app/lib/import/descriptors/partner-bills.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// app/lib/import/descriptors/partner-bills.test.ts
import { describe, it, expect, vi } from "vitest";

// The descriptor (after Task 2) imports @workspace/db, which throws at module-load
// without DATABASE_URL. Mock it so the pure resolveRow tests can load/run.
vi.mock("@workspace/db", () => ({
  db: {}, partnerBillsTable: {}, partnersTable: {}, clientsTable: {}, partnerPurchaseOrdersTable: {},
}));

import { partnerBillsDescriptor as d, type PbillContext } from "./partner-bills";

function ctx(over: Partial<PbillContext> = {}): PbillContext {
  return {
    partnersByName: new Map([["acme media", [{ id: 3, codePrefix: "ACME" }]]]),
    clientsByName: new Map([["beta llc", [{ id: 7 }]]]),
    ppoByCode: new Map([["PPO-ACME-0126-0001", { id: 11 }]]),
    existingKeys: new Set<string>(),
    maxSeqByGroup: new Map<string, number>(),
    ...over,
  };
}
const cells = (o: Partial<Record<string, string>>) => ({
  partnerName: "", amount: "", partnerInvoiceNumber: "", clientName: "", partnerPoCode: "", dateReceived: "", notes: "", ...o,
});

describe("partnerBills.resolveRow", () => {
  it("resolves a minimal valid row", () => {
    const r = d.resolveRow(cells({ partnerName: "Acme Media", amount: "1500.50" }), 1, ctx(), new Set());
    expect(r.status).toBe("valid");
    expect(r.payload).toMatchObject({ partnerId: 3, prefix: "ACME", amount: 1500.5, clientId: null, partnerPurchaseOrderId: null, partnerInvoiceNumber: null });
  });

  it("resolves optional client + partner PO", () => {
    const r = d.resolveRow(cells({ partnerName: "Acme Media", amount: "10", clientName: "Beta LLC", partnerPoCode: "PPO-ACME-0126-0001", partnerInvoiceNumber: "INV-9" }), 1, ctx(), new Set());
    expect(r.status).toBe("valid");
    expect(r.payload).toMatchObject({ clientId: 7, partnerPurchaseOrderId: 11, partnerInvoiceNumber: "INV-9" });
  });

  it("errors on unknown partner", () => {
    const r = d.resolveRow(cells({ partnerName: "Nope", amount: "10" }), 1, ctx(), new Set());
    expect(r.status).toBe("error");
    expect(r.messages[0]).toContain("Unknown partner");
  });

  it("errors when partner has no code prefix", () => {
    const c = ctx({ partnersByName: new Map([["acme media", [{ id: 3, codePrefix: "" }]]]) });
    const r = d.resolveRow(cells({ partnerName: "Acme Media", amount: "10" }), 1, c, new Set());
    expect(r.status).toBe("error");
    expect(r.messages[0]).toContain("code prefix");
  });

  it("errors on a non-finite or negative amount", () => {
    expect(d.resolveRow(cells({ partnerName: "Acme Media", amount: "Infinity" }), 1, ctx(), new Set()).status).toBe("error");
    expect(d.resolveRow(cells({ partnerName: "Acme Media", amount: "-5" }), 1, ctx(), new Set()).status).toBe("error");
    expect(d.resolveRow(cells({ partnerName: "Acme Media", amount: "" }), 1, ctx(), new Set()).status).toBe("error");
  });

  it("errors on a provided-but-unknown client", () => {
    const r = d.resolveRow(cells({ partnerName: "Acme Media", amount: "10", clientName: "Ghost" }), 1, ctx(), new Set());
    expect(r.status).toBe("error");
    expect(r.messages[0]).toContain("Unknown client");
  });

  it("errors on a provided-but-unknown partner PO code", () => {
    const r = d.resolveRow(cells({ partnerName: "Acme Media", amount: "10", partnerPoCode: "PPO-X-0000-0000" }), 1, ctx(), new Set());
    expect(r.status).toBe("error");
    expect(r.messages[0]).toContain("Unknown partner PO");
  });

  it("skips a duplicate of an existing bill (same partner + invoice number)", () => {
    const c = ctx({ existingKeys: new Set(["3|inv-9"]) });
    const r = d.resolveRow(cells({ partnerName: "Acme Media", amount: "10", partnerInvoiceNumber: "INV-9" }), 1, c, new Set());
    expect(r.status).toBe("skip");
  });

  it("does not dedup rows without an invoice number", () => {
    const seen = new Set<string>();
    const a = d.resolveRow(cells({ partnerName: "Acme Media", amount: "10" }), 1, ctx(), seen);
    const b = d.resolveRow(cells({ partnerName: "Acme Media", amount: "10" }), 2, ctx(), seen);
    expect(a.status).toBe("valid");
    expect(b.status).toBe("valid");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/web test partner-bills`
Expected: FAIL with "Cannot find module './partner-bills'".

- [ ] **Step 3: Write the columns/metadata file**

```typescript
// app/lib/import/descriptors/partner-bills.columns.ts
import type { ColumnSpec } from "../types";

export const partnerBillsColumns: ColumnSpec[] = [
  { key: "partnerName", label: "Partner", required: true, aliases: ["partner", "platform"], example: "Acme Media", note: "Must match an existing partner that has a code prefix." },
  { key: "amount", label: "Amount (USD)", required: true, aliases: ["amt", "total"], example: "1500.00", note: "The bill amount in USD." },
  { key: "partnerInvoiceNumber", label: "Invoice #", required: false, aliases: ["invoice", "invoiceno", "invoicenumber"], example: "INV-2026-014", note: "The partner's own invoice number; used to detect duplicates on re-import." },
  { key: "clientName", label: "Client", required: false, aliases: ["client"], example: "Beta LLC", note: "Optional; must match an existing client if provided." },
  { key: "partnerPoCode", label: "Partner PO Code", required: false, aliases: ["ppocode", "ppo", "partnerpo"], example: "PPO-ACME-0126-0001", note: "Optional; must match an existing partner PO code if provided." },
  { key: "dateReceived", label: "Date Received", required: false, aliases: ["received", "date"], example: "2026-01-20", note: "YYYY-MM-DD." },
  { key: "notes", label: "Notes", required: false, aliases: ["note"], example: "", note: "Optional free text." },
];

export const partnerBillsMeta = {
  type: "partner-bills",
  label: "Partner Bills",
  columns: partnerBillsColumns,
  sampleRows: [
    ["Acme Media", "1500.00", "INV-2026-014", "Beta LLC", "PPO-ACME-0126-0001", "2026-01-20", "January services"],
    ["Beta Ads", "800.50", "5567", "", "", "2026-01-22", ""],
  ],
};
```

- [ ] **Step 4: Write the descriptor with `resolveRow` (stub `loadContext`/`commit`)**

```typescript
// app/lib/import/descriptors/partner-bills.ts
import type { FlatImportDescriptor, RowResult } from "../types";
import { normalizeName, parseDateCell } from "./cpo-helpers";
import { partnerBillsColumns } from "./partner-bills.columns";

export interface PbillContext {
  partnersByName: Map<string, Array<{ id: number; codePrefix: string }>>;
  clientsByName: Map<string, Array<{ id: number }>>;
  ppoByCode: Map<string, { id: number }>;
  existingKeys: Set<string>;      // `${partnerId}|${normalizedInvoiceNumber}`
  maxSeqByGroup: Map<string, number>;
}

export interface PbillPayload {
  partnerId: number;
  prefix: string;
  partnerInvoiceNumber: string | null;
  clientId: number | null;
  partnerPurchaseOrderId: number | null;
  amount: number;
  dateReceived: string | null;
  notes: string | null;
}

function resolveRow(
  cells: Record<string, string>,
  rowNumber: number,
  ctx: PbillContext,
  seen: Set<string>,
): RowResult<PbillPayload> {
  const messages: string[] = [];
  const error = (msg: string): RowResult<PbillPayload> => ({ rowNumber, status: "error", messages: [msg] });

  const partnerName = cells.partnerName.trim();
  if (!partnerName) return error("Partner is required");
  const pm = ctx.partnersByName.get(normalizeName(partnerName));
  if (!pm || pm.length === 0) return error(`Unknown partner: "${partnerName}"`);
  if (pm.length > 1) return error(`Ambiguous partner name: "${partnerName}"`);
  const partner = pm[0];
  const prefix = partner.codePrefix.trim();
  if (!prefix) return error(`Partner "${partnerName}" has no code prefix — set one first`);

  const amountStr = cells.amount.trim();
  const amount = Number(amountStr);
  if (!amountStr || !Number.isFinite(amount) || amount < 0) return error(`Invalid amount "${cells.amount}"`);

  let clientId: number | null = null;
  const clientName = cells.clientName.trim();
  if (clientName) {
    const cm = ctx.clientsByName.get(normalizeName(clientName));
    if (!cm || cm.length === 0) return error(`Unknown client: "${clientName}"`);
    if (cm.length > 1) return error(`Ambiguous client name: "${clientName}"`);
    clientId = cm[0].id;
  }

  let partnerPurchaseOrderId: number | null = null;
  const ppoCode = cells.partnerPoCode.trim();
  if (ppoCode) {
    const ppo = ctx.ppoByCode.get(ppoCode);
    if (!ppo) return error(`Unknown partner PO code: "${ppoCode}"`);
    partnerPurchaseOrderId = ppo.id;
  }

  const dateReceived = parseDateCell(cells.dateReceived, "Date Received", messages);
  if (messages.length) return { rowNumber, status: "error", messages };

  const invoice = cells.partnerInvoiceNumber.trim();
  if (invoice) {
    const key = `${partner.id}|${normalizeName(invoice)}`;
    if (ctx.existingKeys.has(key)) return { rowNumber, status: "skip", messages: ["Duplicate of an existing partner bill (same partner & invoice number)"] };
    if (seen.has(key)) return { rowNumber, status: "skip", messages: ["Duplicate bill in file (same partner & invoice number)"] };
    seen.add(key);
  }

  return {
    rowNumber,
    status: "valid",
    messages: [],
    payload: {
      partnerId: partner.id, prefix,
      partnerInvoiceNumber: invoice || null,
      clientId, partnerPurchaseOrderId, amount,
      dateReceived, notes: cells.notes.trim() || null,
    },
  };
}

export const partnerBillsDescriptor: FlatImportDescriptor<PbillContext, PbillPayload> = {
  type: "partner-bills",
  label: "Partner Bills",
  columns: partnerBillsColumns,
  // Implemented in Task 2:
  async loadContext(): Promise<PbillContext> {
    throw new Error("not implemented");
  },
  resolveRow,
  async commit(): Promise<void> {
    throw new Error("not implemented");
  },
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @workspace/web test partner-bills`
Expected: PASS (9 tests).

- [ ] **Step 6: Commit**

```bash
git add app/lib/import/descriptors/partner-bills.columns.ts app/lib/import/descriptors/partner-bills.ts app/lib/import/descriptors/partner-bills.test.ts
git commit -m "feat(import): partner-bills columns + row resolution"
```

---

## Task 2: Partner Bills `loadContext`/`commit` + registry + catalog + page + route test

**Files:**
- Modify: `app/lib/import/descriptors/partner-bills.ts`
- Modify: `app/lib/import/registry.ts`
- Modify: `app/lib/import/catalog.ts`
- Modify: `app/app/(dashboard)/upload/page.tsx`
- Create: `app/app/api/import/[type]/partner-bills-route.test.ts`

- [ ] **Step 1: Add imports + implement `loadContext`/`commit`**

At the top of `app/lib/import/descriptors/partner-bills.ts` add (with the existing imports):

```typescript
import { db, partnerBillsTable, partnersTable, clientsTable, partnerPurchaseOrdersTable } from "@workspace/db";
import { formatPoCode } from "@/lib/po-codes";
import type { ImportSession } from "../types";
import { isoToLocalDate, mmyyKey } from "./cpo-helpers";
import { seedMaxSeq } from "../po-code-seq";
```

Replace the `loadContext` stub body with:

```typescript
  async loadContext(): Promise<PbillContext> {
    const partners = await db
      .select({ id: partnersTable.id, name: partnersTable.name, codePrefix: partnersTable.codePrefix })
      .from(partnersTable);
    const partnersByName = new Map<string, Array<{ id: number; codePrefix: string }>>();
    for (const p of partners) {
      const k = normalizeName(p.name);
      const list = partnersByName.get(k) ?? [];
      list.push({ id: p.id, codePrefix: p.codePrefix ?? "" });
      partnersByName.set(k, list);
    }

    const clients = await db.select({ id: clientsTable.id, name: clientsTable.name }).from(clientsTable);
    const clientsByName = new Map<string, Array<{ id: number }>>();
    for (const c of clients) {
      const k = normalizeName(c.name);
      const list = clientsByName.get(k) ?? [];
      list.push({ id: c.id });
      clientsByName.set(k, list);
    }

    const ppos = await db.select({ id: partnerPurchaseOrdersTable.id, code: partnerPurchaseOrdersTable.code }).from(partnerPurchaseOrdersTable);
    const ppoByCode = new Map<string, { id: number }>();
    for (const p of ppos) ppoByCode.set(p.code, { id: p.id });

    const existing = await db
      .select({ partnerId: partnerBillsTable.partnerId, partnerInvoiceNumber: partnerBillsTable.partnerInvoiceNumber, code: partnerBillsTable.code })
      .from(partnerBillsTable);
    const existingKeys = new Set<string>();
    for (const r of existing) {
      if (r.partnerInvoiceNumber) existingKeys.add(`${r.partnerId}|${normalizeName(r.partnerInvoiceNumber)}`);
    }
    const maxSeqByGroup = seedMaxSeq(existing.map((r) => r.code), "PBILL");

    return { partnersByName, clientsByName, ppoByCode, existingKeys, maxSeqByGroup };
  },
```

Replace the `commit` stub body with:

```typescript
  async commit(payloads: PbillPayload[], ctx: PbillContext, session: ImportSession): Promise<void> {
    const counters = new Map(ctx.maxSeqByGroup);
    await db.transaction(async (tx) => {
      for (const p of payloads) {
        const date = p.dateReceived ? isoToLocalDate(p.dateReceived) : new Date();
        const group = `${p.prefix}|${mmyyKey(date)}`;
        const next = (counters.get(group) ?? 0) + 1;
        counters.set(group, next);
        const code = "PBILL-" + formatPoCode(p.prefix, date, next);
        await tx.insert(partnerBillsTable).values({
          code,
          partnerInvoiceNumber: p.partnerInvoiceNumber,
          partnerId: p.partnerId,
          clientId: p.clientId,
          partnerPurchaseOrderId: p.partnerPurchaseOrderId,
          amount: String(p.amount),
          attachmentUrl: null,
          attachmentName: null,
          dateReceived: p.dateReceived,
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
import { partnerBillsDescriptor } from "./descriptors/partner-bills";
```

and add to the `registry` object (after the partner-PO entry):

```typescript
  [partnerBillsDescriptor.type]: partnerBillsDescriptor,
```

- [ ] **Step 3: Add to the catalog**

In `app/lib/import/catalog.ts`, add the import and extend `importCatalog`:

```typescript
import { partnerBillsMeta } from "./descriptors/partner-bills.columns";
```

Change:
```typescript
export const importCatalog: CatalogEntry[] = [clientPurchaseOrdersMeta, partnerPurchaseOrdersMeta];
```
to:
```typescript
export const importCatalog: CatalogEntry[] = [clientPurchaseOrdersMeta, partnerPurchaseOrdersMeta, partnerBillsMeta];
```

- [ ] **Step 4: Wire list-invalidation on the page**

In `app/app/(dashboard)/upload/page.tsx`:
- Add `getListPartnerBillsQueryKey` to the existing import from `@workspace/api-client-react` (the line that already imports `getListClientPurchaseOrdersQueryKey, getListPartnerPurchaseOrdersQueryKey`).
- Add an entry to the `listKeyByType` map:

```typescript
  "partner-bills": getListPartnerBillsQueryKey,
```

- [ ] **Step 5: Write the route test**

```typescript
// app/app/api/import/[type]/partner-bills-route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const insertValues = vi.fn();
const transaction = vi.fn(async (cb: (tx: unknown) => Promise<void>) =>
  cb({ insert: () => ({ values: insertValues }) }),
);

const partnersTable = { __t: "partners" };
const clientsTable = { __t: "clients" };
const partnerPurchaseOrdersTable = { __t: "ppo" };
const partnerBillsTable = { __t: "pbill" };

let data: Record<string, unknown[]> = {};

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: (t: { __t: string }) => data[t.__t] ?? [] }),
    transaction,
  },
  partnersTable, clientsTable, partnerPurchaseOrdersTable, partnerBillsTable,
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
    partners: [{ id: 3, name: "Acme Media", codePrefix: "ACME" }],
    clients: [],
    ppo: [],
    pbill: [],
  };
});

// mapping: partnerName, amount, partnerInvoiceNumber, clientName, partnerPoCode, dateReceived, notes
const MAPPING = { partnerName: 0, amount: 1, partnerInvoiceNumber: 2, clientName: 3, partnerPoCode: 4, dateReceived: 5, notes: 6 };

describe("POST /api/import/partner-bills", () => {
  it("dry-run reports one valid row and does not write", async () => {
    const res = await call("partner-bills", {
      mapping: MAPPING,
      rows: [["Acme Media", "1500.00", "INV-9", "", "", "2026-01-20", ""]],
      dryRun: true,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(1);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("commit inserts a partner bill with a PBILL- code and stored amount", async () => {
    const res = await call("partner-bills", {
      mapping: MAPPING,
      rows: [["Acme Media", "1500.50", "INV-9", "", "", "2026-01-20", "Jan"]],
      dryRun: false,
    });
    expect(res.status).toBe(200);
    expect(transaction).toHaveBeenCalledTimes(1);
    const inserted = insertValues.mock.calls[0][0];
    expect(inserted).toMatchObject({ partnerId: 3, amount: "1500.5", createdById: 42, attachmentUrl: null });
    expect(inserted.code).toMatch(/^PBILL-ACME-\d{4}-0001$/);
  });
});
```

- [ ] **Step 6: Run tests + typecheck + build**

Run: `pnpm --filter @workspace/web test partner-bills`
Expected: PASS (resolveRow suite + route suite).
Run: `pnpm --filter @workspace/web typecheck`
Expected: PASS.
Run: `pnpm --filter @workspace/web build`
Expected: PASS (the `/upload` page now lists "Partner Bills"; still DB-free client bundle — the page imports the catalog, not the descriptor).

- [ ] **Step 7: Commit**

```bash
git add app/lib/import/descriptors/partner-bills.ts app/lib/import/registry.ts app/lib/import/catalog.ts "app/app/(dashboard)/upload/page.tsx" app/app/api/import/[type]/partner-bills-route.test.ts
git commit -m "feat(import): partner-bills loadContext/commit + registry/catalog/page wiring + route test"
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
Expected: PASS — all prior tests plus the new partner-bills descriptor + route tests.

- [ ] **Step 3: Build**

Run: `pnpm --filter @workspace/web build`
Expected: PASS.

- [ ] **Step 4: End-to-end dogfood (manual, needs login + DB)**

Against the running app, as a user with "Upload Data":
- Select **Partner Bills**; confirm the "Expected columns" table lists the 7 columns and "Download sample CSV" produces the two sample rows.
- Import a sample row against a real partner (with a `codePrefix`) → a partner bill is created with a `PBILL-…` code and the stored amount; leaving client/PO blank works; an unknown client/PO code errors.
- Re-import the same row (with the same invoice number) → it shows as **skipped**.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "test(import): phase 3 verification fixes"
```

---

## Self-review notes (for the implementer)

- **Flat pattern reuse:** `partner-bills.ts` mirrors `client-purchase-orders.ts` — typed as its concrete `FlatImportDescriptor` variant (the registry holds the `ImportDescriptor` union). No engine change.
- **Amount** is stored directly (`String(amount)` for the Drizzle `numeric` column); `!Number.isFinite` rejects `"Infinity"`/NaN (the same hardening applied to partner-PO CAC rate).
- **Code date basis:** `dateReceived`'s `MMYY` (fallback today), sequenced from existing `PBILL-` codes via `seedMaxSeq(codes, "PBILL")`.
- **Generated hook:** `getListPartnerBillsQueryKey` is confirmed present in `lib/api-client-react/src/generated/api.ts`; no codegen needed (the generic route already serves any registered type).