# Financials Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add full-CRUD Financials section (Transactions, Billings/invoices, Payments, Cost) behind a collapsible sidebar group; rename existing Billing→Transactions; add Edit to Transactions; generate PDF invoices; accept file uploads for payments via Supabase Storage.

**Architecture:** DB-first — migration → Drizzle schemas → OpenAPI → codegen → API routes → frontend. New sidebar group component wraps four sub-modules. Bills aggregate billing_records; payments settle bills with per-bill allocation; cost tracks monthly spend by resource.

**Tech Stack:** PostgreSQL + Drizzle ORM, Express + multer, @supabase/supabase-js (storage), OpenAPI 3.1 + Orval codegen, React + Wouter + TanStack Query, shadcn/ui, jspdf + jspdf-autotable

---

## File Map

| Action | Path |
|---|---|
| Create | `lib/db/migrations/0005_financials.sql` |
| Create | `lib/db/src/schema/bills.ts` |
| Create | `lib/db/src/schema/bill-transactions.ts` |
| Create | `lib/db/src/schema/payments.ts` |
| Create | `lib/db/src/schema/payment-bills.ts` |
| Create | `lib/db/src/schema/cost-resources.ts` |
| Modify | `lib/db/src/schema/index.ts` |
| Modify | `lib/api-spec/openapi.yaml` |
| Generated | `lib/api-zod/src/generated/**` |
| Generated | `lib/api-client-react/src/generated/**` |
| Modify | `artifacts/api-server/src/routes/billing-records.ts` |
| Create | `artifacts/api-server/src/routes/bills.ts` |
| Create | `artifacts/api-server/src/routes/payments.ts` |
| Create | `artifacts/api-server/src/routes/cost-resources.ts` |
| Create | `artifacts/api-server/src/routes/file-upload.ts` |
| Modify | `artifacts/api-server/src/routes/index.ts` |
| Modify | `artifacts/api-server/src/lib/seed.ts` |
| Modify | `artifacts/adops/src/lib/auth.ts` |
| Modify | `artifacts/adops/src/components/layout/Sidebar.tsx` |
| Modify | `artifacts/adops/src/App.tsx` |
| Rename→Modify | `artifacts/adops/src/pages/Billing.tsx` → `Transactions.tsx` |
| Create | `artifacts/adops/src/pages/Billings.tsx` |
| Create | `artifacts/adops/src/pages/Payments.tsx` |
| Create | `artifacts/adops/src/pages/Cost.tsx` |

---

## Task 1: Migration SQL — write and apply

**Files:** Create `lib/db/migrations/0005_financials.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- 0005_financials.sql
-- Adds bills, bill_transactions, payments, payment_bills, cost_resources

CREATE TABLE bills (
  id         serial PRIMARY KEY,
  bill_number text NOT NULL UNIQUE,
  client_id  integer REFERENCES clients(id) ON DELETE SET NULL,
  buying_house_id integer REFERENCES buying_houses(id) ON DELETE SET NULL,
  status     text NOT NULL DEFAULT 'outstanding',
  notes      text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE bill_transactions (
  id                 serial PRIMARY KEY,
  bill_id            integer NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  billing_record_id  integer NOT NULL REFERENCES billing_records(id) ON DELETE CASCADE,
  UNIQUE(bill_id, billing_record_id)
);

CREATE TABLE payments (
  id               serial PRIMARY KEY,
  mode             text NOT NULL,
  total_amount     numeric(14,2) NOT NULL,
  notes            text,
  cheque_image_url text,
  receipt_url      text,
  created_by       text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payment_bills (
  id             serial PRIMARY KEY,
  payment_id     integer NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  bill_id        integer NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  amount_applied numeric(14,2) NOT NULL,
  UNIQUE(payment_id, bill_id)
);

CREATE TABLE cost_resources (
  id         serial PRIMARY KEY,
  name       text NOT NULL,
  amount     numeric(14,2) NOT NULL,
  period     text NOT NULL,
  notes      text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

- [ ] **Step 2: Apply the migration**

Check pg version: `ls node_modules/.pnpm/ | findstr "pg@"`

Create `scripts/run-0005.mjs`:
```javascript
import pg from './node_modules/.pnpm/pg@8.20.0/node_modules/pg/esm/index.mjs';
import { readFileSync } from 'fs';
const { Client } = pg;
const client = new Client({
  connectionString: 'postgresql://postgres.btvxavdscifcvincwzlo:Advengers786.@aws-1-ap-south-1.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false }
});
await client.connect();
await client.query(readFileSync('lib/db/migrations/0005_financials.sql', 'utf8'));
console.log('Migration 0005 applied');
await client.end();
```

Run: `node scripts/run-0005.mjs` then delete it.

- [ ] **Step 3: Commit**
```bash
git add lib/db/migrations/0005_financials.sql
git commit -m "feat(db): migration 0005 — bills, payments, cost_resources"
```

---

## Task 2: Drizzle schemas

**Files:** Create 5 new schema files; modify index.ts

- [ ] **Step 1: Create `lib/db/src/schema/bills.ts`**
```typescript
import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { clientsTable } from "./clients";
import { buyingHousesTable } from "./buying-houses";

export const billsTable = pgTable("bills", {
  id: serial("id").primaryKey(),
  billNumber: text("bill_number").notNull().unique(),
  clientId: integer("client_id").references(() => clientsTable.id, { onDelete: "set null" }),
  buyingHouseId: integer("buying_house_id").references(() => buyingHousesTable.id, { onDelete: "set null" }),
  status: text("status").notNull().default("outstanding"),
  notes: text("notes"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Bill = typeof billsTable.$inferSelect;
```

- [ ] **Step 2: Create `lib/db/src/schema/bill-transactions.ts`**
```typescript
import { pgTable, serial, integer, unique } from "drizzle-orm/pg-core";
import { billsTable } from "./bills";
import { billingRecordsTable } from "./billing-records";

export const billTransactionsTable = pgTable("bill_transactions", {
  id: serial("id").primaryKey(),
  billId: integer("bill_id").notNull().references(() => billsTable.id, { onDelete: "cascade" }),
  billingRecordId: integer("billing_record_id").notNull().references(() => billingRecordsTable.id, { onDelete: "cascade" }),
}, (t) => [unique().on(t.billId, t.billingRecordId)]);

export type BillTransaction = typeof billTransactionsTable.$inferSelect;
```

- [ ] **Step 3: Create `lib/db/src/schema/payments.ts`**
```typescript
import { pgTable, serial, text, numeric, timestamp } from "drizzle-orm/pg-core";

export const paymentsTable = pgTable("payments", {
  id: serial("id").primaryKey(),
  mode: text("mode").notNull(),
  totalAmount: numeric("total_amount", { precision: 14, scale: 2 }).notNull(),
  notes: text("notes"),
  chequeImageUrl: text("cheque_image_url"),
  receiptUrl: text("receipt_url"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Payment = typeof paymentsTable.$inferSelect;
```

- [ ] **Step 4: Create `lib/db/src/schema/payment-bills.ts`**
```typescript
import { pgTable, serial, integer, numeric, unique } from "drizzle-orm/pg-core";
import { paymentsTable } from "./payments";
import { billsTable } from "./bills";

export const paymentBillsTable = pgTable("payment_bills", {
  id: serial("id").primaryKey(),
  paymentId: integer("payment_id").notNull().references(() => paymentsTable.id, { onDelete: "cascade" }),
  billId: integer("bill_id").notNull().references(() => billsTable.id, { onDelete: "cascade" }),
  amountApplied: numeric("amount_applied", { precision: 14, scale: 2 }).notNull(),
}, (t) => [unique().on(t.paymentId, t.billId)]);

export type PaymentBill = typeof paymentBillsTable.$inferSelect;
```

- [ ] **Step 5: Create `lib/db/src/schema/cost-resources.ts`**
```typescript
import { pgTable, serial, text, numeric, timestamp } from "drizzle-orm/pg-core";

export const costResourcesTable = pgTable("cost_resources", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  period: text("period").notNull(),
  notes: text("notes"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CostResource = typeof costResourcesTable.$inferSelect;
```

- [ ] **Step 6: Update `lib/db/src/schema/index.ts`**
```typescript
export * from "./buying-houses";
export * from "./clients";
export * from "./platforms";
export * from "./campaigns";
export * from "./transactions";
export * from "./auth";
export * from "./platform-cost-models";
export * from "./billing-records";
export * from "./bills";
export * from "./bill-transactions";
export * from "./payments";
export * from "./payment-bills";
export * from "./cost-resources";
```

- [ ] **Step 7: Commit**
```bash
git add lib/db/src/schema/
git commit -m "feat(db): add bills, bill-transactions, payments, payment-bills, cost-resources schemas"
```

---

## Task 3: OpenAPI spec additions

**Files:** Modify `lib/api-spec/openapi.yaml`

Read the file first, then add in sequence:

- [ ] **Step 1: Add new tags** (after `billing` tag)
```yaml
  - name: bills
    description: Invoice/bill management
  - name: payments
    description: Payment recording and settlement
  - name: cost-resources
    description: Business cost resource tracking
  - name: file-upload
    description: File attachment uploads
```

- [ ] **Step 2: Add PATCH billing-record endpoint**

After the existing `DELETE /platforms/{id}/billing-records/{recordId}` operation, add:
```yaml
  /platforms/{id}/billing-records/{recordId}:
    patch:
      operationId: updateBillingRecord
      tags: [billing]
      summary: Update a billing record
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
        - name: recordId
          in: path
          required: true
          schema:
            type: integer
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/BillingRecordInput"
      responses:
        "200":
          description: Updated billing record
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/BillingRecord"
```

- [ ] **Step 3: Add bills paths**
```yaml
  /bills:
    get:
      operationId: listBills
      tags: [bills]
      summary: List all bills
      parameters:
        - name: clientId
          in: query
          schema:
            type: ["integer", "null"]
        - name: buyingHouseId
          in: query
          schema:
            type: ["integer", "null"]
        - name: status
          in: query
          schema:
            type: ["string", "null"]
      responses:
        "200":
          description: List of bills
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/BillSummary"
    post:
      operationId: createBill
      tags: [bills]
      summary: Create a bill
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/BillInput"
      responses:
        "201":
          description: Created bill
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/BillDetail"

  /bills/{id}:
    get:
      operationId: getBill
      tags: [bills]
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      responses:
        "200":
          description: Bill detail with transactions
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/BillDetail"
    patch:
      operationId: updateBill
      tags: [bills]
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/BillInput"
      responses:
        "200":
          description: Updated bill
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/BillDetail"
    delete:
      operationId: deleteBill
      tags: [bills]
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      responses:
        "204":
          description: Deleted
```

- [ ] **Step 4: Add payments paths**
```yaml
  /payments:
    get:
      operationId: listPayments
      tags: [payments]
      summary: List all payments
      responses:
        "200":
          description: List of payments
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/PaymentDetail"
    post:
      operationId: createPayment
      tags: [payments]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/PaymentInput"
      responses:
        "201":
          description: Created payment
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/PaymentDetail"

  /payments/{id}:
    patch:
      operationId: updatePayment
      tags: [payments]
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/PaymentInput"
      responses:
        "200":
          description: Updated payment
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/PaymentDetail"
    delete:
      operationId: deletePayment
      tags: [payments]
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      responses:
        "204":
          description: Deleted
```

- [ ] **Step 5: Add cost-resources paths**
```yaml
  /cost-resources:
    get:
      operationId: listCostResources
      tags: [cost-resources]
      parameters:
        - name: period
          in: query
          schema:
            type: ["string", "null"]
      responses:
        "200":
          description: List of cost resources
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/CostResource"
    post:
      operationId: createCostResource
      tags: [cost-resources]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/CostResourceInput"
      responses:
        "201":
          description: Created
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/CostResource"

  /cost-resources/{id}:
    patch:
      operationId: updateCostResource
      tags: [cost-resources]
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/CostResourceInput"
      responses:
        "200":
          description: Updated
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/CostResource"
    delete:
      operationId: deleteCostResource
      tags: [cost-resources]
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      responses:
        "204":
          description: Deleted
```

- [ ] **Step 6: Add file-upload path**
```yaml
  /uploads/payment-attachment:
    post:
      operationId: uploadPaymentAttachment
      tags: [file-upload]
      summary: Upload cheque image or payment receipt
      requestBody:
        required: true
        content:
          multipart/form-data:
            schema:
              type: object
              required: [file]
              properties:
                file:
                  type: string
                  format: binary
      responses:
        "200":
          description: Upload result
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/UploadResult"
```

- [ ] **Step 7: Add component schemas** (in `components.schemas` section)
```yaml
    BillSummary:
      type: object
      required: [id, billNumber, status, totalReceivable, totalPaid, totalPending, createdAt]
      properties:
        id:
          type: integer
        billNumber:
          type: string
        clientId:
          type: ["integer", "null"]
        clientName:
          type: ["string", "null"]
        buyingHouseId:
          type: ["integer", "null"]
        buyingHouseName:
          type: ["string", "null"]
        status:
          type: string
        totalReceivable:
          type: number
        totalPaid:
          type: number
        totalPending:
          type: number
        transactionCount:
          type: integer
        notes:
          type: ["string", "null"]
        createdBy:
          type: ["string", "null"]
        createdAt:
          type: string

    BillDetail:
      type: object
      required: [id, billNumber, status, totalReceivable, totalPaid, totalPending, transactions, payments, createdAt]
      properties:
        id:
          type: integer
        billNumber:
          type: string
        clientId:
          type: ["integer", "null"]
        clientName:
          type: ["string", "null"]
        buyingHouseId:
          type: ["integer", "null"]
        buyingHouseName:
          type: ["string", "null"]
        status:
          type: string
        totalReceivable:
          type: number
        totalPaid:
          type: number
        totalPending:
          type: number
        notes:
          type: ["string", "null"]
        createdBy:
          type: ["string", "null"]
        createdAt:
          type: string
        transactions:
          type: array
          items:
            $ref: "#/components/schemas/BillingRecord"
        payments:
          type: array
          items:
            type: object
            required: [paymentId, amountApplied]
            properties:
              paymentId:
                type: integer
              amountApplied:
                type: number

    BillInput:
      type: object
      required: [billingRecordIds]
      properties:
        clientId:
          type: ["integer", "null"]
        buyingHouseId:
          type: ["integer", "null"]
        billingRecordIds:
          type: array
          items:
            type: integer
        notes:
          type: ["string", "null"]

    PaymentAllocation:
      type: object
      required: [billId, amountApplied]
      properties:
        billId:
          type: integer
        amountApplied:
          type: number

    PaymentInput:
      type: object
      required: [mode, allocations]
      properties:
        mode:
          type: string
        notes:
          type: ["string", "null"]
        chequeImageUrl:
          type: ["string", "null"]
        receiptUrl:
          type: ["string", "null"]
        allocations:
          type: array
          items:
            $ref: "#/components/schemas/PaymentAllocation"

    PaymentDetail:
      type: object
      required: [id, mode, totalAmount, allocations, createdAt]
      properties:
        id:
          type: integer
        mode:
          type: string
        totalAmount:
          type: number
        notes:
          type: ["string", "null"]
        chequeImageUrl:
          type: ["string", "null"]
        receiptUrl:
          type: ["string", "null"]
        createdBy:
          type: ["string", "null"]
        createdAt:
          type: string
        allocations:
          type: array
          items:
            type: object
            required: [billId, billNumber, amountApplied]
            properties:
              billId:
                type: integer
              billNumber:
                type: string
              amountApplied:
                type: number

    CostResource:
      type: object
      required: [id, name, amount, period, createdAt]
      properties:
        id:
          type: integer
        name:
          type: string
        amount:
          type: number
        period:
          type: string
        notes:
          type: ["string", "null"]
        createdBy:
          type: ["string", "null"]
        createdAt:
          type: string

    CostResourceInput:
      type: object
      required: [name, amount, period]
      properties:
        name:
          type: string
        amount:
          type: number
        period:
          type: string
        notes:
          type: ["string", "null"]

    UploadResult:
      type: object
      required: [url]
      properties:
        url:
          type: string
```

- [ ] **Step 8: Commit**
```bash
git add lib/api-spec/openapi.yaml
git commit -m "feat(spec): add bills, payments, cost-resources, file-upload endpoints"
```

---

## Task 4: Run codegen

- [ ] **Step 1: Run**
```bash
cd "e:/Futurama Projects/adops-intelligence-platform/lib/api-spec"
pnpm run codegen
```
Expected: `🎉 api-client-react` and `🎉 zod`.

- [ ] **Step 2: Verify**
```bash
grep -n "useListBills\|useCreateBill\|useListPayments\|useListCostResources" lib/api-client-react/src/generated/api.ts | head -10
```

- [ ] **Step 3: Commit**
```bash
git add lib/api-zod/src/generated lib/api-client-react/src/generated
git commit -m "feat(codegen): regenerate for financials module"
```

---

## Task 5: Add PATCH to billing-records route (Transactions edit)

**Files:** Modify `artifacts/api-server/src/routes/billing-records.ts`

- [ ] **Step 1: Read the file, then add PATCH handler**

After the existing POST handler, add:
```typescript
router.patch("/platforms/:id/billing-records/:recordId", optionalAuth, async (req, res): Promise<void> => {
  const params = DeleteBillingRecordParams.safeParse({
    id: parseInt(req.params.id as string, 10),
    recordId: parseInt(req.params.recordId as string, 10),
  });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = CreateBillingRecordBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  try {
    const [row] = await db.update(billingRecordsTable).set({
      buyingHouseId: parsed.data.buyingHouseId,
      clientId: parsed.data.clientId ?? null,
      costModelId: parsed.data.costModelId,
      period: parsed.data.period,
      appsflyerPins: parsed.data.appsflyerPins,
      fraudPins: parsed.data.fraudPins,
      payoutRate: String(parsed.data.payoutRate),
      marginPct: String(parsed.data.marginPct),
      forexSellingRate: String(parsed.data.forexSellingRate),
      forexBuyingRate: String(parsed.data.forexBuyingRate),
      salesTaxPct: String(parsed.data.salesTaxPct),
      remittanceTaxPct: String(parsed.data.remittanceTaxPct),
      withholdingTaxPct: String(parsed.data.withholdingTaxPct),
      bulkDiscountPct: String(parsed.data.bulkDiscountPct),
      platformBulkDiscountPct: String(parsed.data.platformBulkDiscountPct),
    }).where(and(
      eq(billingRecordsTable.id, params.data.recordId),
      eq(billingRecordsTable.platformId, params.data.id),
    )).returning();
    if (!row) { res.status(404).json({ error: "Billing record not found" }); return; }
    res.json(ListBillingRecordsResponseItem.parse(await mapRecord(row)));
  } catch (err) {
    console.error("[billing-records PATCH]", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to update" });
  }
});
```

- [ ] **Step 2: Commit**
```bash
git add artifacts/api-server/src/routes/billing-records.ts
git commit -m "feat(api): add PATCH to billing-records for transaction editing"
```

---

## Task 6: Install new API server dependencies

**Files:** `artifacts/api-server/package.json`

- [ ] **Step 1: Install multer and Supabase client**
```bash
cd "e:/Futurama Projects/adops-intelligence-platform/artifacts/api-server"
pnpm add multer @supabase/supabase-js
pnpm add -D @types/multer
```

- [ ] **Step 2: Add env vars to `.env` or config**

The file-upload route needs two env vars. Check if there is an `.env` file in `artifacts/api-server/`. If so, add:
```
SUPABASE_URL=https://btvxavdscifcvincwzlo.supabase.co
SUPABASE_SERVICE_KEY=<service_role_key_from_supabase_dashboard>
```

**Note for the operator:** The `SUPABASE_SERVICE_KEY` (service role key) must be obtained from the Supabase dashboard → Project Settings → API → service_role. Create a storage bucket named `payment-attachments` (set to public). Without this the upload endpoint will return 500.

- [ ] **Step 3: Commit**
```bash
git add artifacts/api-server/package.json artifacts/api-server/pnpm-lock.yaml
git commit -m "feat(api): add multer + supabase-js for file upload support"
```

---

## Task 7: Create file-upload route

**Files:** Create `artifacts/api-server/src/routes/file-upload.ts`

- [ ] **Step 1: Create the file**
```typescript
import { Router, type IRouter } from "express";
import multer from "multer";
import { createClient } from "@supabase/supabase-js";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set");
  return createClient(url, key);
}

router.post("/uploads/payment-attachment", upload.single("file"), async (req, res): Promise<void> => {
  if (!req.file) { res.status(400).json({ error: "No file provided" }); return; }
  try {
    const supabase = getSupabase();
    const ext = req.file.originalname.split(".").pop() ?? "bin";
    const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase.storage
      .from("payment-attachments")
      .upload(path, req.file.buffer, { contentType: req.file.mimetype });
    if (error) throw error;
    const { data: { publicUrl } } = supabase.storage.from("payment-attachments").getPublicUrl(path);
    res.json({ url: publicUrl });
  } catch (err) {
    console.error("[file-upload]", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Upload failed" });
  }
});

export default router;
```

- [ ] **Step 2: Register in index.ts** — READ `artifacts/api-server/src/routes/index.ts`, add:
```typescript
import fileUploadRouter from "./file-upload";
// ...
router.use(fileUploadRouter);
```

- [ ] **Step 3: Commit**
```bash
git add artifacts/api-server/src/routes/file-upload.ts artifacts/api-server/src/routes/index.ts
git commit -m "feat(api): add POST /uploads/payment-attachment (Supabase Storage)"
```

---

## Task 8: Create bills route

**Files:** Create `artifacts/api-server/src/routes/bills.ts`

- [ ] **Step 1: Create the file**
```typescript
import { Router, type IRouter } from "express";
import { and, eq, sql } from "drizzle-orm";
import {
  db, billsTable, billTransactionsTable, billingRecordsTable,
  paymentBillsTable, clientsTable, buyingHousesTable, platformCostModelsTable, platformsTable,
} from "@workspace/db";
import { computeRow } from "../lib/computeRow";
import {
  ListBillsQueryParams, ListBillsResponse,
  CreateBillBody, CreateBillResponse,
  GetBillParams, GetBillResponse,
  UpdateBillBody, UpdateBillResponse,
  DeleteBillParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function generateBillNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(billsTable)
    .where(sql`extract(year from created_at) = ${year}`);
  const seq = (Number(count) + 1).toString().padStart(4, "0");
  return `INV-${year}-${seq}`;
}

async function calcBillTotals(billId: number) {
  const txRows = await db
    .select()
    .from(billTransactionsTable)
    .innerJoin(billingRecordsTable, eq(billTransactionsTable.billingRecordId, billingRecordsTable.id))
    .where(eq(billTransactionsTable.billId, billId));

  let totalReceivable = 0;
  for (const { billing_records: r } of txRows) {
    totalReceivable += computeRow(r).receivablePkr;
  }

  const paidRows = await db.select({ amt: paymentBillsTable.amountApplied })
    .from(paymentBillsTable).where(eq(paymentBillsTable.billId, billId));
  const totalPaid = paidRows.reduce((s, r) => s + Number(r.amt), 0);

  return { totalReceivable, totalPaid, totalPending: totalReceivable - totalPaid };
}

async function mapBillSummary(bill: typeof billsTable.$inferSelect) {
  const totals = await calcBillTotals(bill.id);
  const txCount = await db.select({ cnt: sql<number>`count(*)` })
    .from(billTransactionsTable).where(eq(billTransactionsTable.billId, bill.id));
  const client = bill.clientId
    ? (await db.select({ name: clientsTable.name }).from(clientsTable).where(eq(clientsTable.id, bill.clientId)))[0]
    : null;
  const bh = bill.buyingHouseId
    ? (await db.select({ name: buyingHousesTable.name }).from(buyingHousesTable).where(eq(buyingHousesTable.id, bill.buyingHouseId)))[0]
    : null;
  const status = totals.totalPaid <= 0 ? "outstanding"
    : totals.totalPending <= 0 ? "paid" : "partial";
  return {
    id: bill.id,
    billNumber: bill.billNumber,
    clientId: bill.clientId ?? null,
    clientName: client?.name ?? null,
    buyingHouseId: bill.buyingHouseId ?? null,
    buyingHouseName: bh?.name ?? null,
    status,
    totalReceivable: totals.totalReceivable,
    totalPaid: totals.totalPaid,
    totalPending: totals.totalPending,
    transactionCount: Number(txCount[0].cnt),
    notes: bill.notes ?? null,
    createdBy: bill.createdBy ?? null,
    createdAt: bill.createdAt.toISOString(),
  };
}

async function mapBillDetail(bill: typeof billsTable.$inferSelect) {
  const summary = await mapBillSummary(bill);
  const txRows = await db
    .select()
    .from(billTransactionsTable)
    .innerJoin(billingRecordsTable, eq(billTransactionsTable.billingRecordId, billingRecordsTable.id))
    .where(eq(billTransactionsTable.billId, bill.id));

  const transactions = await Promise.all(txRows.map(async ({ billing_records: r }) => {
    const bh = await db.select({ name: buyingHousesTable.name }).from(buyingHousesTable).where(eq(buyingHousesTable.id, r.buyingHouseId));
    const cm = await db.select().from(platformCostModelsTable).where(eq(platformCostModelsTable.id, r.costModelId));
    const cl = r.clientId ? (await db.select({ name: clientsTable.name }).from(clientsTable).where(eq(clientsTable.id, r.clientId)))[0] : null;
    return {
      id: r.id, platformId: r.platformId, buyingHouseId: r.buyingHouseId,
      buyingHouseName: bh[0]?.name ?? null, clientId: r.clientId ?? null,
      clientName: cl?.name ?? null, costModelId: r.costModelId,
      costModelName: cm[0]?.name ?? null,
      costModelPayoutRate: cm[0] ? Number(cm[0].payoutRate) : null,
      costModelMarginPct: cm[0] ? Number(cm[0].marginPct) : null,
      period: r.period, appsflyerPins: r.appsflyerPins, fraudPins: r.fraudPins,
      payoutRate: Number(r.payoutRate), marginPct: Number(r.marginPct),
      forexSellingRate: Number(r.forexSellingRate), forexBuyingRate: Number(r.forexBuyingRate),
      salesTaxPct: Number(r.salesTaxPct), remittanceTaxPct: Number(r.remittanceTaxPct),
      withholdingTaxPct: Number(r.withholdingTaxPct), bulkDiscountPct: Number(r.bulkDiscountPct),
      platformBulkDiscountPct: Number(r.platformBulkDiscountPct),
      createdBy: r.createdBy, createdAt: r.createdAt.toISOString(),
    };
  }));

  const pbRows = await db.select().from(paymentBillsTable).where(eq(paymentBillsTable.billId, bill.id));
  const payments = pbRows.map(pb => ({ paymentId: pb.paymentId, amountApplied: Number(pb.amountApplied) }));

  return { ...summary, transactions, payments };
}

router.get("/bills", async (req, res): Promise<void> => {
  const query = ListBillsQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }
  const conditions = [];
  if (query.data.clientId != null) conditions.push(eq(billsTable.clientId, query.data.clientId));
  if (query.data.buyingHouseId != null) conditions.push(eq(billsTable.buyingHouseId, query.data.buyingHouseId));
  const rows = await db.select().from(billsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(billsTable.createdAt);
  const mapped = await Promise.all(rows.map(mapBillSummary));
  res.json(ListBillsResponse.parse(mapped));
});

router.post("/bills", async (req, res): Promise<void> => {
  const parsed = CreateBillBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  try {
    const billNumber = await generateBillNumber();
    const [bill] = await db.insert(billsTable).values({
      billNumber,
      clientId: parsed.data.clientId ?? null,
      buyingHouseId: parsed.data.buyingHouseId ?? null,
      notes: parsed.data.notes ?? null,
      status: "outstanding",
    }).returning();
    if (parsed.data.billingRecordIds.length > 0) {
      await db.insert(billTransactionsTable).values(
        parsed.data.billingRecordIds.map(rid => ({ billId: bill.id, billingRecordId: rid }))
      );
    }
    res.status(201).json(CreateBillResponse.parse(await mapBillDetail(bill)));
  } catch (err) {
    console.error("[bills POST]", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to create bill" });
  }
});

router.get("/bills/:id", async (req, res): Promise<void> => {
  const params = GetBillParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [bill] = await db.select().from(billsTable).where(eq(billsTable.id, params.data.id));
  if (!bill) { res.status(404).json({ error: "Bill not found" }); return; }
  res.json(GetBillResponse.parse(await mapBillDetail(bill)));
});

router.patch("/bills/:id", async (req, res): Promise<void> => {
  const params = GetBillParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateBillBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  try {
    const [bill] = await db.update(billsTable).set({
      clientId: parsed.data.clientId ?? null,
      buyingHouseId: parsed.data.buyingHouseId ?? null,
      notes: parsed.data.notes ?? null,
    }).where(eq(billsTable.id, params.data.id)).returning();
    if (!bill) { res.status(404).json({ error: "Bill not found" }); return; }
    if (parsed.data.billingRecordIds) {
      await db.delete(billTransactionsTable).where(eq(billTransactionsTable.billId, bill.id));
      if (parsed.data.billingRecordIds.length > 0) {
        await db.insert(billTransactionsTable).values(
          parsed.data.billingRecordIds.map(rid => ({ billId: bill.id, billingRecordId: rid }))
        );
      }
    }
    res.json(UpdateBillResponse.parse(await mapBillDetail(bill)));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to update bill" });
  }
});

router.delete("/bills/:id", async (req, res): Promise<void> => {
  const params = DeleteBillParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [row] = await db.delete(billsTable).where(eq(billsTable.id, params.data.id)).returning();
  if (!row) { res.status(404).json({ error: "Bill not found" }); return; }
  res.sendStatus(204);
});

export default router;
```

- [ ] **Step 2: Register in index.ts** — add `import billsRouter from "./bills"` and `router.use(billsRouter)`.

- [ ] **Step 3: Commit**
```bash
git add artifacts/api-server/src/routes/bills.ts artifacts/api-server/src/routes/index.ts
git commit -m "feat(api): bills CRUD route with transaction linking and auto bill number"
```

---

## Task 9: Create payments route

**Files:** Create `artifacts/api-server/src/routes/payments.ts`

- [ ] **Step 1: Create the file**
```typescript
import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, paymentsTable, paymentBillsTable, billsTable } from "@workspace/db";
import {
  ListPaymentsResponse,
  CreatePaymentBody, CreatePaymentResponse,
  GetPaymentParams,
  UpdatePaymentBody, UpdatePaymentResponse,
  DeletePaymentParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function mapPayment(p: typeof paymentsTable.$inferSelect) {
  const pbRows = await db.select().from(paymentBillsTable)
    .innerJoin(billsTable, eq(paymentBillsTable.billId, billsTable.id))
    .where(eq(paymentBillsTable.paymentId, p.id));
  const allocations = pbRows.map(({ payment_bills: pb, bills: b }) => ({
    billId: pb.billId,
    billNumber: b.billNumber,
    amountApplied: Number(pb.amountApplied),
  }));
  return {
    id: p.id,
    mode: p.mode,
    totalAmount: Number(p.totalAmount),
    notes: p.notes ?? null,
    chequeImageUrl: p.chequeImageUrl ?? null,
    receiptUrl: p.receiptUrl ?? null,
    createdBy: p.createdBy ?? null,
    createdAt: p.createdAt.toISOString(),
    allocations,
  };
}

router.get("/payments", async (req, res): Promise<void> => {
  const rows = await db.select().from(paymentsTable).orderBy(paymentsTable.createdAt);
  const mapped = await Promise.all(rows.map(mapPayment));
  res.json(ListPaymentsResponse.parse(mapped));
});

router.post("/payments", async (req, res): Promise<void> => {
  const parsed = CreatePaymentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  try {
    const totalAmount = parsed.data.allocations.reduce((s, a) => s + a.amountApplied, 0);
    const [payment] = await db.insert(paymentsTable).values({
      mode: parsed.data.mode,
      totalAmount: String(totalAmount),
      notes: parsed.data.notes ?? null,
      chequeImageUrl: parsed.data.chequeImageUrl ?? null,
      receiptUrl: parsed.data.receiptUrl ?? null,
    }).returning();
    if (parsed.data.allocations.length > 0) {
      await db.insert(paymentBillsTable).values(
        parsed.data.allocations.map(a => ({
          paymentId: payment.id,
          billId: a.billId,
          amountApplied: String(a.amountApplied),
        }))
      );
    }
    res.status(201).json(CreatePaymentResponse.parse(await mapPayment(payment)));
  } catch (err) {
    console.error("[payments POST]", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to create payment" });
  }
});

router.patch("/payments/:id", async (req, res): Promise<void> => {
  const params = GetPaymentParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdatePaymentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  try {
    const totalAmount = parsed.data.allocations.reduce((s, a) => s + a.amountApplied, 0);
    const [payment] = await db.update(paymentsTable).set({
      mode: parsed.data.mode,
      totalAmount: String(totalAmount),
      notes: parsed.data.notes ?? null,
      chequeImageUrl: parsed.data.chequeImageUrl ?? null,
      receiptUrl: parsed.data.receiptUrl ?? null,
    }).where(eq(paymentsTable.id, params.data.id)).returning();
    if (!payment) { res.status(404).json({ error: "Payment not found" }); return; }
    await db.delete(paymentBillsTable).where(eq(paymentBillsTable.paymentId, payment.id));
    if (parsed.data.allocations.length > 0) {
      await db.insert(paymentBillsTable).values(
        parsed.data.allocations.map(a => ({
          paymentId: payment.id,
          billId: a.billId,
          amountApplied: String(a.amountApplied),
        }))
      );
    }
    res.json(UpdatePaymentResponse.parse(await mapPayment(payment)));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to update payment" });
  }
});

router.delete("/payments/:id", async (req, res): Promise<void> => {
  const params = DeletePaymentParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [row] = await db.delete(paymentsTable).where(eq(paymentsTable.id, params.data.id)).returning();
  if (!row) { res.status(404).json({ error: "Payment not found" }); return; }
  res.sendStatus(204);
});

export default router;
```

- [ ] **Step 2: Register in index.ts** — add `import paymentsRouter from "./payments"` and `router.use(paymentsRouter)`.

- [ ] **Step 3: Commit**
```bash
git add artifacts/api-server/src/routes/payments.ts artifacts/api-server/src/routes/index.ts
git commit -m "feat(api): payments CRUD route with bill allocation"
```

---

## Task 10: Create cost-resources route

**Files:** Create `artifacts/api-server/src/routes/cost-resources.ts`

- [ ] **Step 1: Create the file**
```typescript
import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, costResourcesTable } from "@workspace/db";
import {
  ListCostResourcesQueryParams, ListCostResourcesResponse,
  CreateCostResourceBody, CreateCostResourceResponse,
  GetCostResourceParams,
  UpdateCostResourceBody, UpdateCostResourceResponse,
  DeleteCostResourceParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

function mapCost(r: typeof costResourcesTable.$inferSelect) {
  return {
    id: r.id,
    name: r.name,
    amount: Number(r.amount),
    period: r.period,
    notes: r.notes ?? null,
    createdBy: r.createdBy ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

router.get("/cost-resources", async (req, res): Promise<void> => {
  const query = ListCostResourcesQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }
  const rows = await db.select().from(costResourcesTable).orderBy(costResourcesTable.period, costResourcesTable.name);
  const filtered = query.data.period
    ? rows.filter(r => r.period === query.data.period)
    : rows;
  res.json(ListCostResourcesResponse.parse(filtered.map(mapCost)));
});

router.post("/cost-resources", async (req, res): Promise<void> => {
  const parsed = CreateCostResourceBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [row] = await db.insert(costResourcesTable).values({
    name: parsed.data.name,
    amount: String(parsed.data.amount),
    period: parsed.data.period,
    notes: parsed.data.notes ?? null,
  }).returning();
  res.status(201).json(CreateCostResourceResponse.parse(mapCost(row)));
});

router.patch("/cost-resources/:id", async (req, res): Promise<void> => {
  const params = GetCostResourceParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateCostResourceBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [row] = await db.update(costResourcesTable).set({
    name: parsed.data.name,
    amount: String(parsed.data.amount),
    period: parsed.data.period,
    notes: parsed.data.notes ?? null,
  }).where(eq(costResourcesTable.id, params.data.id)).returning();
  if (!row) { res.status(404).json({ error: "Cost resource not found" }); return; }
  res.json(UpdateCostResourceResponse.parse(mapCost(row)));
});

router.delete("/cost-resources/:id", async (req, res): Promise<void> => {
  const params = DeleteCostResourceParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [row] = await db.delete(costResourcesTable).where(eq(costResourcesTable.id, params.data.id)).returning();
  if (!row) { res.status(404).json({ error: "Cost resource not found" }); return; }
  res.sendStatus(204);
});

export default router;
```

- [ ] **Step 2: Register in index.ts** — add `import costResourcesRouter from "./cost-resources"` and `router.use(costResourcesRouter)`.

- [ ] **Step 3: Commit**
```bash
git add artifacts/api-server/src/routes/cost-resources.ts artifacts/api-server/src/routes/index.ts
git commit -m "feat(api): cost-resources CRUD route"
```

---

## Task 11: Install frontend PDF library

**Files:** `artifacts/adops/package.json`

- [ ] **Step 1: Install jspdf**
```bash
cd "e:/Futurama Projects/adops-intelligence-platform/artifacts/adops"
pnpm add jspdf jspdf-autotable
```

- [ ] **Step 2: Commit**
```bash
git add artifacts/adops/package.json artifacts/adops/pnpm-lock.yaml
git commit -m "feat(ui): add jspdf + jspdf-autotable for invoice PDF generation"
```

---

## Task 12: Frontend — rename Billing → Transactions + add Edit/Delete

**Files:**
- Rename+Modify: `artifacts/adops/src/pages/Billing.tsx` → `Transactions.tsx`
- Modify: `artifacts/adops/src/lib/auth.ts`
- Modify: `artifacts/adops/src/App.tsx`

- [ ] **Step 1: Rename the file**
```bash
cd "e:/Futurama Projects/adops-intelligence-platform"
Move-Item "artifacts/adops/src/pages/Billing.tsx" "artifacts/adops/src/pages/Transactions.tsx"
```

- [ ] **Step 2: Update `auth.ts`** — READ first. Replace `"View Billing"` with `"View Transactions"` in `ALL_PERMISSIONS`.

- [ ] **Step 3: Update `App.tsx`** — READ first. Replace:
```tsx
import BillingPage from "@/pages/Billing";
// → 
import TransactionsPage from "@/pages/Transactions";
```
Replace the route:
```tsx
<Route path="/billing">
  <PermissionGuard permission="View Billing" component={BillingPage} />
</Route>
// →
<Route path="/transactions">
  <PermissionGuard permission="View Transactions" component={TransactionsPage} />
</Route>
```

- [ ] **Step 4: Add Edit + Delete actions to `Transactions.tsx`**

READ the file. The `useDeleteBillingRecord` mutation is already imported. Add `useUpdateBillingRecord` import. Add an Edit dialog (reuse `AddRecordDialog` but with `defaultValues` pre-filled) and wire Delete buttons.

In the table header row, add an `<TH>Actions</TH>` column at the end.

In each data row, add:
```tsx
<TD>
  <div className="flex gap-1">
    <Button variant="ghost" size="sm" className="h-6 px-2 text-xs"
      onClick={() => { setEditRecord(r); setEditOpen(true); }}>
      Edit
    </Button>
    <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-red-600"
      onClick={() => { if (confirm("Delete this record?")) deleteMutation.mutate({ id: r.platformId, recordId: r.id }); }}>
      Del
    </Button>
  </div>
</TD>
```

Add state: `const [editRecord, setEditRecord] = useState<typeof computed[0] | null>(null);` and `const [editOpen, setEditOpen] = useState(false);`

Add the edit dialog usage below the add dialog:
```tsx
{editRecord && (
  <AddRecordDialog
    open={editOpen}
    onClose={() => { setEditOpen(false); setEditRecord(null); }}
    platforms={platforms ?? []}
    buyingHouses={buyingHouses ?? []}
    clients={clients ?? []}
    defaultValues={editRecord}
    recordId={editRecord.id}
    onSuccess={() => qc.invalidateQueries({ queryKey: getListAllBillingRecordsQueryKey() })}
  />
)}
```

Update `AddRecordDialog` props interface and form initialization to accept optional `defaultValues` and `recordId`. When `recordId` is provided, call `useUpdateBillingRecord` instead of `useCreateBillingRecord`:
```tsx
// In AddRecordDialog:
const isEdit = recordId != null;
const createMutation = useCreateBillingRecord({ ... });
const updateMutation = useUpdateBillingRecord({ ... });

// In onSubmit:
if (isEdit) {
  updateMutation.mutate({ id: data.platformId, recordId, data: { ... } });
} else {
  createMutation.mutate({ id: data.platformId, data: { ... } });
}
```

Also rename the page title from "Billing" to "Transactions".

- [ ] **Step 5: Commit**
```bash
git add artifacts/adops/src/pages/Transactions.tsx artifacts/adops/src/lib/auth.ts artifacts/adops/src/App.tsx
git commit -m "feat(ui): rename Billing→Transactions, add Edit/Delete to transaction rows"
```

---

## Task 13: Frontend — Sidebar Financials group

**Files:** Modify `artifacts/adops/src/components/layout/Sidebar.tsx`

- [ ] **Step 1: READ the current sidebar, then replace with the new version**

Add `useState` for the Financials group expand state. Add group rendering logic:

```tsx
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, Users, Monitor, Building2,
  Upload, BarChart3, Settings, ChevronLeft, ChevronRight,
  Zap, LogOut, ChevronDown, ChevronUp,
  Receipt, FileText, CreditCard, DollarSign, Wallet,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { getCurrentUser, hasPermission, logout } from "@/lib/auth";

interface SidebarProps {
  open: boolean;
  onToggle: () => void;
}

const topNavItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, permission: "View Dashboard" },
  { href: "/clients", label: "Clients", icon: Users, permission: "View Clients" },
  { href: "/buying-houses", label: "Buying Houses", icon: Building2, permission: "View Buying Houses" },
  { href: "/platforms", label: "Platforms", icon: Monitor, permission: "View Platforms" },
];

const financialsItems = [
  { href: "/transactions", label: "Transactions", icon: Receipt, permission: "View Transactions" },
  { href: "/billings", label: "Billings", icon: FileText, permission: "View Billings" },
  { href: "/payments", label: "Payments", icon: CreditCard, permission: "View Payments" },
  { href: "/cost", label: "Cost", icon: DollarSign, permission: "View Cost" },
];

const bottomNavItems = [
  { href: "/upload", label: "Upload Data", icon: Upload, permission: "Upload Data" },
  { href: "/analytics", label: "Analytics", icon: BarChart3, permission: "View Analytics" },
  { href: "/settings", label: "Settings", icon: Settings, permission: "Manage Settings" },
];

export default function Sidebar({ open, onToggle }: SidebarProps) {
  const [location] = useLocation();
  const [financialsOpen, setFinancialsOpen] = useState(
    financialsItems.some(item => location.startsWith(item.href))
  );
  const user = getCurrentUser();
  const userInitials = user?.name
    ? user.name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)
    : "U";

  const renderItem = ({ href, label, icon: Icon, permission }: typeof topNavItems[0]) => {
    if (!hasPermission(permission)) return null;
    const isActive = href === "/" ? location === "/" : location.startsWith(href);
    return (
      <Link key={href} href={href}>
        <div
          data-testid={`nav-${label.toLowerCase().replace(/\s+/g, "-")}`}
          className={cn(
            "flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-150",
            isActive
              ? "bg-sidebar-primary/10 text-sidebar-primary"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          )}
        >
          <Icon className="h-4 w-4 shrink-0" />
          {open && <span className="truncate">{label}</span>}
        </div>
      </Link>
    );
  };

  const hasAnyFinancials = financialsItems.some(item => hasPermission(item.permission));
  const isFinancialsActive = financialsItems.some(item => location.startsWith(item.href));

  return (
    <aside className={cn(
      "fixed inset-y-0 left-0 z-50 flex flex-col border-r border-border bg-sidebar transition-all duration-300 ease-in-out overflow-hidden",
      "md:relative md:translate-x-0",
      open ? "w-56 translate-x-0" : "w-0 -translate-x-full border-r-0 md:w-16 md:translate-x-0 md:border-r"
    )}>
      {/* Logo */}
      <div className="flex h-16 items-center border-b border-border px-4">
        <div className="flex items-center gap-2.5 overflow-hidden">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary">
            <Zap className="h-4 w-4 text-primary-foreground" />
          </div>
          {open && (
            <div className="overflow-hidden">
              <p className="truncate text-sm font-bold text-sidebar-foreground">AdOps</p>
              <p className="truncate text-[10px] text-muted-foreground">Intelligence Platform</p>
            </div>
          )}
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {topNavItems.map(renderItem)}

        {/* Financials group */}
        {hasAnyFinancials && (
          <div>
            <button
              onClick={() => open && setFinancialsOpen(v => !v)}
              className={cn(
                "flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-150",
                isFinancialsActive
                  ? "bg-sidebar-primary/10 text-sidebar-primary"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}
            >
              <Wallet className="h-4 w-4 shrink-0" />
              {open && (
                <>
                  <span className="flex-1 truncate text-left">Financials</span>
                  {financialsOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </>
              )}
            </button>
            {open && financialsOpen && (
              <div className="ml-4 mt-0.5 space-y-0.5 border-l border-border pl-3">
                {financialsItems.map(renderItem)}
              </div>
            )}
          </div>
        )}

        {bottomNavItems.map(renderItem)}
      </nav>

      {/* Bottom section */}
      <div className="border-t border-border p-3 space-y-1.5">
        <div className={cn("flex items-center gap-3 rounded-lg px-2 py-2 overflow-hidden", !open && "justify-center")}>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-bold">
            {userInitials}
          </div>
          {open && (
            <div className="overflow-hidden flex-1 min-w-0">
              <p className="truncate text-xs font-semibold text-sidebar-foreground">{user?.name || "Guest"}</p>
              <p className="truncate text-[10px] text-muted-foreground">{user?.email || ""}</p>
            </div>
          )}
        </div>
        <button
          onClick={logout}
          data-testid="logout-btn"
          className={cn(
            "flex w-full cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors",
            !open && "justify-center"
          )}
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {open && <span className="truncate">Log Out</span>}
        </button>
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Update `auth.ts`** — add new permissions to `ALL_PERMISSIONS`:
```typescript
"View Transactions",   // replaces "View Billing"
"View Billings",
"View Payments",
"View Cost",
```
Remove `"View Billing"` (already renamed).

- [ ] **Step 3: Update `seed.ts`** — READ `artifacts/api-server/src/lib/seed.ts`. Replace `"View Billing"` with `"View Transactions"`. Add `"View Billings"`, `"View Payments"`, `"View Cost"` to the admin and relevant roles.

- [ ] **Step 4: Update `App.tsx`** — add routes for the three new pages (stubs for now):
```tsx
import BillingsPage from "@/pages/Billings";
import PaymentsPage from "@/pages/Payments";
import CostPage from "@/pages/Cost";

// In Router():
<Route path="/billings">
  <PermissionGuard permission="View Billings" component={BillingsPage} />
</Route>
<Route path="/payments">
  <PermissionGuard permission="View Payments" component={PaymentsPage} />
</Route>
<Route path="/cost">
  <PermissionGuard permission="View Cost" component={CostPage} />
</Route>
```
Also update `/billing` route to `/transactions` if not already done in Task 12.

- [ ] **Step 5: Commit**
```bash
git add artifacts/adops/src/components/layout/Sidebar.tsx artifacts/adops/src/lib/auth.ts artifacts/adops/src/App.tsx artifacts/api-server/src/lib/seed.ts
git commit -m "feat(ui): Financials sidebar group with Transactions/Billings/Payments/Cost submenu"
```

---

## Task 14: Frontend — Billings (invoices) page

**Files:** Create `artifacts/adops/src/pages/Billings.tsx`

- [ ] **Step 1: Install jspdf types** (already done in Task 11, but verify)

- [ ] **Step 2: Create `artifacts/adops/src/pages/Billings.tsx`**

```tsx
import { useState } from "react";
import { Plus, FileText, Trash2, Pencil, Download } from "lucide-react";
import {
  useListBills, useCreateBill, useUpdateBill, useDeleteBill,
  useListAllBillingRecords, useListClients, useListBuyingHouses,
  getListBillsQueryKey,
} from "@workspace/api-client-react";
import type { BillDetail, BillSummary } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { computeRow } from "@/lib/computeRow";
import { cn } from "@/lib/utils";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

function fmtNum(n: number | null | undefined, d = 2) {
  if (n == null || isNaN(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

function statusBadge(status: string) {
  const variants: Record<string, string> = {
    outstanding: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    partial: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    paid: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  };
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", variants[status] ?? "bg-muted text-muted-foreground")}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function generateInvoicePdf(bill: BillDetail) {
  const doc = new jsPDF();
  doc.setFontSize(20);
  doc.text("INVOICE", 14, 22);
  doc.setFontSize(11);
  doc.text(`Bill #: ${bill.billNumber}`, 14, 32);
  doc.text(`Date: ${new Date(bill.createdAt).toLocaleDateString()}`, 14, 39);
  if (bill.clientName) doc.text(`Client: ${bill.clientName}`, 14, 46);
  if (bill.buyingHouseName) doc.text(`Via: ${bill.buyingHouseName}`, 14, 53);

  const rows = bill.transactions.map(t => {
    const c = computeRow({
      appsflyerPins: t.appsflyerPins, fraudPins: t.fraudPins,
      payoutRate: t.payoutRate, marginPct: t.marginPct,
      forexSellingRate: t.forexSellingRate, forexBuyingRate: t.forexBuyingRate,
      salesTaxPct: t.salesTaxPct, remittanceTaxPct: t.remittanceTaxPct,
      withholdingTaxPct: t.withholdingTaxPct, bulkDiscountPct: t.bulkDiscountPct,
      platformBulkDiscountPct: t.platformBulkDiscountPct,
    });
    return [
      t.period,
      t.appsflyerPins - t.fraudPins,
      t.payoutRate.toFixed(4),
      c.grossAmtPkr.toFixed(2),
      c.salesTax.toFixed(2),
      c.wht.toFixed(2),
      c.receivablePkr.toFixed(2),
    ];
  });

  autoTable(doc, {
    startY: 62,
    head: [["Period", "Actual Pins", "Rate", "Gross (PKR)", "Sales Tax", "WHT", "Receivable (PKR)"]],
    body: rows,
  });

  const finalY = (doc as any).lastAutoTable.finalY + 10;
  doc.setFontSize(11);
  doc.text(`Total Receivable: PKR ${fmtNum(bill.totalReceivable)}`, 14, finalY);
  doc.text(`Total Paid:       PKR ${fmtNum(bill.totalPaid)}`, 14, finalY + 7);
  doc.text(`Pending:          PKR ${fmtNum(bill.totalPending)}`, 14, finalY + 14);

  doc.save(`${bill.billNumber}.pdf`);
}

const billSchema = z.object({
  clientId: z.number().nullable().optional(),
  buyingHouseId: z.number().nullable().optional(),
  billingRecordIds: z.array(z.number()).min(1, "Select at least one transaction"),
  notes: z.string().optional(),
});
type BillForm = z.infer<typeof billSchema>;

export default function BillingsPage() {
  const [addOpen, setAddOpen] = useState(false);
  const [editBill, setEditBill] = useState<BillSummary | null>(null);
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: bills, isLoading } = useListBills({});
  const deleteMutation = useDeleteBill({
    mutation: {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getListBillsQueryKey() }); toast({ title: "Bill deleted" }); },
      onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Billings</h1>
          <p className="text-sm text-muted-foreground">{bills?.length ?? 0} bills</p>
        </div>
        <Button size="sm" className="gap-1.5 text-xs" onClick={() => setAddOpen(true)}>
          <Plus className="h-3.5 w-3.5" /> Create Bill
        </Button>
      </div>

      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-x-auto">
        <table className="w-full min-w-max">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {["Bill #", "Client", "Via (BH)", "Transactions", "Receivable (PKR)", "Paid (PKR)", "Pending (PKR)", "Progress", "Status", "Actions"].map(h => (
                <th key={h} className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(3)].map((_, i) => (
                <tr key={i} className="border-b border-border">
                  {[...Array(10)].map((_, j) => <td key={j} className="px-3 py-2"><Skeleton className="h-3 w-16" /></td>)}
                </tr>
              ))
            ) : !bills?.length ? (
              <tr><td colSpan={10} className="px-5 py-10 text-center text-sm text-muted-foreground">No bills yet</td></tr>
            ) : bills.map(bill => {
              const pct = bill.totalReceivable > 0 ? Math.min(100, (bill.totalPaid / bill.totalReceivable) * 100) : 0;
              return (
                <tr key={bill.id} className="border-b border-border last:border-0 hover:bg-muted/20">
                  <td className="px-3 py-2 text-xs font-semibold">{bill.billNumber}</td>
                  <td className="px-3 py-2 text-xs">{bill.clientName ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">{bill.buyingHouseName ?? "—"}</td>
                  <td className="px-3 py-2 text-xs text-center">{bill.transactionCount}</td>
                  <td className="px-3 py-2 text-xs font-semibold">{fmtNum(bill.totalReceivable)}</td>
                  <td className="px-3 py-2 text-xs text-emerald-600">{fmtNum(bill.totalPaid)}</td>
                  <td className="px-3 py-2 text-xs text-red-600">{fmtNum(bill.totalPending)}</td>
                  <td className="px-3 py-2 min-w-[100px]">
                    <div className="flex items-center gap-2">
                      <Progress value={pct} className="h-1.5 flex-1" />
                      <span className="text-[10px] text-muted-foreground w-8 text-right">{pct.toFixed(0)}%</span>
                    </div>
                  </td>
                  <td className="px-3 py-2">{statusBadge(bill.status)}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      <InvoicePdfButton billId={bill.id} />
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setEditBill(bill)}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-red-600"
                        onClick={() => { if (confirm("Delete this bill?")) deleteMutation.mutate({ id: bill.id }); }}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <BillDialog
        open={addOpen || editBill != null}
        editBill={editBill ?? undefined}
        onClose={() => { setAddOpen(false); setEditBill(null); }}
        onSuccess={() => qc.invalidateQueries({ queryKey: getListBillsQueryKey() })}
      />
    </div>
  );
}

function InvoicePdfButton({ billId }: { billId: number }) {
  const { data: bill } = (useListBills as any)();
  // Fetch detail on demand
  const [loading, setLoading] = useState(false);
  const handleDownload = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/bills/${billId}`);
      const detail: BillDetail = await res.json();
      generateInvoicePdf(detail);
    } finally {
      setLoading(false);
    }
  };
  return (
    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={handleDownload} disabled={loading}>
      <FileText className="h-3 w-3" />
    </Button>
  );
}

function BillDialog({ open, editBill, onClose, onSuccess }: {
  open: boolean;
  editBill?: BillSummary;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const { data: transactions } = useListAllBillingRecords({});
  const { data: clients } = useListClients();
  const { data: buyingHouses } = useListBuyingHouses();

  const form = useForm<BillForm>({
    resolver: zodResolver(billSchema),
    defaultValues: {
      clientId: editBill?.clientId ?? null,
      buyingHouseId: editBill?.buyingHouseId ?? null,
      billingRecordIds: [],
      notes: editBill?.notes ?? "",
    },
  });

  const createMutation = useCreateBill({
    mutation: {
      onSuccess: () => { onSuccess(); onClose(); form.reset(); toast({ title: "Bill created" }); },
      onError: () => toast({ title: "Failed to create bill", variant: "destructive" }),
    },
  });
  const updateMutation = useUpdateBill({
    mutation: {
      onSuccess: () => { onSuccess(); onClose(); form.reset(); toast({ title: "Bill updated" }); },
      onError: () => toast({ title: "Failed to update bill", variant: "destructive" }),
    },
  });

  const isEdit = editBill != null;
  const pending = createMutation.isPending || updateMutation.isPending;

  const onSubmit = (data: BillForm) => {
    const body = {
      clientId: data.clientId ?? null,
      buyingHouseId: data.buyingHouseId ?? null,
      billingRecordIds: data.billingRecordIds,
      notes: data.notes ?? null,
    };
    if (isEdit) {
      updateMutation.mutate({ id: editBill.id, data: body });
    } else {
      createMutation.mutate({ data: body });
    }
  };

  const selectedIds = form.watch("billingRecordIds");
  const toggleTx = (id: number) => {
    const current = form.getValues("billingRecordIds");
    form.setValue("billingRecordIds", current.includes(id) ? current.filter(i => i !== id) : [...current, id]);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit Bill ${editBill?.billNumber}` : "Create Bill"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="clientId" render={({ field }) => (
                <FormItem><FormLabel>Client</FormLabel>
                  <Select onValueChange={v => field.onChange(v === "none" ? null : parseInt(v))} value={field.value != null ? String(field.value) : "none"}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {clients?.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select><FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="buyingHouseId" render={({ field }) => (
                <FormItem><FormLabel>Buying House</FormLabel>
                  <Select onValueChange={v => field.onChange(v === "none" ? null : parseInt(v))} value={field.value != null ? String(field.value) : "none"}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select BH" /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {buyingHouses?.map(bh => <SelectItem key={bh.id} value={String(bh.id)}>{bh.name}</SelectItem>)}
                    </SelectContent>
                  </Select><FormMessage />
                </FormItem>
              )} />
            </div>

            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem><FormLabel>Notes</FormLabel>
                <FormControl><Textarea rows={2} placeholder="Optional notes..." {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <div>
              <p className="text-sm font-medium mb-2">Select Transactions ({selectedIds.length} selected)</p>
              <div className="border border-border rounded-lg max-h-64 overflow-y-auto divide-y divide-border">
                {(transactions ?? []).map(t => {
                  const c = computeRow({
                    appsflyerPins: t.appsflyerPins, fraudPins: t.fraudPins,
                    payoutRate: t.payoutRate ?? 0, marginPct: t.marginPct ?? 0,
                    forexSellingRate: t.forexSellingRate ?? 0, forexBuyingRate: t.forexBuyingRate ?? 0,
                    salesTaxPct: t.salesTaxPct ?? 0, remittanceTaxPct: t.remittanceTaxPct ?? 0,
                    withholdingTaxPct: t.withholdingTaxPct ?? 0, bulkDiscountPct: t.bulkDiscountPct ?? 0,
                    platformBulkDiscountPct: t.platformBulkDiscountPct ?? 0,
                  });
                  const selected = selectedIds.includes(t.id);
                  return (
                    <div
                      key={t.id}
                      onClick={() => toggleTx(t.id)}
                      className={cn("flex items-center justify-between px-3 py-2 cursor-pointer text-xs hover:bg-muted/40", selected && "bg-primary/5")}
                    >
                      <div className="flex items-center gap-2">
                        <input type="checkbox" readOnly checked={selected} className="pointer-events-none" />
                        <span className="font-medium">{t.period}</span>
                        <span className="text-muted-foreground">{t.platformName ?? t.platformId}</span>
                        <span className="text-muted-foreground">{t.clientName ?? "—"}</span>
                      </div>
                      <span className="font-semibold">PKR {fmtNum(c.receivablePkr)}</span>
                    </div>
                  );
                })}
              </div>
              {form.formState.errors.billingRecordIds && (
                <p className="text-xs text-red-600 mt-1">{form.formState.errors.billingRecordIds.message}</p>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={pending}>{pending ? "Saving..." : isEdit ? "Update" : "Create Bill"}</Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Commit**
```bash
git add artifacts/adops/src/pages/Billings.tsx
git commit -m "feat(ui): Billings page — create/edit/delete bills with transaction selection + PDF invoice"
```

---

## Task 15: Frontend — Payments page

**Files:** Create `artifacts/adops/src/pages/Payments.tsx`

- [ ] **Step 1: Create `artifacts/adops/src/pages/Payments.tsx`**

```tsx
import { useState, useRef } from "react";
import { Plus, Trash2, Pencil, Upload } from "lucide-react";
import {
  useListPayments, useCreatePayment, useUpdatePayment, useDeletePayment,
  useListBills,
  getListPaymentsQueryKey,
} from "@workspace/api-client-react";
import type { PaymentDetail } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

function fmtNum(n: number | null | undefined, d = 2) {
  if (n == null || isNaN(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

const allocationSchema = z.object({
  billId: z.number(),
  amountApplied: z.number().min(0),
});

const paymentSchema = z.object({
  mode: z.enum(["cash", "cheque", "online"], { required_error: "Mode is required" }),
  notes: z.string().optional(),
  chequeImageUrl: z.string().optional(),
  receiptUrl: z.string().optional(),
  allocations: z.array(allocationSchema).min(1, "Select at least one bill"),
});
type PaymentForm = z.infer<typeof paymentSchema>;

async function uploadFile(file: File): Promise<string> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/uploads/payment-attachment", { method: "POST", body: fd });
  if (!res.ok) throw new Error("Upload failed");
  const { url } = await res.json();
  return url as string;
}

export default function PaymentsPage() {
  const [addOpen, setAddOpen] = useState(false);
  const [editPayment, setEditPayment] = useState<PaymentDetail | null>(null);
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: payments, isLoading } = useListPayments();
  const deleteMutation = useDeletePayment({
    mutation: {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getListPaymentsQueryKey() }); toast({ title: "Payment deleted" }); },
      onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Payments</h1>
          <p className="text-sm text-muted-foreground">{payments?.length ?? 0} payments</p>
        </div>
        <Button size="sm" className="gap-1.5 text-xs" onClick={() => setAddOpen(true)}>
          <Plus className="h-3.5 w-3.5" /> Record Payment
        </Button>
      </div>

      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-x-auto">
        <table className="w-full min-w-max">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {["#", "Mode", "Total (PKR)", "Bills", "Notes", "Date", "Attachments", "Actions"].map(h => (
                <th key={h} className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(3)].map((_, i) => (
                <tr key={i} className="border-b border-border">
                  {[...Array(8)].map((_, j) => <td key={j} className="px-3 py-2"><Skeleton className="h-3 w-16" /></td>)}
                </tr>
              ))
            ) : !payments?.length ? (
              <tr><td colSpan={8} className="px-5 py-10 text-center text-sm text-muted-foreground">No payments yet</td></tr>
            ) : payments.map((p, i) => (
              <tr key={p.id} className="border-b border-border last:border-0 hover:bg-muted/20">
                <td className="px-3 py-2 text-xs text-muted-foreground">{i + 1}</td>
                <td className="px-3 py-2 text-xs font-semibold capitalize">{p.mode}</td>
                <td className="px-3 py-2 text-xs font-semibold">{fmtNum(p.totalAmount)}</td>
                <td className="px-3 py-2 text-xs">
                  {p.allocations.map(a => (
                    <div key={a.billId} className="text-[10px]">
                      {a.billNumber}: PKR {fmtNum(a.amountApplied)}
                    </div>
                  ))}
                </td>
                <td className="px-3 py-2 text-xs max-w-[160px] truncate">{p.notes ?? "—"}</td>
                <td className="px-3 py-2 text-xs">{new Date(p.createdAt).toLocaleDateString()}</td>
                <td className="px-3 py-2 text-xs">
                  {p.chequeImageUrl && <a href={p.chequeImageUrl} target="_blank" rel="noreferrer" className="text-primary underline mr-2 text-[10px]">Cheque</a>}
                  {p.receiptUrl && <a href={p.receiptUrl} target="_blank" rel="noreferrer" className="text-primary underline text-[10px]">Receipt</a>}
                  {!p.chequeImageUrl && !p.receiptUrl && "—"}
                </td>
                <td className="px-3 py-2">
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setEditPayment(p)}>
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-red-600"
                      onClick={() => { if (confirm("Delete this payment?")) deleteMutation.mutate({ id: p.id }); }}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <PaymentDialog
        open={addOpen || editPayment != null}
        editPayment={editPayment ?? undefined}
        onClose={() => { setAddOpen(false); setEditPayment(null); }}
        onSuccess={() => qc.invalidateQueries({ queryKey: getListPaymentsQueryKey() })}
      />
    </div>
  );
}

function PaymentDialog({ open, editPayment, onClose, onSuccess }: {
  open: boolean;
  editPayment?: PaymentDetail;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const { data: bills } = useListBills({});
  const chequeRef = useRef<HTMLInputElement>(null);
  const receiptRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const isEdit = editPayment != null;
  const form = useForm<PaymentForm>({
    resolver: zodResolver(paymentSchema),
    defaultValues: {
      mode: (editPayment?.mode as any) ?? "cash",
      notes: editPayment?.notes ?? "",
      chequeImageUrl: editPayment?.chequeImageUrl ?? "",
      receiptUrl: editPayment?.receiptUrl ?? "",
      allocations: editPayment?.allocations.map(a => ({ billId: a.billId, amountApplied: a.amountApplied })) ?? [],
    },
  });

  const mode = form.watch("mode");
  const allocations = form.watch("allocations");

  const toggleBill = (billId: number, totalPending: number) => {
    const current = form.getValues("allocations");
    const exists = current.find(a => a.billId === billId);
    if (exists) {
      form.setValue("allocations", current.filter(a => a.billId !== billId));
    } else {
      form.setValue("allocations", [...current, { billId, amountApplied: totalPending }]);
    }
  };

  const updateAllocation = (billId: number, amount: number) => {
    const current = form.getValues("allocations");
    form.setValue("allocations", current.map(a => a.billId === billId ? { ...a, amountApplied: amount } : a));
  };

  const handleFileUpload = async (type: "cheque" | "receipt", file: File) => {
    setUploading(true);
    try {
      const url = await uploadFile(file);
      if (type === "cheque") form.setValue("chequeImageUrl", url);
      else form.setValue("receiptUrl", url);
      toast({ title: "File uploaded" });
    } catch {
      toast({ title: "Upload failed", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const createMutation = useCreatePayment({
    mutation: {
      onSuccess: () => { onSuccess(); onClose(); form.reset(); toast({ title: "Payment recorded" }); },
      onError: () => toast({ title: "Failed to record payment", variant: "destructive" }),
    },
  });
  const updateMutation = useUpdatePayment({
    mutation: {
      onSuccess: () => { onSuccess(); onClose(); form.reset(); toast({ title: "Payment updated" }); },
      onError: () => toast({ title: "Failed to update payment", variant: "destructive" }),
    },
  });

  const onSubmit = (data: PaymentForm) => {
    const body = {
      mode: data.mode,
      notes: data.notes ?? null,
      chequeImageUrl: data.chequeImageUrl || null,
      receiptUrl: data.receiptUrl || null,
      allocations: data.allocations,
    };
    if (isEdit) {
      updateMutation.mutate({ id: editPayment.id, data: body });
    } else {
      createMutation.mutate({ data: body });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Payment" : "Record Payment"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="mode" render={({ field }) => (
              <FormItem><FormLabel>Payment Mode</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="cheque">Cheque</SelectItem>
                    <SelectItem value="online">Online Transfer</SelectItem>
                  </SelectContent>
                </Select><FormMessage />
              </FormItem>
            )} />

            {mode === "cheque" && (
              <FormItem>
                <FormLabel>Cheque Image</FormLabel>
                <div className="flex gap-2 items-center">
                  <Input type="file" accept="image/*,.pdf" ref={chequeRef}
                    onChange={e => e.target.files?.[0] && handleFileUpload("cheque", e.target.files[0])}
                    className="text-xs" disabled={uploading} />
                  {form.watch("chequeImageUrl") && (
                    <a href={form.watch("chequeImageUrl")} target="_blank" rel="noreferrer" className="text-xs text-primary underline whitespace-nowrap">View</a>
                  )}
                </div>
              </FormItem>
            )}

            {mode === "online" && (
              <FormItem>
                <FormLabel>Payment Receipt</FormLabel>
                <div className="flex gap-2 items-center">
                  <Input type="file" accept="image/*,.pdf" ref={receiptRef}
                    onChange={e => e.target.files?.[0] && handleFileUpload("receipt", e.target.files[0])}
                    className="text-xs" disabled={uploading} />
                  {form.watch("receiptUrl") && (
                    <a href={form.watch("receiptUrl")} target="_blank" rel="noreferrer" className="text-xs text-primary underline whitespace-nowrap">View</a>
                  )}
                </div>
              </FormItem>
            )}

            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem><FormLabel>Notes</FormLabel>
                <FormControl><Textarea rows={2} placeholder="Optional notes..." {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <div>
              <p className="text-sm font-medium mb-2">Bills to settle</p>
              <div className="border border-border rounded-lg divide-y divide-border max-h-56 overflow-y-auto">
                {(bills ?? []).filter(b => b.status !== "paid").map(bill => {
                  const alloc = allocations.find(a => a.billId === bill.id);
                  return (
                    <div key={bill.id} className="px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <input type="checkbox" checked={!!alloc}
                            onChange={() => toggleBill(bill.id, bill.totalPending)}
                            className="cursor-pointer" />
                          <span className="text-xs font-semibold">{bill.billNumber}</span>
                          <span className="text-[10px] text-muted-foreground">Pending: PKR {fmtNum(bill.totalPending)}</span>
                        </div>
                        {alloc && (
                          <Input
                            type="number"
                            step="0.01"
                            className="w-32 h-6 text-xs"
                            value={alloc.amountApplied}
                            onChange={e => updateAllocation(bill.id, parseFloat(e.target.value) || 0)}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {form.formState.errors.allocations && (
                <p className="text-xs text-red-600 mt-1">{(form.formState.errors.allocations as any).message}</p>
              )}
              {allocations.length > 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  Total: PKR {fmtNum(allocations.reduce((s, a) => s + a.amountApplied, 0))}
                </p>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={isPending || uploading}>
                {isPending ? "Saving..." : isEdit ? "Update" : "Record Payment"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Commit**
```bash
git add artifacts/adops/src/pages/Payments.tsx
git commit -m "feat(ui): Payments page — record payments with bill allocation, file upload, mode selection"
```

---

## Task 16: Frontend — Cost page

**Files:** Create `artifacts/adops/src/pages/Cost.tsx`

- [ ] **Step 1: Create `artifacts/adops/src/pages/Cost.tsx`**

```tsx
import { useState } from "react";
import { Plus, Trash2, Pencil } from "lucide-react";
import {
  useListCostResources, useCreateCostResource, useUpdateCostResource, useDeleteCostResource,
  getListCostResourcesQueryKey,
} from "@workspace/api-client-react";
import type { CostResource } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

function fmtNum(n: number | null | undefined, d = 2) {
  if (n == null || isNaN(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

const costSchema = z.object({
  name: z.string().min(1, "Name is required"),
  amount: z.number().min(0),
  period: z.string().min(1, "Period is required"),
  notes: z.string().optional(),
});
type CostForm = z.infer<typeof costSchema>;

export default function CostPage() {
  const [addOpen, setAddOpen] = useState(false);
  const [editItem, setEditItem] = useState<CostResource | null>(null);
  const [periodFilter, setPeriodFilter] = useState("");
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: resources, isLoading } = useListCostResources(periodFilter ? { period: periodFilter } : {});
  const deleteMutation = useDeleteCostResource({
    mutation: {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getListCostResourcesQueryKey() }); toast({ title: "Cost resource deleted" }); },
      onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
    },
  });

  const totalForPeriod = (resources ?? []).reduce((s, r) => s + r.amount, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Cost</h1>
          <p className="text-sm text-muted-foreground">{resources?.length ?? 0} resources{periodFilter ? ` · Total: PKR ${fmtNum(totalForPeriod)}` : ""}</p>
        </div>
        <div className="flex gap-2 items-center">
          <Input type="month" className="w-36 text-sm" value={periodFilter} onChange={e => setPeriodFilter(e.target.value)} />
          <Button size="sm" className="gap-1.5 text-xs" onClick={() => setAddOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Add Cost
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-x-auto">
        <table className="w-full min-w-max">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {["#", "Resource Name", "Period", "Amount (PKR)", "Notes", "Added By", "Date", "Actions"].map(h => (
                <th key={h} className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(3)].map((_, i) => (
                <tr key={i} className="border-b border-border">
                  {[...Array(8)].map((_, j) => <td key={j} className="px-3 py-2"><Skeleton className="h-3 w-16" /></td>)}
                </tr>
              ))
            ) : !(resources ?? []).length ? (
              <tr><td colSpan={8} className="px-5 py-10 text-center text-sm text-muted-foreground">No cost resources</td></tr>
            ) : (resources ?? []).map((r, i) => (
              <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/20">
                <td className="px-3 py-2 text-xs text-muted-foreground">{i + 1}</td>
                <td className="px-3 py-2 text-xs font-semibold">{r.name}</td>
                <td className="px-3 py-2 text-xs">{r.period}</td>
                <td className="px-3 py-2 text-xs font-semibold">{fmtNum(r.amount)}</td>
                <td className="px-3 py-2 text-xs max-w-[200px] truncate">{r.notes ?? "—"}</td>
                <td className="px-3 py-2 text-xs">{r.createdBy ?? "—"}</td>
                <td className="px-3 py-2 text-xs">{new Date(r.createdAt).toLocaleDateString()}</td>
                <td className="px-3 py-2">
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setEditItem(r)}>
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-red-600"
                      onClick={() => { if (confirm("Delete this cost resource?")) deleteMutation.mutate({ id: r.id }); }}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {(resources ?? []).length > 0 && (
              <tr className="border-t-2 border-border bg-muted/30">
                <td className="px-3 py-2 text-xs font-semibold" colSpan={3}>Total</td>
                <td className="px-3 py-2 text-xs font-semibold">{fmtNum(totalForPeriod)}</td>
                <td colSpan={4} />
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <CostDialog
        open={addOpen || editItem != null}
        editItem={editItem ?? undefined}
        onClose={() => { setAddOpen(false); setEditItem(null); }}
        onSuccess={() => qc.invalidateQueries({ queryKey: getListCostResourcesQueryKey() })}
      />
    </div>
  );
}

function CostDialog({ open, editItem, onClose, onSuccess }: {
  open: boolean; editItem?: CostResource; onClose: () => void; onSuccess: () => void;
}) {
  const { toast } = useToast();
  const isEdit = editItem != null;
  const form = useForm<CostForm>({
    resolver: zodResolver(costSchema),
    defaultValues: {
      name: editItem?.name ?? "",
      amount: editItem?.amount ?? 0,
      period: editItem?.period ?? new Date().toISOString().slice(0, 7),
      notes: editItem?.notes ?? "",
    },
  });

  const createMutation = useCreateCostResource({
    mutation: {
      onSuccess: () => { onSuccess(); onClose(); form.reset(); toast({ title: "Cost resource added" }); },
      onError: () => toast({ title: "Failed", variant: "destructive" }),
    },
  });
  const updateMutation = useUpdateCostResource({
    mutation: {
      onSuccess: () => { onSuccess(); onClose(); form.reset(); toast({ title: "Updated" }); },
      onError: () => toast({ title: "Failed", variant: "destructive" }),
    },
  });

  const onSubmit = (data: CostForm) => {
    const body = { name: data.name, amount: data.amount, period: data.period, notes: data.notes ?? null };
    if (isEdit) updateMutation.mutate({ id: editItem.id, data: body });
    else createMutation.mutate({ data: body });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Cost Resource" : "Add Cost Resource"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem><FormLabel>Resource Name</FormLabel>
                <FormControl><Input placeholder="e.g. Office Rent, Salaries" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="amount" render={({ field }) => (
                <FormItem><FormLabel>Amount (PKR)</FormLabel>
                  <FormControl>
                    <Input type="number" step="0.01" min={0} {...field}
                      value={field.value ?? ""} onChange={e => field.onChange(parseFloat(e.target.value) || 0)} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="period" render={({ field }) => (
                <FormItem><FormLabel>Period</FormLabel>
                  <FormControl><Input type="month" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem><FormLabel>Notes</FormLabel>
                <FormControl><Textarea rows={2} placeholder="Optional notes..." {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                {createMutation.isPending || updateMutation.isPending ? "Saving..." : isEdit ? "Update" : "Add"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Commit**
```bash
git add artifacts/adops/src/pages/Cost.tsx
git commit -m "feat(ui): Cost page — monthly cost resources with CRUD"
```

---

## Task 17: Final typecheck + build

- [ ] **Step 1: Run typecheck**
```bash
cd "e:/Futurama Projects/adops-intelligence-platform"
pnpm run typecheck 2>&1 | tail -30
```
Expected: all packages `Done`, zero errors.

Fix any errors found (common: missing `useUpdateBillingRecord` import, nullable number coercions, `jspdf-autotable` types).

- [ ] **Step 2: Build api-server**
```bash
cd artifacts/api-server && pnpm run build 2>&1 | tail -5
```

- [ ] **Step 3: Commit any fixes**
```bash
git add -A
git commit -m "fix(typecheck): resolve type errors from financials module"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] Transactions CRUD (Edit + Delete) — Tasks 5, 12
- [x] Rename Billing → Transactions, `/transactions` route — Task 12, 13
- [x] Financials sidebar group, collapsible, 4 sub-items — Task 13
- [x] Billings (invoices): create from transactions, CRUD, PDF invoice download — Tasks 8, 14
- [x] Payments: record against bills, per-bill allocation, mode, file upload — Tasks 6, 7, 9, 15
- [x] Cheque image upload (Supabase Storage) — Tasks 6, 7
- [x] Online receipt upload (Supabase Storage) — Tasks 6, 7
- [x] Payment progress/settlement tracking on bills — Tasks 8, 14
- [x] Cost resources: monthly recurring, CRUD — Tasks 10, 16
- [x] DB migration for all new tables — Task 1
- [x] Drizzle schemas — Task 2
- [x] OpenAPI spec — Task 3
- [x] Codegen — Task 4

**Known gotchas:**
1. `SUPABASE_SERVICE_KEY` env var required for file upload — must be set manually in `artifacts/api-server/.env`
2. Supabase bucket `payment-attachments` must be created manually (Dashboard → Storage → New bucket → public)
3. The bill PDF uses `jspdf-autotable` which adds `lastAutoTable` to the jsPDF instance — TypeScript may complain; cast with `(doc as any).lastAutoTable.finalY`
4. `Progress` component from shadcn/ui — verify it exists: `npx shadcn@latest add progress` if not present
5. `useUpdateBillingRecord` hook — verify the codegen exported it (operationId: `updateBillingRecord`)
6. Bill number uniqueness: if two bills are created in the same second, the count-based numbering may collide — acceptable for now (internal tool)
