# Billing Phase 2C-i — Partner Bills + Billing Tabs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a **Partner Billing** area — record bills received from partners (system `PBILL-` code + their invoice #, USD amount prefilled from a Partner PO, aging from date received) — and restructure **Billing** into **Client | Partner** tabs.

**Architecture:** DB-first — `partner_bills` schema → additive migration → OpenAPI + codegen → partner-bills CRUD route handlers → UI. Reuses the Phase 2B `computeAging` util (extracted into a shared `AgingPill` component). The existing Billing Summary/Detail pages become the Client tab's sub-views; a new Partner Billing tab is added. Partner **payments/progress** are deliberately NOT in this plan — they come in Phase 2C-ii; here a partner bill shows amount + aging only.

**Tech Stack:** PostgreSQL + Drizzle, Next.js 15, OpenAPI 3.1 + orval, React Query, shadcn/ui (Tabs), `pg`.

**Spec:** `docs/superpowers/specs/2026-07-11-billing-phase2-design.md` (Section 6 partner subsystem, Section 1 nav).

---

## File Structure

- **Create** `lib/db/src/schema/partner-bills.ts`; **Modify** `lib/db/src/schema/index.ts`.
- **Modify** `lib/api-spec/openapi.yaml` (+ codegen).
- **Create** `app/app/api/partner-bills/route.ts`, `partner-bills/[id]/route.ts`.
- **Create** `app/components/billings/AgingPill.tsx` (shared); **Modify** `app/app/(dashboard)/billings/summary/page.tsx` to use it.
- **Create** `app/components/billings/ClientBillingSummaryTab.tsx`, `ClientBillingDetailTab.tsx` (extracted page bodies), `PartnerBillingTab.tsx`, `CreatePartnerBillDialog.tsx`.
- **Create** `app/app/(dashboard)/billings/page.tsx` (tabs shell); **Modify** `summary/page.tsx` + `detail/page.tsx` → redirects; **Modify** `app/components/layout/Sidebar.tsx`.

Work happens in a dedicated worktree off `main` (created before Task 1).

---

## Task 1: `partner_bills` schema + migration

**Files:** Create `lib/db/src/schema/partner-bills.ts`; Modify `lib/db/src/schema/index.ts`

- [ ] **Step 1: Create `lib/db/src/schema/partner-bills.ts`**

```typescript
import { pgTable, serial, integer, text, numeric, date, timestamp } from "drizzle-orm/pg-core";
import { partnersTable } from "./partners";
import { clientsTable } from "./clients";
import { partnerPurchaseOrdersTable } from "./partner-purchase-orders";
import { usersTable } from "./auth";

export const partnerBillsTable = pgTable("partner_bills", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),                          // PBILL-{partnerPrefix}-MMYY-NNNN
  partnerInvoiceNumber: text("partner_invoice_number"),           // the partner's own number
  partnerId: integer("partner_id").notNull().references(() => partnersTable.id, { onDelete: "restrict" }),
  clientId: integer("client_id").references(() => clientsTable.id, { onDelete: "set null" }),
  partnerPurchaseOrderId: integer("partner_purchase_order_id")
    .references(() => partnerPurchaseOrdersTable.id, { onDelete: "set null" }),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(), // USD
  attachmentUrl: text("attachment_url"),
  attachmentName: text("attachment_name"),
  dateReceived: date("date_received"),
  notes: text("notes"),
  createdById: integer("created_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type PartnerBill = typeof partnerBillsTable.$inferSelect;
```

- [ ] **Step 2: Export from `lib/db/src/schema/index.ts`** — add at the end:
```typescript
export * from "./partner-bills";
```

- [ ] **Step 3: Typecheck libs**

Run: `pnpm -w run typecheck:libs` → 0 errors.

- [ ] **Step 4: Apply migration to the dev DB** — create `lib/db/_apply-2ci.mjs` (temporary; delete after):
```javascript
import pg from "pg";
const { Client } = pg;
const DDL = `
CREATE TABLE IF NOT EXISTS partner_bills (
  id serial PRIMARY KEY,
  code text NOT NULL UNIQUE,
  partner_invoice_number text,
  partner_id integer NOT NULL REFERENCES partners(id) ON DELETE restrict,
  client_id integer REFERENCES clients(id) ON DELETE set null,
  partner_purchase_order_id integer REFERENCES partner_purchase_orders(id) ON DELETE set null,
  amount numeric(14,2) NOT NULL,
  attachment_url text,
  attachment_name text,
  date_received date,
  notes text,
  created_by_id integer REFERENCES users(id) ON DELETE set null,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
`;
const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }
const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query(DDL);
const t = await client.query(`SELECT to_regclass('public.partner_bills') AS tbl`);
console.log("partner_bills:", t.rows[0].tbl);
await client.end();
console.log("2C-i SCHEMA APPLIED OK");
```
Run from the worktree root:
```bash
export DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | head -1 | sed -E 's/^DATABASE_URL=//; s/^"//; s/"$//')"
cd lib/db && node _apply-2ci.mjs && rm _apply-2ci.mjs
```
Expected: `partner_bills: partner_bills`, `2C-i SCHEMA APPLIED OK`, temp script deleted (do NOT commit it).

- [ ] **Step 5: Commit**
```bash
git add lib/db/src/schema/partner-bills.ts lib/db/src/schema/index.ts
git commit -m "feat(db): partner_bills table"
```

---

## Task 2: OpenAPI + codegen

**Files:** Modify `lib/api-spec/openapi.yaml`; regenerate. READ the file; adapt to real conventions.

- [ ] **Step 1: Add tag** (after existing tags): `- { name: partner-bills, description: Bills received from partners }`

- [ ] **Step 2: Add paths**
```yaml
  /partner-bills:
    get:
      operationId: listPartnerBills
      tags: [partner-bills]
      responses:
        "200":
          description: List of partner bills
          content:
            application/json:
              schema: { type: array, items: { $ref: "#/components/schemas/PartnerBill" } }
    post:
      operationId: createPartnerBill
      tags: [partner-bills]
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/PartnerBillInput" }
      responses:
        "201":
          description: Created
          content:
            application/json:
              schema: { $ref: "#/components/schemas/PartnerBill" }
  /partner-bills/{id}:
    patch:
      operationId: updatePartnerBill
      tags: [partner-bills]
      parameters: [ { name: id, in: path, required: true, schema: { type: integer } } ]
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/PartnerBillInput" }
      responses:
        "200":
          description: Updated
          content:
            application/json:
              schema: { $ref: "#/components/schemas/PartnerBill" }
    delete:
      operationId: deletePartnerBill
      tags: [partner-bills]
      parameters: [ { name: id, in: path, required: true, schema: { type: integer } } ]
      responses:
        "204": { description: Deleted }
```

- [ ] **Step 3: Add component schemas**
```yaml
    PartnerBillInput:
      type: object
      required: [partnerId, amount]
      properties:
        partnerId: { type: integer }
        clientId: { type: ["integer", "null"] }
        partnerPurchaseOrderId: { type: ["integer", "null"] }
        partnerInvoiceNumber: { type: ["string", "null"] }
        amount: { type: number }
        attachmentUrl: { type: ["string", "null"] }
        attachmentName: { type: ["string", "null"] }
        dateReceived: { type: ["string", "null"] }
        notes: { type: ["string", "null"] }
    PartnerBill:
      type: object
      required: [id, code, partnerId, partnerName, amount, createdAt]
      properties:
        id: { type: integer }
        code: { type: string }
        partnerInvoiceNumber: { type: ["string", "null"] }
        partnerId: { type: integer }
        partnerName: { type: string }
        clientId: { type: ["integer", "null"] }
        clientName: { type: ["string", "null"] }
        partnerPurchaseOrderId: { type: ["integer", "null"] }
        ppoCode: { type: ["string", "null"] }
        amount: { type: number }
        attachmentUrl: { type: ["string", "null"] }
        attachmentName: { type: ["string", "null"] }
        dateReceived: { type: ["string", "null"] }
        partnerTermDays: { type: ["integer", "null"] }
        notes: { type: ["string", "null"] }
        createdByName: { type: ["string", "null"] }
        createdAt: { type: string }
```

- [ ] **Step 4: Codegen + verify + commit**
```bash
pnpm --filter @workspace/api-spec codegen
```
Verify: `grep -n "useListPartnerBills\|useCreatePartnerBill" lib/api-client-react/src/generated/api.ts` and `ls lib/api-zod/src/generated/types/partnerBill*.ts`.
```bash
git add lib/api-spec/openapi.yaml lib/api-zod/src/generated lib/api-client-react/src/generated
git commit -m "feat(spec): partner-bills endpoints"
```

---

## Task 3: Partner bills API

**Files:** Create `app/app/api/partner-bills/route.ts`, `app/app/api/partner-bills/[id]/route.ts`

- [ ] **Step 1: Create `app/app/api/partner-bills/route.ts`**

```typescript
import { NextResponse } from "next/server";
import { and, count, eq, gte, lt } from "drizzle-orm";
import {
  db, partnerBillsTable, partnersTable, clientsTable, partnerPurchaseOrdersTable,
  paymentTermsTable, usersTable,
} from "@workspace/db";
import { CreatePartnerBillBody } from "@workspace/api-zod";
import { getSession } from "@/lib/auth/session";
import { formatPoCode } from "@/lib/po-codes";

export const runtime = "nodejs";

type Row = typeof partnerBillsTable.$inferSelect;

export async function mapPartnerBill(r: Row) {
  const [partner] = await db.select({ name: partnersTable.name, codePrefix: partnersTable.codePrefix, paymentTermsId: partnersTable.paymentTermsId })
    .from(partnersTable).where(eq(partnersTable.id, r.partnerId));
  const client = r.clientId
    ? (await db.select({ name: clientsTable.name }).from(clientsTable).where(eq(clientsTable.id, r.clientId)))[0]
    : null;
  const ppo = r.partnerPurchaseOrderId
    ? (await db.select({ code: partnerPurchaseOrdersTable.code }).from(partnerPurchaseOrdersTable).where(eq(partnerPurchaseOrdersTable.id, r.partnerPurchaseOrderId)))[0]
    : null;
  let partnerTermDays: number | null = null;
  if (partner?.paymentTermsId != null) {
    const [pt] = await db.select({ days: paymentTermsTable.days }).from(paymentTermsTable).where(eq(paymentTermsTable.id, partner.paymentTermsId));
    partnerTermDays = pt?.days ?? null;
  }
  let createdByName: string | null = null;
  if (r.createdById != null) {
    const [u] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, r.createdById));
    createdByName = u?.name ?? null;
  }
  return {
    id: r.id, code: r.code, partnerInvoiceNumber: r.partnerInvoiceNumber ?? null,
    partnerId: r.partnerId, partnerName: partner?.name ?? "—",
    clientId: r.clientId ?? null, clientName: client?.name ?? null,
    partnerPurchaseOrderId: r.partnerPurchaseOrderId ?? null, ppoCode: ppo?.code ?? null,
    amount: Number(r.amount), attachmentUrl: r.attachmentUrl ?? null, attachmentName: r.attachmentName ?? null,
    dateReceived: r.dateReceived ?? null, partnerTermDays, notes: r.notes ?? null,
    createdByName, createdAt: r.createdAt.toISOString(),
  };
}

async function nextPbillCode(partnerId: number): Promise<string> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const [{ value }] = await db.select({ value: count() }).from(partnerBillsTable)
    .where(and(gte(partnerBillsTable.createdAt, monthStart), lt(partnerBillsTable.createdAt, monthEnd)));
  const [partner] = await db.select({ codePrefix: partnersTable.codePrefix }).from(partnersTable).where(eq(partnersTable.id, partnerId));
  const prefix = partner?.codePrefix?.trim();
  if (!prefix) throw new Error("Set a code prefix on the partner first");
  return "PBILL-" + formatPoCode(prefix, now, Number(value) + 1);
}

export async function GET(): Promise<Response> {
  const rows = await db.select().from(partnerBillsTable).orderBy(partnerBillsTable.createdAt);
  return NextResponse.json(await Promise.all(rows.map(mapPartnerBill)));
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = CreatePartnerBillBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const user = await getSession();
  let code: string;
  try { code = await nextPbillCode(parsed.data.partnerId); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 400 }); }
  const [row] = await db.insert(partnerBillsTable).values({
    code,
    partnerInvoiceNumber: parsed.data.partnerInvoiceNumber ?? null,
    partnerId: parsed.data.partnerId,
    clientId: parsed.data.clientId ?? null,
    partnerPurchaseOrderId: parsed.data.partnerPurchaseOrderId ?? null,
    amount: String(parsed.data.amount),
    attachmentUrl: parsed.data.attachmentUrl ?? null,
    attachmentName: parsed.data.attachmentName ?? null,
    dateReceived: parsed.data.dateReceived ?? null,
    notes: parsed.data.notes ?? null,
    createdById: user?.sub ?? null,
  }).returning();
  return NextResponse.json(await mapPartnerBill(row), { status: 201 });
}
```

- [ ] **Step 2: Create `app/app/api/partner-bills/[id]/route.ts`**

```typescript
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, partnerBillsTable } from "@workspace/db";
import { UpdatePartnerBillBody } from "@workspace/api-zod";
import { mapPartnerBill } from "../route";

export const runtime = "nodejs";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = UpdatePartnerBillBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const [row] = await db.update(partnerBillsTable).set({
    partnerInvoiceNumber: parsed.data.partnerInvoiceNumber ?? null,
    partnerId: parsed.data.partnerId,
    clientId: parsed.data.clientId ?? null,
    partnerPurchaseOrderId: parsed.data.partnerPurchaseOrderId ?? null,
    amount: String(parsed.data.amount),
    attachmentUrl: parsed.data.attachmentUrl ?? null,
    attachmentName: parsed.data.attachmentName ?? null,
    dateReceived: parsed.data.dateReceived ?? null,
    notes: parsed.data.notes ?? null,
  }).where(eq(partnerBillsTable.id, Number(id))).returning();
  if (!row) return NextResponse.json({ error: "Partner bill not found" }, { status: 404 });
  return NextResponse.json(await mapPartnerBill(row));
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const [row] = await db.delete(partnerBillsTable).where(eq(partnerBillsTable.id, Number(id))).returning();
  if (!row) return NextResponse.json({ error: "Partner bill not found" }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 3: Verify + commit**

Run: `cd app && pnpm typecheck` → 0 errors.
```bash
git add app/app/api/partner-bills
git commit -m "feat(api): partner-bills CRUD with PBILL- code + aging term days"
```

---

## Task 4: Shared AgingPill component

**Files:** Create `app/components/billings/AgingPill.tsx`; Modify `app/app/(dashboard)/billings/summary/page.tsx`

- [ ] **Step 1: Create `app/components/billings/AgingPill.tsx`**

```tsx
"use client";

import { computeAging } from "@/lib/aging";
import { cn } from "@/lib/utils";

const PILL: Record<string, string> = {
  green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  yellow: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  red: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  neutral: "bg-muted text-muted-foreground",
};

export function AgingPill({ start, termDays, settled }: { start: string | null; termDays: number | null; settled: boolean }) {
  const a = computeAging({ start: start ? new Date(start) : null, termDays, now: new Date(), settled });
  const label = settled ? "Settled"
    : a.color === "neutral" ? "—"
    : a.overdue ? `Overdue ${Math.abs(a.daysLeft ?? 0)}d`
    : `${a.daysLeft}d left`;
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold", PILL[a.color])}>
      {label}
    </span>
  );
}
```

- [ ] **Step 2: Refactor the Summary page to use it**

READ `app/app/(dashboard)/billings/summary/page.tsx`. It currently inlines `computeAging` + an `AGING_PILL` map + the pill JSX in the `BillingGroup` row. Replace the inline aging `<td>` content with `<AgingPill start={b.invoiceGeneratedAt ?? null} termDays={b.paymentTermDays ?? null} settled={settled} />` (keep the surrounding `<td>` and the `settled` computation). Remove the now-unused inline `computeAging` import and `AGING_PILL` map IF nothing else uses them. Import `AgingPill`. Confirm the rendered pill is unchanged.

- [ ] **Step 3: Verify + commit**

Run: `cd app && pnpm typecheck` → 0 errors. `pnpm vitest run` → all pass.
```bash
git add app/components/billings/AgingPill.tsx app/app/\(dashboard\)/billings/summary/page.tsx
git commit -m "refactor(billing): extract shared AgingPill; Summary reuses it"
```

---

## Task 5: Partner Billing tab + create dialog

**Files:** Create `app/components/billings/CreatePartnerBillDialog.tsx`, `app/components/billings/PartnerBillingTab.tsx`

- [ ] **Step 1: Create `app/components/billings/CreatePartnerBillDialog.tsx`**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useListPartners, useListClients, useCreatePartnerBill, useUpdatePartnerBill } from "@workspace/api-client-react";
import type { PartnerBill } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

type Ppo = { id: number; code: string; partnerId: number; clientId: number; totalBudget: number };

async function uploadFile(file: File): Promise<{ url: string; name: string }> {
  const fd = new FormData(); fd.append("file", file);
  const res = await fetch("/api/uploads/payment-attachment", { method: "POST", body: fd });
  if (!res.ok) throw new Error("Upload failed");
  const { url } = await res.json();
  return { url, name: file.name };
}

export function CreatePartnerBillDialog({ open, editBill, onClose, onSuccess }: {
  open: boolean; editBill?: PartnerBill; onClose: () => void; onSuccess: () => void;
}) {
  const { toast } = useToast();
  const { data: partners } = useListPartners();
  const { data: clients } = useListClients();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const [partnerId, setPartnerId] = useState<number | null>(null);
  const [clientId, setClientId] = useState<number | null>(null);
  const [ppos, setPpos] = useState<Ppo[]>([]);
  const [ppoId, setPpoId] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [partnerInvoiceNumber, setPin] = useState("");
  const [dateReceived, setDateReceived] = useState("");
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [attachmentName, setAttachmentName] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (open && editBill) {
      setPartnerId(editBill.partnerId); setClientId(editBill.clientId ?? null);
      setPpoId(editBill.partnerPurchaseOrderId ?? null); setAmount(String(editBill.amount));
      setPin(editBill.partnerInvoiceNumber ?? ""); setDateReceived(editBill.dateReceived ?? "");
      setAttachmentUrl(editBill.attachmentUrl ?? ""); setAttachmentName(editBill.attachmentName ?? "");
      setNotes(editBill.notes ?? "");
    } else if (open) {
      setPartnerId(null); setClientId(null); setPpos([]); setPpoId(null); setAmount("");
      setPin(""); setDateReceived(""); setAttachmentUrl(""); setAttachmentName(""); setNotes("");
    }
  }, [open, editBill]);

  // Load the partner's PPOs (for prefill), optionally narrowed to the client.
  useEffect(() => {
    if (partnerId) {
      fetch(`/api/partner-purchase-orders`).then(r => r.json())
        .then((rows: Ppo[]) => setPpos(rows.filter(p => p.partnerId === partnerId && (!clientId || p.clientId === clientId))))
        .catch(() => setPpos([]));
    } else setPpos([]);
  }, [partnerId, clientId]);

  const pickPpo = (id: number) => {
    setPpoId(id);
    const p = ppos.find(x => x.id === id);
    if (p) setAmount(String(p.totalBudget)); // prefill USD amount from the PO budget (editable)
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    try { const { url, name } = await uploadFile(file); setAttachmentUrl(url); setAttachmentName(name); toast({ title: "File uploaded" }); }
    catch { toast({ title: "Upload failed", variant: "destructive" }); }
    finally { setUploading(false); }
  };

  const create = useCreatePartnerBill({ mutation: {
    onSuccess: () => { onSuccess(); onClose(); toast({ title: "Partner bill recorded" }); },
    onError: () => toast({ title: "Failed to record bill", variant: "destructive" }),
  }});
  const update = useUpdatePartnerBill({ mutation: {
    onSuccess: () => { onSuccess(); onClose(); toast({ title: "Partner bill updated" }); },
    onError: () => toast({ title: "Failed to update bill", variant: "destructive" }),
  }});

  const submit = () => {
    if (!partnerId || amount.trim() === "") { toast({ title: "Partner and amount are required", variant: "destructive" }); return; }
    const data = {
      partnerId, clientId, partnerPurchaseOrderId: ppoId,
      partnerInvoiceNumber: partnerInvoiceNumber || null, amount: parseFloat(amount),
      attachmentUrl: attachmentUrl || null, attachmentName: attachmentName || null,
      dateReceived: dateReceived || null, notes: notes || null,
    };
    if (editBill) update.mutate({ id: editBill.id, data }); else create.mutate({ data });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{editBill ? "Edit Partner Bill" : "Record Partner Bill"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs space-y-1"><span className="text-muted-foreground">Partner</span>
              <Select value={partnerId ? String(partnerId) : ""} onValueChange={v => setPartnerId(Number(v))}>
                <SelectTrigger><SelectValue placeholder="Partner" /></SelectTrigger>
                <SelectContent>{partners?.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
            </label>
            <label className="text-xs space-y-1"><span className="text-muted-foreground">Client</span>
              <Select value={clientId ? String(clientId) : "none"} onValueChange={v => setClientId(v === "none" ? null : Number(v))}>
                <SelectTrigger><SelectValue placeholder="Client" /></SelectTrigger>
                <SelectContent><SelectItem value="none">None</SelectItem>{clients?.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </label>
          </div>
          <label className="text-xs space-y-1 block"><span className="text-muted-foreground">Partner PO (prefills amount)</span>
            <Select value={ppoId ? String(ppoId) : "none"} onValueChange={v => v === "none" ? setPpoId(null) : pickPpo(Number(v))}>
              <SelectTrigger><SelectValue placeholder="Optional — select a PO" /></SelectTrigger>
              <SelectContent><SelectItem value="none">None</SelectItem>{ppos.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.code} · ${p.totalBudget}</SelectItem>)}</SelectContent>
            </Select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs space-y-1"><span className="text-muted-foreground">Amount (USD)</span>
              <Input type="number" step="0.01" min={0} value={amount} onChange={e => setAmount(e.target.value)} /></label>
            <label className="text-xs space-y-1"><span className="text-muted-foreground">Their Invoice #</span>
              <Input value={partnerInvoiceNumber} onChange={e => setPin(e.target.value)} placeholder="Partner's number" /></label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs space-y-1"><span className="text-muted-foreground">Date Received</span>
              <Input type="date" value={dateReceived} onChange={e => setDateReceived(e.target.value)} /></label>
            <label className="text-xs space-y-1"><span className="text-muted-foreground">Attachment</span>
              <div className="flex items-center gap-2">
                <Input type="file" accept="image/*,.pdf" ref={fileRef} disabled={uploading}
                  onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0])} className="text-xs" />
                {attachmentUrl && <a href={attachmentUrl} target="_blank" rel="noreferrer" className="text-xs text-primary underline">View</a>}
              </div>
            </label>
          </div>
          <Textarea rows={2} placeholder="Notes..." value={notes} onChange={e => setNotes(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={submit} disabled={create.isPending || update.isPending || uploading}>
              {create.isPending || update.isPending ? "Saving..." : editBill ? "Update" : "Record Bill"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```
VERIFY the generated hook mutate shapes (`useCreatePartnerBill` → `{ data }`, `useUpdatePartnerBill` → `{ id, data }`) and adapt if different. VERIFY `mapPpoRow` (in `app/app/api/partner-purchase-orders/route.ts`) returns `partnerId`, `clientId`, `totalBudget`, `code` (it does) so the raw-fetch filter + prefill work.

- [ ] **Step 2: Create `app/components/billings/PartnerBillingTab.tsx`**

```tsx
"use client";

import { useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useListPartnerBills, useDeletePartnerBill, getListPartnerBillsQueryKey } from "@workspace/api-client-react";
import type { PartnerBill } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { AgingPill } from "@/components/billings/AgingPill";
import { CreatePartnerBillDialog } from "@/components/billings/CreatePartnerBillDialog";

function fmt(n: number) { return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export function PartnerBillingTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: bills, isLoading } = useListPartnerBills();
  const [addOpen, setAddOpen] = useState(false);
  const [editBill, setEditBill] = useState<PartnerBill | null>(null);
  const del = useDeletePartnerBill({ mutation: {
    onSuccess: () => { qc.invalidateQueries({ queryKey: getListPartnerBillsQueryKey() }); toast({ title: "Partner bill deleted" }); },
    onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
  }});

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{bills?.length ?? 0} partner bills</p>
        <Button size="sm" className="gap-1.5 text-xs" onClick={() => setAddOpen(true)}><Plus className="h-3.5 w-3.5" /> Record Partner Bill</Button>
      </div>
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-x-auto">
        <table className="w-full min-w-max">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {["#", "PBILL Code", "Partner", "Client", "Their Inv #", "Amount (USD)", "Date Received", "Aging", "Attachment", "Actions"].map(h => (
                <th key={h} className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(3)].map((_, i) => <tr key={i} className="border-b border-border">{[...Array(10)].map((_, j) => <td key={j} className="px-3 py-2"><Skeleton className="h-3 w-16" /></td>)}</tr>)
            ) : !bills?.length ? (
              <tr><td colSpan={10} className="px-5 py-10 text-center text-sm text-muted-foreground">No partner bills yet</td></tr>
            ) : bills.map((b, i) => (
              <tr key={b.id} className="border-b border-border last:border-0 hover:bg-muted/20 text-xs">
                <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                <td className="px-3 py-2 font-semibold">{b.code}</td>
                <td className="px-3 py-2">{b.partnerName}</td>
                <td className="px-3 py-2">{b.clientName ?? "—"}</td>
                <td className="px-3 py-2">{b.partnerInvoiceNumber ?? "—"}</td>
                <td className="px-3 py-2 font-semibold">{fmt(b.amount)}</td>
                <td className="px-3 py-2">{b.dateReceived ? new Date(b.dateReceived).toLocaleDateString() : "—"}</td>
                <td className="px-3 py-2"><AgingPill start={b.dateReceived ?? null} termDays={b.partnerTermDays ?? null} settled={false} /></td>
                <td className="px-3 py-2">{b.attachmentUrl ? <a href={b.attachmentUrl} target="_blank" rel="noreferrer" className="text-primary underline text-[10px]">View</a> : "—"}</td>
                <td className="px-3 py-2">
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setEditBill(b)}><Pencil className="h-3 w-3" /></Button>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-red-600" onClick={() => { if (confirm("Delete this partner bill?")) del.mutate({ id: b.id }); }}><Trash2 className="h-3 w-3" /></Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <CreatePartnerBillDialog open={addOpen || editBill != null} editBill={editBill ?? undefined}
        onClose={() => { setAddOpen(false); setEditBill(null); }}
        onSuccess={() => qc.invalidateQueries({ queryKey: getListPartnerBillsQueryKey() })} />
    </div>
  );
}
```
(Aging `settled` is `false` here — partner payments/settlement arrive in Phase 2C-ii.)

- [ ] **Step 3: Verify + commit**

Run: `cd app && pnpm typecheck` → 0 errors.
```bash
git add app/components/billings/CreatePartnerBillDialog.tsx app/components/billings/PartnerBillingTab.tsx
git commit -m "feat(billing): Partner Billing tab + record-partner-bill dialog"
```

---

## Task 6: Billing Client/Partner tabs shell + sidebar

**Files:** Create `app/components/billings/ClientBillingSummaryTab.tsx`, `ClientBillingDetailTab.tsx`; Create/rewrite `app/app/(dashboard)/billings/page.tsx`; Modify `summary/page.tsx`, `detail/page.tsx`, `app/components/layout/Sidebar.tsx`

- [ ] **Step 1: Extract the existing page bodies into components**
- READ `app/app/(dashboard)/billings/summary/page.tsx`. Move its component (currently the default-exported page function + its helper `BillingGroup` etc.) into `app/components/billings/ClientBillingSummaryTab.tsx` as a NAMED export `export function ClientBillingSummaryTab() { … }` — the SAME JSX/logic, minus the `PermissionGuard` wrapper (the tabs shell will guard). Keep all imports it needs.
- Do the same for `app/app/(dashboard)/billings/detail/page.tsx` → `app/components/billings/ClientBillingDetailTab.tsx` (`export function ClientBillingDetailTab()`), minus its `PermissionGuard`.

- [ ] **Step 2: Rewrite `app/app/(dashboard)/billings/page.tsx` as the tabs shell**

```tsx
"use client";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PermissionGuard } from "@/components/PermissionGuard";
import { useHasPermission } from "@/lib/auth/user-context";
import { ClientBillingSummaryTab } from "@/components/billings/ClientBillingSummaryTab";
import { ClientBillingDetailTab } from "@/components/billings/ClientBillingDetailTab";
import { PartnerBillingTab } from "@/components/billings/PartnerBillingTab";

export default function BillingPage() {
  const canDetail = useHasPermission("View Billing Detail");
  return (
    <PermissionGuard permission="View Billings">
      <div className="space-y-4">
        <h1 className="text-xl font-bold">Billing</h1>
        <Tabs defaultValue="client">
          <TabsList>
            <TabsTrigger value="client">Client</TabsTrigger>
            <TabsTrigger value="partner">Partner</TabsTrigger>
          </TabsList>
          <TabsContent value="client">
            <Tabs defaultValue="summary">
              <TabsList>
                <TabsTrigger value="summary">Summary</TabsTrigger>
                {canDetail && <TabsTrigger value="detail">Detail</TabsTrigger>}
              </TabsList>
              <TabsContent value="summary"><ClientBillingSummaryTab /></TabsContent>
              {canDetail && <TabsContent value="detail"><ClientBillingDetailTab /></TabsContent>}
            </Tabs>
          </TabsContent>
          <TabsContent value="partner"><PartnerBillingTab /></TabsContent>
        </Tabs>
      </div>
    </PermissionGuard>
  );
}
```
Check `useHasPermission` is exported from `@/lib/auth/user-context` (it is — used by other pages); adapt the import if the hook name differs. If the extracted `ClientBillingSummaryTab`/`ClientBillingDetailTab` still render their own `<h1>` titles, remove those inner titles so the shell owns the heading (optional polish).

- [ ] **Step 3: Redirect the old sub-routes**

Replace the bodies of `app/app/(dashboard)/billings/summary/page.tsx` and `app/app/(dashboard)/billings/detail/page.tsx` with redirects (server components):
```tsx
import { redirect } from "next/navigation";
export default function Page() { redirect("/billings"); }
```

- [ ] **Step 4: Sidebar** — READ `app/components/layout/Sidebar.tsx`. In `financialsItems`, replace the two entries (`Billing Summary` → `/billings/summary`, `Billing Detail` → `/billings/detail`) with a SINGLE entry:
```tsx
{ href: "/billings", label: "Billing", icon: FileText, permission: "View Billings" },
```
(Keep Payments + Cost. Drop the now-unused `ScrollText` icon import if nothing else uses it.)

- [ ] **Step 5: Verify + commit**

Run: `cd app && pnpm typecheck` → 0 errors. `pnpm vitest run` → all pass. Load `/billings`: top tabs Client | Partner; Client shows Summary/Detail sub-tabs (Detail only with the permission); Partner shows the Partner Billing table; `/billings/summary` and `/billings/detail` redirect to `/billings`; the sidebar shows one "Billing" item.
```bash
git add app/components/billings/ClientBillingSummaryTab.tsx app/components/billings/ClientBillingDetailTab.tsx app/app/\(dashboard\)/billings app/components/layout/Sidebar.tsx
git commit -m "feat(billing): Client/Partner tabs shell; single Billing nav item"
```

---

## Self-Review checklist

- **Spec coverage (2C-i):** partner_bills schema/migration (T1) · openapi/codegen (T2) · partner-bills CRUD + PBILL code + partner term days (T3) · shared AgingPill (T4) · Partner Billing tab + create dialog with PO-prefill amount + their invoice # + attachment + date received (T5) · Billing Client/Partner tabs + sidebar (T6). Partner payments/progress deferred to 2C-ii (noted).
- **Placeholder scan:** none — complete code; UI-extraction steps instruct reading + moving the exact existing code.
- **Type consistency:** `mapPartnerBill` return shape matches the `PartnerBill` openapi schema (partnerName, ppoCode, partnerTermDays, dateReceived); `AgingPill({ start, termDays, settled })` used in Summary (T4) and Partner Billing (T5); PBILL uses `formatPoCode` + `"PBILL-"` prefix consistent with the CPO/PPO/INV pattern.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-11-billing-phase2c-i.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, two-stage review.
2. **Inline Execution** — run tasks here with checkpoints.

After 2C-i lands I'll write 2C-ii (partner payments + Payments tabs + partner-bill progress/settlement).
