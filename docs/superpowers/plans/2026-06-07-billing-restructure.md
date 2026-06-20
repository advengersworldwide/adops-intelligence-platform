# Billing Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the billing system with dual forex rates, bulk discounts, tax field migration, client_id on billing records, a standalone Billing module, and renamed/scoped Data tabs per entity.

**Architecture:** DB changes flow through Drizzle schemas → OpenAPI spec → codegen → API routes → frontend. A shared `computeRow` utility is extracted to both backend and frontend libs so all calculation logic stays in one place per side.

**Tech Stack:** PostgreSQL + Drizzle ORM, Express, OpenAPI 3.1 + Orval codegen, React + Wouter + TanStack Query, shadcn/ui, Recharts

---

## File Map

| Action | Path |
|---|---|
| Create | `lib/db/migrations/0003_billing_restructure.sql` |
| Modify | `lib/db/src/schema/buying-houses.ts` |
| Modify | `lib/db/src/schema/platforms.ts` |
| Modify | `lib/db/src/schema/billing-records.ts` |
| Modify | `lib/api-spec/openapi.yaml` |
| Generated | `lib/api-zod/src/generated/**` |
| Generated | `lib/api-client-react/src/generated/**` |
| Create | `artifacts/api-server/src/lib/computeRow.ts` |
| Modify | `artifacts/api-server/src/routes/buying-houses.ts` |
| Modify | `artifacts/api-server/src/routes/platforms.ts` |
| Modify | `artifacts/api-server/src/routes/billing-records.ts` |
| Create | `artifacts/api-server/src/routes/billing.ts` |
| Modify | `artifacts/api-server/src/routes/index.ts` |
| Modify | `artifacts/api-server/src/lib/seed.ts` |
| Create | `artifacts/adops/src/lib/computeRow.ts` |
| Modify | `artifacts/adops/src/lib/auth.ts` |
| Modify | `artifacts/adops/src/components/layout/Sidebar.tsx` |
| Modify | `artifacts/adops/src/App.tsx` |
| Create | `artifacts/adops/src/pages/Billing.tsx` |
| Rename+Modify | `artifacts/adops/src/pages/PlatformDetail/TransactionsTab.tsx` → `DataTab.tsx` |
| Modify | `artifacts/adops/src/pages/PlatformDetail.tsx` |
| Modify | `artifacts/adops/src/pages/PlatformDetail/DetailsTab.tsx` |
| Modify | `artifacts/adops/src/pages/BuyingHouses.tsx` |
| Modify | `artifacts/adops/src/pages/BuyingHouseDetail.tsx` |
| Modify | `artifacts/adops/src/pages/ClientDetail.tsx` |

---

## Task 1: Migration SQL — write and apply

**Files:**
- Create: `lib/db/migrations/0003_billing_restructure.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- lib/db/migrations/0003_billing_restructure.sql
-- Billing restructure:
-- - buying_houses gains salesTaxPct, withholdingTaxPct, forexSellingRate, bulkDiscountPct
-- - platforms: salesTaxPct + withholdingTaxPct removed, gains forexBuyingRate + bulkDiscountPct
-- - billing_records: forexRate split into forexSellingRate + forexBuyingRate, gains bulkDiscountPct,
--   platformBulkDiscountPct, clientId

-- 1. Add new fields to buying_houses
ALTER TABLE buying_houses
  ADD COLUMN sales_tax_pct numeric(6,2),
  ADD COLUMN withholding_tax_pct numeric(6,2),
  ADD COLUMN forex_selling_rate numeric(10,4),
  ADD COLUMN bulk_discount_pct numeric(6,2);

-- 2. Add new fields to platforms
ALTER TABLE platforms
  ADD COLUMN forex_buying_rate numeric(10,4),
  ADD COLUMN bulk_discount_pct numeric(6,2);

-- 3. Remove sales_tax_pct and withholding_tax_pct from platforms
ALTER TABLE platforms
  DROP COLUMN sales_tax_pct,
  DROP COLUMN withholding_tax_pct;

-- 4. Add new fields to billing_records (nullable first for data migration)
ALTER TABLE billing_records
  ADD COLUMN forex_selling_rate numeric(10,4),
  ADD COLUMN forex_buying_rate numeric(10,4),
  ADD COLUMN bulk_discount_pct numeric(6,2) NOT NULL DEFAULT 0,
  ADD COLUMN platform_bulk_discount_pct numeric(6,2) NOT NULL DEFAULT 0,
  ADD COLUMN client_id integer REFERENCES clients(id) ON DELETE SET NULL;

-- 5. Populate split forex rates from existing single rate
UPDATE billing_records
  SET forex_selling_rate = forex_rate, forex_buying_rate = forex_rate;

-- 6. Make forex rates NOT NULL now that data is populated
ALTER TABLE billing_records
  ALTER COLUMN forex_selling_rate SET NOT NULL,
  ALTER COLUMN forex_buying_rate SET NOT NULL;

-- 7. Drop the old single forex_rate column
ALTER TABLE billing_records DROP COLUMN forex_rate;

-- 8. Drop DEFAULT sentinel (columns stay NOT NULL)
ALTER TABLE billing_records
  ALTER COLUMN bulk_discount_pct DROP DEFAULT,
  ALTER COLUMN platform_bulk_discount_pct DROP DEFAULT;
```

- [ ] **Step 2: Apply the migration**

```javascript
// scripts/run-0003.mjs
import pg from '../node_modules/.pnpm/pg@8.20.0/node_modules/pg/esm/index.mjs';
import { readFileSync } from 'fs';
const { Client } = pg;
const client = new Client({
  connectionString: 'postgresql://postgres.btvxavdscifcvincwzlo:Advengers786.@aws-1-ap-south-1.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false }
});
await client.connect();
const sql = readFileSync('lib/db/migrations/0003_billing_restructure.sql', 'utf8');
await client.query(sql);
console.log('Migration 0003 applied');
await client.end();
```

Run: `node scripts/run-0003.mjs` then `rm scripts/run-0003.mjs`

Expected: `Migration 0003 applied` with no errors.

- [ ] **Step 3: Commit**
```bash
git add lib/db/migrations/0003_billing_restructure.sql
git commit -m "feat(db): migration 0003 — billing restructure, dual forex, bulk discounts, client_id"
```

---

## Task 2: Update Drizzle schemas

**Files:**
- Modify: `lib/db/src/schema/buying-houses.ts`
- Modify: `lib/db/src/schema/platforms.ts`
- Modify: `lib/db/src/schema/billing-records.ts`

- [ ] **Step 1: Update buying-houses.ts**

Replace entire file:
```typescript
import { pgTable, text, serial, timestamp, numeric } from "drizzle-orm/pg-core";

export const buyingHousesTable = pgTable("buying_houses", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  salesTaxPct: numeric("sales_tax_pct", { precision: 6, scale: 2 }),
  withholdingTaxPct: numeric("withholding_tax_pct", { precision: 6, scale: 2 }),
  forexSellingRate: numeric("forex_selling_rate", { precision: 10, scale: 4 }),
  bulkDiscountPct: numeric("bulk_discount_pct", { precision: 6, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BuyingHouse = typeof buyingHousesTable.$inferSelect;
```

- [ ] **Step 2: Update platforms.ts**

Replace entire file:
```typescript
import { pgTable, text, serial, timestamp, numeric } from "drizzle-orm/pg-core";

export const platformsTable = pgTable("platforms", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  // contact
  address: text("address"),
  pocName: text("poc_name"),
  pocNumber: text("poc_number"),
  pocEmail: text("poc_email"),
  companyEmail: text("company_email"),
  companyNumber: text("company_number"),
  // banking
  bankName: text("bank_name"),
  bankAccountNumber: text("bank_account_number"),
  bankAddress: text("bank_address"),
  swiftCode: text("swift_code"),
  iban: text("iban"),
  // legal / tax
  salesTaxNumber: text("sales_tax_number"),
  ntnNumber: text("ntn_number"),
  paymentTerms: text("payment_terms"),
  remittanceTaxPct: numeric("remittance_tax_pct", { precision: 6, scale: 2 }),
  forexBuyingRate: numeric("forex_buying_rate", { precision: 10, scale: 4 }),
  bulkDiscountPct: numeric("bulk_discount_pct", { precision: 6, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type Platform = typeof platformsTable.$inferSelect;
```

- [ ] **Step 3: Update billing-records.ts**

Replace entire file:
```typescript
import { pgTable, serial, integer, text, numeric, timestamp } from "drizzle-orm/pg-core";
import { platformsTable } from "./platforms";
import { buyingHousesTable } from "./buying-houses";
import { platformCostModelsTable } from "./platform-cost-models";
import { clientsTable } from "./clients";

export const billingRecordsTable = pgTable("billing_records", {
  id: serial("id").primaryKey(),
  platformId: integer("platform_id")
    .notNull()
    .references(() => platformsTable.id, { onDelete: "cascade" }),
  buyingHouseId: integer("buying_house_id")
    .notNull()
    .references(() => buyingHousesTable.id),
  clientId: integer("client_id")
    .references(() => clientsTable.id, { onDelete: "set null" }),
  costModelId: integer("cost_model_id")
    .notNull()
    .references(() => platformCostModelsTable.id),
  period: text("period").notNull(),
  appsflyerPins: integer("appsflyer_pins").notNull(),
  fraudPins: integer("fraud_pins").notNull(),
  payoutRate: numeric("payout_rate", { precision: 12, scale: 4 }).notNull(),
  marginPct: numeric("margin_pct", { precision: 6, scale: 2 }).notNull(),
  forexSellingRate: numeric("forex_selling_rate", { precision: 10, scale: 4 }).notNull(),
  forexBuyingRate: numeric("forex_buying_rate", { precision: 10, scale: 4 }).notNull(),
  salesTaxPct: numeric("sales_tax_pct", { precision: 6, scale: 2 }).notNull(),
  remittanceTaxPct: numeric("remittance_tax_pct", { precision: 6, scale: 2 }).notNull(),
  withholdingTaxPct: numeric("withholding_tax_pct", { precision: 6, scale: 2 }).notNull(),
  bulkDiscountPct: numeric("bulk_discount_pct", { precision: 6, scale: 2 }).notNull(),
  platformBulkDiscountPct: numeric("platform_bulk_discount_pct", { precision: 6, scale: 2 }).notNull(),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BillingRecord = typeof billingRecordsTable.$inferSelect;
```

- [ ] **Step 4: Commit**
```bash
git add lib/db/src/schema/buying-houses.ts lib/db/src/schema/platforms.ts lib/db/src/schema/billing-records.ts
git commit -m "feat(db): update schemas — dual forex, bulk discounts, client_id, tax field migration"
```

---

## Task 3: OpenAPI Spec — full update

**Files:**
- Modify: `lib/api-spec/openapi.yaml`

Make all changes in sequence.

### 3a — Add `billing` tag (after `buying-houses` tag)
```yaml
  - name: billing
    description: Standalone billing record management
```

### 3b — Add top-level billing-records GET path (before `components:`)
```yaml
  # ── Billing (top-level) ───────────────────────────────────────────────────────
  /billing-records:
    get:
      operationId: listAllBillingRecords
      tags: [billing]
      summary: List all billing records across all platforms
      parameters:
        - name: platformId
          in: query
          schema:
            type: ["integer", "null"]
        - name: buyingHouseId
          in: query
          schema:
            type: ["integer", "null"]
        - name: clientId
          in: query
          schema:
            type: ["integer", "null"]
        - name: period
          in: query
          schema:
            type: ["string", "null"]
      responses:
        "200":
          description: List of all billing records
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/BillingRecord"
```

### 3c — Update `listBillingRecords` query params (platform-scoped)

Add `clientId` query param to the existing `/platforms/{id}/billing-records` GET:
```yaml
        - name: clientId
          in: query
          schema:
            type: ["integer", "null"]
```

### 3d — Update `Platform` schema

Remove `salesTaxPct` and `withholdingTaxPct` properties. Add:
```yaml
        forexBuyingRate:
          type: ["number", "null"]
        bulkDiscountPct:
          type: ["number", "null"]
```

Do the same in `PlatformInput` and `PlatformUpdate`.

### 3e — Update `BuyingHouse` schema

Add to properties:
```yaml
        salesTaxPct:
          type: ["number", "null"]
        withholdingTaxPct:
          type: ["number", "null"]
        forexSellingRate:
          type: ["number", "null"]
        bulkDiscountPct:
          type: ["number", "null"]
```

Do the same in `BuyingHouseInput`.

### 3f — Update `BillingRecord` schema

Replace `forexRate: number` with dual rates; add discount and client fields:

In `required` array: remove `forexRate`, add `forexSellingRate`, `forexBuyingRate`, `bulkDiscountPct`, `platformBulkDiscountPct`.

Replace/add properties:
```yaml
        forexSellingRate:
          type: number
        forexBuyingRate:
          type: number
        bulkDiscountPct:
          type: number
        platformBulkDiscountPct:
          type: number
        clientId:
          type: ["integer", "null"]
        clientName:
          type: ["string", "null"]
```
Remove `forexRate` property entirely.

### 3g — Update `BillingRecordInput` schema

In `required`: remove `forexRate`, add `forexSellingRate`, `forexBuyingRate`, `bulkDiscountPct`, `platformBulkDiscountPct`.

Replace/add properties:
```yaml
        forexSellingRate:
          type: number
        forexBuyingRate:
          type: number
        bulkDiscountPct:
          type: number
        platformBulkDiscountPct:
          type: number
        clientId:
          type: ["integer", "null"]
```
Remove `forexRate` property.

- [ ] **Step: Commit**
```bash
git add lib/api-spec/openapi.yaml
git commit -m "feat(spec): billing restructure — dual forex, bulk discounts, clientId, billing tag"
```

---

## Task 4: Run Codegen

- [ ] **Step 1: Run**
```bash
cd "e:/Futurama Projects/adops-intelligence-platform/lib/api-spec"
pnpm run codegen
```
Expected: `🎉 api-client-react` and `🎉 zod` success, `tsc --build` exits 0.

- [ ] **Step 2: Verify key types exist**
```bash
grep -n "forexSellingRate\|forexBuyingRate\|bulkDiscountPct" lib/api-zod/src/generated/types/billingRecord.ts | head -10
grep -n "useListAllBillingRecords" lib/api-client-react/src/generated/api.ts | head -3
```

- [ ] **Step 3: Commit**
```bash
git add lib/api-zod/src/generated lib/api-client-react/src/generated
git commit -m "feat(codegen): regenerate for billing restructure"
```

---

## Task 5: Backend computeRow shared utility

**Files:**
- Create: `artifacts/api-server/src/lib/computeRow.ts`

- [ ] **Step 1: Create the file**

```typescript
// artifacts/api-server/src/lib/computeRow.ts
// Mirrors frontend lib/computeRow.ts — keep both in sync when formula changes.

export interface ComputeRowInput {
  appsflyerPins: number;
  fraudPins: number;
  payoutRate: string;
  marginPct: string;
  forexSellingRate: string;
  forexBuyingRate: string;
  salesTaxPct: string;
  remittanceTaxPct: string;
  withholdingTaxPct: string;
  bulkDiscountPct: string;
  platformBulkDiscountPct: string;
}

export interface ComputeRowResult {
  actualPins: number;
  netAmtUsd: number;
  netAmtPkr: number;
  grossAmtPkr: number;
  salesTax: number;
  totalAmtPkr: number;
  bulkDiscountAmt: number;
  amtAfterDiscount: number;
  wht: number;
  receivablePkr: number;
  netPayableUsd: number;
  remittanceTax: number;
  totalPayableUsd: number;
  platformDiscountAmt: number;
  totalPayablePkr: number;
  netMarginPkr: number;
}

export function computeRow(r: ComputeRowInput): ComputeRowResult {
  const actualPins = r.appsflyerPins - r.fraudPins;
  const payoutRate = Number(r.payoutRate);
  const marginPct = Number(r.marginPct);
  const forexSellingRate = Number(r.forexSellingRate);
  const forexBuyingRate = Number(r.forexBuyingRate);
  const salesTaxPct = Number(r.salesTaxPct);
  const remittanceTaxPct = Number(r.remittanceTaxPct);
  const withholdingTaxPct = Number(r.withholdingTaxPct);
  const bulkDiscountPct = Number(r.bulkDiscountPct);
  const platformBulkDiscountPct = Number(r.platformBulkDiscountPct);

  // Receivable side (invoice to buying house, forex selling rate)
  const netAmtUsd = actualPins * payoutRate;
  const netAmtPkr = netAmtUsd * forexSellingRate;
  const grossAmtPkr = marginPct > 0 ? netAmtPkr / (1 - marginPct / 100) : netAmtPkr;
  const salesTax = grossAmtPkr * (salesTaxPct / 100);
  const totalAmtPkr = grossAmtPkr + salesTax;
  const bulkDiscountAmt = totalAmtPkr * (bulkDiscountPct / 100);
  const amtAfterDiscount = totalAmtPkr - bulkDiscountAmt;
  const wht = amtAfterDiscount * (withholdingTaxPct / 100);
  const receivablePkr = amtAfterDiscount - wht - salesTax;

  // Payable side (payment to platform, forex buying rate)
  const netPayableUsd = netAmtUsd * (1 - marginPct / 100);
  const remittanceTax = netPayableUsd * (remittanceTaxPct / 100);
  const totalPayableUsd = netPayableUsd + remittanceTax;
  const platformDiscountAmt = totalPayableUsd * (platformBulkDiscountPct / 100);
  const totalPayablePkr = (totalPayableUsd - platformDiscountAmt) * forexBuyingRate;

  const netMarginPkr = receivablePkr - totalPayablePkr;

  return {
    actualPins, netAmtUsd, netAmtPkr, grossAmtPkr,
    salesTax, totalAmtPkr, bulkDiscountAmt, amtAfterDiscount, wht,
    receivablePkr, netPayableUsd, remittanceTax, totalPayableUsd,
    platformDiscountAmt, totalPayablePkr, netMarginPkr,
  };
}
```

- [ ] **Step 2: Commit**
```bash
git add artifacts/api-server/src/lib/computeRow.ts
git commit -m "feat(api): extract shared computeRow utility with dual forex + bulk discounts"
```

---

## Task 6: Frontend computeRow shared utility

**Files:**
- Create: `artifacts/adops/src/lib/computeRow.ts`

- [ ] **Step 1: Create the file**

```typescript
// artifacts/adops/src/lib/computeRow.ts
// Mirrors artifacts/api-server/src/lib/computeRow.ts — keep both in sync.

export interface ComputeRowInput {
  appsflyerPins: number;
  fraudPins: number;
  payoutRate: number;
  marginPct: number;
  forexSellingRate: number;
  forexBuyingRate: number;
  salesTaxPct: number;
  remittanceTaxPct: number;
  withholdingTaxPct: number;
  bulkDiscountPct: number;
  platformBulkDiscountPct: number;
}

export interface ComputeRowResult {
  actualPins: number;
  netAmtUsd: number;
  netAmtPkr: number;
  grossAmtPkr: number;
  salesTax: number;
  totalAmtPkr: number;
  bulkDiscountAmt: number;
  amtAfterDiscount: number;
  wht: number;
  receivablePkr: number;
  netPayableUsd: number;
  remittanceTax: number;
  totalPayableUsd: number;
  platformDiscountAmt: number;
  totalPayablePkr: number;
  netMarginPkr: number;
}

export function computeRow(r: ComputeRowInput): ComputeRowResult {
  const { appsflyerPins, fraudPins, payoutRate, marginPct,
    forexSellingRate, forexBuyingRate, salesTaxPct, remittanceTaxPct,
    withholdingTaxPct, bulkDiscountPct, platformBulkDiscountPct } = r;

  const actualPins = appsflyerPins - fraudPins;
  const netAmtUsd = actualPins * payoutRate;
  const netAmtPkr = netAmtUsd * forexSellingRate;
  const grossAmtPkr = marginPct > 0 ? netAmtPkr / (1 - marginPct / 100) : netAmtPkr;
  const salesTax = grossAmtPkr * (salesTaxPct / 100);
  const totalAmtPkr = grossAmtPkr + salesTax;
  const bulkDiscountAmt = totalAmtPkr * (bulkDiscountPct / 100);
  const amtAfterDiscount = totalAmtPkr - bulkDiscountAmt;
  const wht = amtAfterDiscount * (withholdingTaxPct / 100);
  const receivablePkr = amtAfterDiscount - wht - salesTax;

  const netPayableUsd = netAmtUsd * (1 - marginPct / 100);
  const remittanceTax = netPayableUsd * (remittanceTaxPct / 100);
  const totalPayableUsd = netPayableUsd + remittanceTax;
  const platformDiscountAmt = totalPayableUsd * (platformBulkDiscountPct / 100);
  const totalPayablePkr = (totalPayableUsd - platformDiscountAmt) * forexBuyingRate;
  const netMarginPkr = receivablePkr - totalPayablePkr;

  return {
    actualPins, netAmtUsd, netAmtPkr, grossAmtPkr,
    salesTax, totalAmtPkr, bulkDiscountAmt, amtAfterDiscount, wht,
    receivablePkr, netPayableUsd, remittanceTax, totalPayableUsd,
    platformDiscountAmt, totalPayablePkr, netMarginPkr,
  };
}
```

- [ ] **Step 2: Commit**
```bash
git add artifacts/adops/src/lib/computeRow.ts
git commit -m "feat(ui): extract shared computeRow utility with dual forex + bulk discounts"
```

---

## Task 7: Update buying-houses API route

**Files:**
- Modify: `artifacts/api-server/src/routes/buying-houses.ts`

- [ ] **Step 1: Replace the entire file**

```typescript
import { Router, type IRouter } from "express";
import { eq, count } from "drizzle-orm";
import { db, buyingHousesTable, billingRecordsTable, clientsTable, platformsTable } from "@workspace/db";
import { computeRow } from "../lib/computeRow";
import {
  ListBuyingHousesResponse,
  GetBuyingHouseResponse,
  CreateBuyingHouseBody,
  GetBuyingHouseParams,
  UpdateBuyingHouseParams,
  DeleteBuyingHouseParams,
  GetBuyingHouseAnalyticsParams,
  GetBuyingHouseAnalyticsResponse,
  ListBuyingHouseBillingRecordsParams,
  ListBuyingHouseBillingRecordsResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function aggregateBH(bhId: number) {
  const records = await db.select().from(billingRecordsTable)
    .where(eq(billingRecordsTable.buyingHouseId, bhId));
  let totalReceivablePkr = 0;
  let totalPayablePkr = 0;
  for (const r of records) {
    const c = computeRow(r);
    totalReceivablePkr += c.receivablePkr;
    totalPayablePkr += c.totalPayablePkr;
  }
  return { totalReceivablePkr, totalPayablePkr, netMarginPkr: totalReceivablePkr - totalPayablePkr };
}

function mapBH(bh: typeof buyingHousesTable.$inferSelect) {
  return {
    id: bh.id,
    name: bh.name,
    salesTaxPct: bh.salesTaxPct !== null ? Number(bh.salesTaxPct) : null,
    withholdingTaxPct: bh.withholdingTaxPct !== null ? Number(bh.withholdingTaxPct) : null,
    forexSellingRate: bh.forexSellingRate !== null ? Number(bh.forexSellingRate) : null,
    bulkDiscountPct: bh.bulkDiscountPct !== null ? Number(bh.bulkDiscountPct) : null,
    createdAt: bh.createdAt.toISOString(),
  };
}

router.get("/buying-houses", async (req, res): Promise<void> => {
  const bhs = await db.select().from(buyingHousesTable).orderBy(buyingHousesTable.createdAt);
  const result = await Promise.all(bhs.map(async (bh) => {
    const [{ clientCount }] = await db
      .select({ clientCount: count() })
      .from(clientsTable)
      .where(eq(clientsTable.buyingHouseId, bh.id));
    const { netMarginPkr } = await aggregateBH(bh.id);
    return { ...mapBH(bh), clientCount: Number(clientCount), netMarginPkr };
  }));
  res.json(ListBuyingHousesResponse.parse(result));
});

router.post("/buying-houses", async (req, res): Promise<void> => {
  const parsed = CreateBuyingHouseBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [row] = await db.insert(buyingHousesTable).values({
    name: parsed.data.name,
    salesTaxPct: parsed.data.salesTaxPct != null ? String(parsed.data.salesTaxPct) : null,
    withholdingTaxPct: parsed.data.withholdingTaxPct != null ? String(parsed.data.withholdingTaxPct) : null,
    forexSellingRate: parsed.data.forexSellingRate != null ? String(parsed.data.forexSellingRate) : null,
    bulkDiscountPct: parsed.data.bulkDiscountPct != null ? String(parsed.data.bulkDiscountPct) : null,
  }).returning();
  res.status(201).json(GetBuyingHouseResponse.parse({ ...mapBH(row), clientCount: 0, netMarginPkr: 0 }));
});

router.get("/buying-houses/:id", async (req, res): Promise<void> => {
  const params = GetBuyingHouseParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [bh] = await db.select().from(buyingHousesTable).where(eq(buyingHousesTable.id, params.data.id));
  if (!bh) { res.status(404).json({ error: "Buying house not found" }); return; }
  const [{ clientCount }] = await db.select({ clientCount: count() }).from(clientsTable)
    .where(eq(clientsTable.buyingHouseId, bh.id));
  const { netMarginPkr } = await aggregateBH(bh.id);
  res.json(GetBuyingHouseResponse.parse({ ...mapBH(bh), clientCount: Number(clientCount), netMarginPkr }));
});

router.patch("/buying-houses/:id", async (req, res): Promise<void> => {
  const params = UpdateBuyingHouseParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = CreateBuyingHouseBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const updates: Record<string, unknown> = { name: parsed.data.name };
  if (parsed.data.salesTaxPct !== undefined) updates.salesTaxPct = parsed.data.salesTaxPct != null ? String(parsed.data.salesTaxPct) : null;
  if (parsed.data.withholdingTaxPct !== undefined) updates.withholdingTaxPct = parsed.data.withholdingTaxPct != null ? String(parsed.data.withholdingTaxPct) : null;
  if (parsed.data.forexSellingRate !== undefined) updates.forexSellingRate = parsed.data.forexSellingRate != null ? String(parsed.data.forexSellingRate) : null;
  if (parsed.data.bulkDiscountPct !== undefined) updates.bulkDiscountPct = parsed.data.bulkDiscountPct != null ? String(parsed.data.bulkDiscountPct) : null;
  const [row] = await db.update(buyingHousesTable).set(updates)
    .where(eq(buyingHousesTable.id, params.data.id)).returning();
  if (!row) { res.status(404).json({ error: "Buying house not found" }); return; }
  const [{ clientCount }] = await db.select({ clientCount: count() }).from(clientsTable)
    .where(eq(clientsTable.buyingHouseId, row.id));
  const { netMarginPkr } = await aggregateBH(row.id);
  res.json(GetBuyingHouseResponse.parse({ ...mapBH(row), clientCount: Number(clientCount), netMarginPkr }));
});

router.delete("/buying-houses/:id", async (req, res): Promise<void> => {
  const params = DeleteBuyingHouseParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  try {
    const [row] = await db.delete(buyingHousesTable)
      .where(eq(buyingHousesTable.id, params.data.id)).returning();
    if (!row) { res.status(404).json({ error: "Buying house not found" }); return; }
    res.sendStatus(204);
  } catch (err: unknown) {
    const e = err as { code?: string; cause?: { code?: string } };
    if ((e.code ?? e.cause?.code) === "23503") {
      res.status(400).json({ error: "Cannot delete: this buying house has billing records linked to it." });
      return;
    }
    console.error("[buying-houses DELETE]", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to delete" });
  }
});

router.get("/buying-houses/:id/analytics", async (req, res): Promise<void> => {
  const params = GetBuyingHouseAnalyticsParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [bh] = await db.select().from(buyingHousesTable).where(eq(buyingHousesTable.id, params.data.id));
  if (!bh) { res.status(404).json({ error: "Buying house not found" }); return; }

  const records = await db.select().from(billingRecordsTable)
    .where(eq(billingRecordsTable.buyingHouseId, params.data.id));

  let totalReceivablePkr = 0;
  let totalPayablePkr = 0;
  const periodMap = new Map<string, { receivablePkr: number; payablePkr: number; netMarginPkr: number }>();

  for (const r of records) {
    const c = computeRow(r);
    totalReceivablePkr += c.receivablePkr;
    totalPayablePkr += c.totalPayablePkr;
    const prev = periodMap.get(r.period) ?? { receivablePkr: 0, payablePkr: 0, netMarginPkr: 0 };
    periodMap.set(r.period, {
      receivablePkr: prev.receivablePkr + c.receivablePkr,
      payablePkr: prev.payablePkr + c.totalPayablePkr,
      netMarginPkr: prev.netMarginPkr + c.netMarginPkr,
    });
  }

  const netMarginPkr = totalReceivablePkr - totalPayablePkr;
  const marginPct = totalReceivablePkr > 0 ? (netMarginPkr / totalReceivablePkr) * 100 : 0;
  const monthlyTrend = Array.from(periodMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, vals]) => ({ period, ...vals }));

  const clientRows = await db.select({ id: clientsTable.id, name: clientsTable.name })
    .from(clientsTable).where(eq(clientsTable.buyingHouseId, params.data.id));

  res.json(GetBuyingHouseAnalyticsResponse.parse({
    totalReceivablePkr, totalPayablePkr, netMarginPkr, marginPct, monthlyTrend,
    clients: clientRows,
  }));
});

router.get("/buying-houses/:id/billing-records", async (req, res): Promise<void> => {
  const params = ListBuyingHouseBillingRecordsParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [bh] = await db.select().from(buyingHousesTable).where(eq(buyingHousesTable.id, params.data.id));
  if (!bh) { res.status(404).json({ error: "Buying house not found" }); return; }

  const rows = await db
    .select({
      id: billingRecordsTable.id, period: billingRecordsTable.period,
      platformId: billingRecordsTable.platformId,
      appsflyerPins: billingRecordsTable.appsflyerPins, fraudPins: billingRecordsTable.fraudPins,
      payoutRate: billingRecordsTable.payoutRate, marginPct: billingRecordsTable.marginPct,
      forexSellingRate: billingRecordsTable.forexSellingRate, forexBuyingRate: billingRecordsTable.forexBuyingRate,
      salesTaxPct: billingRecordsTable.salesTaxPct, remittanceTaxPct: billingRecordsTable.remittanceTaxPct,
      withholdingTaxPct: billingRecordsTable.withholdingTaxPct,
      bulkDiscountPct: billingRecordsTable.bulkDiscountPct,
      platformBulkDiscountPct: billingRecordsTable.platformBulkDiscountPct,
      createdAt: billingRecordsTable.createdAt, platformName: platformsTable.name,
    })
    .from(billingRecordsTable)
    .leftJoin(platformsTable, eq(billingRecordsTable.platformId, platformsTable.id))
    .where(eq(billingRecordsTable.buyingHouseId, params.data.id))
    .orderBy(billingRecordsTable.period);

  const mapped = rows.map(r => {
    const c = computeRow(r);
    return {
      id: r.id, period: r.period, platformId: r.platformId,
      platformName: r.platformName ?? null,
      appsflyerPins: r.appsflyerPins, fraudPins: r.fraudPins,
      actualPins: c.actualPins, netMarginPkr: c.netMarginPkr,
      createdAt: r.createdAt.toISOString(),
    };
  });
  res.json(ListBuyingHouseBillingRecordsResponse.parse(mapped));
});

export default router;
```

- [ ] **Step 2: Commit**
```bash
git add artifacts/api-server/src/routes/buying-houses.ts
git commit -m "feat(api): update buying-houses route — new fields, shared computeRow"
```

---

## Task 8: Update platforms API route

**Files:**
- Modify: `artifacts/api-server/src/routes/platforms.ts`

Read the file first. The key changes are:
1. Remove `salesTaxPct` and `withholdingTaxPct` from `mapRow` response and insert/update handlers
2. Add `forexBuyingRate` and `bulkDiscountPct` to all shapes
3. All numeric fields still go through `String()` on write and `parseFloat` on read

- [ ] **Step 1: In `mapRow` function** — remove `salesTaxPct: ...` and `withholdingTaxPct: ...` lines, add:
```typescript
forexBuyingRate: r.forexBuyingRate !== null ? parseFloat(r.forexBuyingRate) : null,
bulkDiscountPct: r.bulkDiscountPct !== null ? parseFloat(r.bulkDiscountPct) : null,
```

- [ ] **Step 2: In POST handler** — remove `salesTaxPct` and `withholdingTaxPct` from the `.values({...})` call, add:
```typescript
forexBuyingRate: parsed.data.forexBuyingRate != null ? String(parsed.data.forexBuyingRate) : null,
bulkDiscountPct: parsed.data.bulkDiscountPct != null ? String(parsed.data.bulkDiscountPct) : null,
```

- [ ] **Step 3: In PATCH handler** — replace `salesTaxPct` and `withholdingTaxPct` update lines with:
```typescript
if (parsed.data.forexBuyingRate !== undefined)
  updates.forexBuyingRate = parsed.data.forexBuyingRate != null ? String(parsed.data.forexBuyingRate) : null;
if (parsed.data.bulkDiscountPct !== undefined)
  updates.bulkDiscountPct = parsed.data.bulkDiscountPct != null ? String(parsed.data.bulkDiscountPct) : null;
```

- [ ] **Step 4: Commit**
```bash
git add artifacts/api-server/src/routes/platforms.ts
git commit -m "feat(api): update platforms route — remove salesTaxPct/withholdingTaxPct, add forexBuyingRate/bulkDiscountPct"
```

---

## Task 9: Update billing-records (platform-scoped) route

**Files:**
- Modify: `artifacts/api-server/src/routes/billing-records.ts`

- [ ] **Step 1: Replace entire file**

```typescript
import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, billingRecordsTable, buyingHousesTable, platformCostModelsTable, clientsTable } from "@workspace/db";
import { optionalAuth } from "../middlewares/auth";
import {
  ListBillingRecordsParams,
  ListBillingRecordsQueryParams,
  ListBillingRecordsResponse,
  CreateBillingRecordParams,
  CreateBillingRecordBody,
  ListBillingRecordsResponseItem,
  DeleteBillingRecordParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function mapRecord(r: typeof billingRecordsTable.$inferSelect) {
  const [bh] = await db.select().from(buyingHousesTable).where(eq(buyingHousesTable.id, r.buyingHouseId));
  const [cm] = await db.select().from(platformCostModelsTable)
    .where(eq(platformCostModelsTable.id, r.costModelId));
  const client = r.clientId
    ? (await db.select({ name: clientsTable.name }).from(clientsTable)
        .where(eq(clientsTable.id, r.clientId)))[0]
    : null;
  return {
    id: r.id,
    platformId: r.platformId,
    buyingHouseId: r.buyingHouseId,
    buyingHouseName: bh?.name ?? null,
    clientId: r.clientId ?? null,
    clientName: client?.name ?? null,
    costModelId: r.costModelId,
    costModelName: cm?.name ?? null,
    costModelPayoutRate: cm ? Number(cm.payoutRate) : null,
    costModelMarginPct: cm ? Number(cm.marginPct) : null,
    period: r.period,
    appsflyerPins: r.appsflyerPins,
    fraudPins: r.fraudPins,
    payoutRate: Number(r.payoutRate),
    marginPct: Number(r.marginPct),
    forexSellingRate: Number(r.forexSellingRate),
    forexBuyingRate: Number(r.forexBuyingRate),
    salesTaxPct: Number(r.salesTaxPct),
    remittanceTaxPct: Number(r.remittanceTaxPct),
    withholdingTaxPct: Number(r.withholdingTaxPct),
    bulkDiscountPct: Number(r.bulkDiscountPct),
    platformBulkDiscountPct: Number(r.platformBulkDiscountPct),
    createdBy: r.createdBy,
    createdAt: r.createdAt.toISOString(),
  };
}

router.get("/platforms/:id/billing-records", async (req, res): Promise<void> => {
  const params = ListBillingRecordsParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const query = ListBillingRecordsQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }

  const conditions = [eq(billingRecordsTable.platformId, params.data.id)];
  if (query.data.period != null) conditions.push(eq(billingRecordsTable.period, query.data.period));
  if (query.data.buyingHouseId != null) conditions.push(eq(billingRecordsTable.buyingHouseId, query.data.buyingHouseId));
  if (query.data.clientId != null) conditions.push(eq(billingRecordsTable.clientId, query.data.clientId));

  const rows = await db.select().from(billingRecordsTable)
    .where(and(...conditions)).orderBy(billingRecordsTable.createdAt);
  const mapped = await Promise.all(rows.map(mapRecord));
  res.json(ListBillingRecordsResponse.parse(mapped));
});

router.post("/platforms/:id/billing-records", optionalAuth, async (req, res): Promise<void> => {
  const params = CreateBillingRecordParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = CreateBillingRecordBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  try {
    const createdBy: string | null = req.user?.name ?? req.user?.email ?? null;
    const [row] = await db.insert(billingRecordsTable).values({
      platformId: params.data.id,
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
      createdBy,
    }).returning();
    res.status(201).json(ListBillingRecordsResponseItem.parse(await mapRecord(row)));
  } catch (err) {
    console.error("[billing-records POST]", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to create billing record" });
  }
});

router.delete("/platforms/:id/billing-records/:recordId", async (req, res): Promise<void> => {
  const params = DeleteBillingRecordParams.safeParse({
    id: parseInt(req.params.id as string, 10),
    recordId: parseInt(req.params.recordId as string, 10),
  });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [row] = await db.delete(billingRecordsTable)
    .where(and(
      eq(billingRecordsTable.id, params.data.recordId),
      eq(billingRecordsTable.platformId, params.data.id),
    )).returning();
  if (!row) { res.status(404).json({ error: "Billing record not found" }); return; }
  res.sendStatus(204);
});

export default router;
```

- [ ] **Step 2: Commit**
```bash
git add artifacts/api-server/src/routes/billing-records.ts
git commit -m "feat(api): billing-records route — dual forex, bulk discounts, clientId, shared computeRow"
```

---

## Task 10: New top-level billing route + wire to index + seed

**Files:**
- Create: `artifacts/api-server/src/routes/billing.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`
- Modify: `artifacts/api-server/src/lib/seed.ts`

- [ ] **Step 1: Create billing.ts**

```typescript
import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import {
  db, billingRecordsTable, buyingHousesTable, clientsTable,
  platformsTable, platformCostModelsTable,
} from "@workspace/db";
import { ListAllBillingRecordsQueryParams, ListAllBillingRecordsResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/billing-records", async (req, res): Promise<void> => {
  const query = ListAllBillingRecordsQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }

  const conditions = [];
  if (query.data.platformId != null) conditions.push(eq(billingRecordsTable.platformId, query.data.platformId));
  if (query.data.buyingHouseId != null) conditions.push(eq(billingRecordsTable.buyingHouseId, query.data.buyingHouseId));
  if (query.data.clientId != null) conditions.push(eq(billingRecordsTable.clientId, query.data.clientId));
  if (query.data.period != null) conditions.push(eq(billingRecordsTable.period, query.data.period));

  const rows = await db
    .select({
      id: billingRecordsTable.id,
      platformId: billingRecordsTable.platformId,
      buyingHouseId: billingRecordsTable.buyingHouseId,
      clientId: billingRecordsTable.clientId,
      costModelId: billingRecordsTable.costModelId,
      period: billingRecordsTable.period,
      appsflyerPins: billingRecordsTable.appsflyerPins,
      fraudPins: billingRecordsTable.fraudPins,
      payoutRate: billingRecordsTable.payoutRate,
      marginPct: billingRecordsTable.marginPct,
      forexSellingRate: billingRecordsTable.forexSellingRate,
      forexBuyingRate: billingRecordsTable.forexBuyingRate,
      salesTaxPct: billingRecordsTable.salesTaxPct,
      remittanceTaxPct: billingRecordsTable.remittanceTaxPct,
      withholdingTaxPct: billingRecordsTable.withholdingTaxPct,
      bulkDiscountPct: billingRecordsTable.bulkDiscountPct,
      platformBulkDiscountPct: billingRecordsTable.platformBulkDiscountPct,
      createdBy: billingRecordsTable.createdBy,
      createdAt: billingRecordsTable.createdAt,
      platformName: platformsTable.name,
      buyingHouseName: buyingHousesTable.name,
      clientName: clientsTable.name,
      costModelName: platformCostModelsTable.name,
      costModelPayoutRate: platformCostModelsTable.payoutRate,
      costModelMarginPct: platformCostModelsTable.marginPct,
    })
    .from(billingRecordsTable)
    .leftJoin(platformsTable, eq(billingRecordsTable.platformId, platformsTable.id))
    .leftJoin(buyingHousesTable, eq(billingRecordsTable.buyingHouseId, buyingHousesTable.id))
    .leftJoin(clientsTable, eq(billingRecordsTable.clientId, clientsTable.id))
    .leftJoin(platformCostModelsTable, eq(billingRecordsTable.costModelId, platformCostModelsTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(billingRecordsTable.createdAt);

  const mapped = rows.map(r => ({
    id: r.id,
    platformId: r.platformId,
    platformName: r.platformName ?? null,
    buyingHouseId: r.buyingHouseId,
    buyingHouseName: r.buyingHouseName ?? null,
    clientId: r.clientId ?? null,
    clientName: r.clientName ?? null,
    costModelId: r.costModelId,
    costModelName: r.costModelName ?? null,
    costModelPayoutRate: r.costModelPayoutRate != null ? Number(r.costModelPayoutRate) : null,
    costModelMarginPct: r.costModelMarginPct != null ? Number(r.costModelMarginPct) : null,
    period: r.period,
    appsflyerPins: r.appsflyerPins,
    fraudPins: r.fraudPins,
    payoutRate: Number(r.payoutRate),
    marginPct: Number(r.marginPct),
    forexSellingRate: Number(r.forexSellingRate),
    forexBuyingRate: Number(r.forexBuyingRate),
    salesTaxPct: Number(r.salesTaxPct),
    remittanceTaxPct: Number(r.remittanceTaxPct),
    withholdingTaxPct: Number(r.withholdingTaxPct),
    bulkDiscountPct: Number(r.bulkDiscountPct),
    platformBulkDiscountPct: Number(r.platformBulkDiscountPct),
    createdBy: r.createdBy,
    createdAt: r.createdAt.toISOString(),
  }));

  res.json(ListAllBillingRecordsResponse.parse(mapped));
});

export default router;
```

- [ ] **Step 2: Update routes/index.ts** — add `import billingRouter from "./billing";` and `router.use(billingRouter);` after `billingRecordsRouter`.

- [ ] **Step 3: Update seed.ts** — rename `"View Transactions"` → `"View Billing"` in all three roles. Replace `"View Transactions"` with `"View Billing"` in the permissions arrays. The internal permission key changes here.

- [ ] **Step 4: Commit**
```bash
git add artifacts/api-server/src/routes/billing.ts artifacts/api-server/src/routes/index.ts artifacts/api-server/src/lib/seed.ts
git commit -m "feat(api): add top-level GET /billing-records; rename View Transactions → View Billing in seed"
```

---

## Task 11: Frontend — auth.ts + Sidebar + App.tsx

**Files:**
- Modify: `artifacts/adops/src/lib/auth.ts`
- Modify: `artifacts/adops/src/components/layout/Sidebar.tsx`
- Modify: `artifacts/adops/src/App.tsx`

- [ ] **Step 1: auth.ts** — in `ALL_PERMISSIONS`, replace `"View Transactions"` with `"View Billing"`.

- [ ] **Step 2: Sidebar.tsx** — in `navItems`:
  - Import `Receipt` from lucide-react (replace `ArrowLeftRight`)
  - Change the Transactions entry to: `{ href: "/billing", label: "Billing", icon: Receipt, permission: "View Billing" }`

- [ ] **Step 3: App.tsx**:
  - Remove `import TransactionsPage from "@/pages/Transactions";`
  - Add `import BillingPage from "@/pages/Billing";`
  - Replace `<Route path="/transactions"><PermissionGuard permission="View Transactions" component={TransactionsPage} /></Route>`
    with `<Route path="/billing"><PermissionGuard permission="View Billing" component={BillingPage} /></Route>`

- [ ] **Step 4: Commit**
```bash
git add artifacts/adops/src/lib/auth.ts artifacts/adops/src/components/layout/Sidebar.tsx artifacts/adops/src/App.tsx
git commit -m "feat(ui): rename Transactions → Billing in sidebar, routing, permissions"
```

---

## Task 12: Frontend — Billing.tsx (standalone module)

**Files:**
- Create: `artifacts/adops/src/pages/Billing.tsx`

This is the full financial audit view. It shows all billing records with all computed columns, filters, and the Add Record form.

- [ ] **Step 1: Create Billing.tsx**

```tsx
import { useState, useEffect } from "react";
import { Plus, Download } from "lucide-react";
import {
  useListAllBillingRecords, useCreateBillingRecord, useDeleteBillingRecord,
  useListBuyingHouses, useListClients, useListPlatforms,
  getListAllBillingRecordsQueryKey,
} from "@workspace/api-client-react";
import type { Platform, BuyingHouse } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { hasPermission } from "@/lib/auth";
import { computeRow } from "@/lib/computeRow";
import { cn } from "@/lib/utils";

function getGlobalForexRate(): number {
  try {
    const rates = JSON.parse(localStorage.getItem("adops-exchange-rates") ?? "{}");
    return (rates["pkr"] as number) ?? 278;
  } catch { return 278; }
}

function fmtNum(n: number | null | undefined, d = 2) {
  if (n == null || isNaN(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

type TH = { children?: React.ReactNode };
const TH = ({ children }: TH) => (
  <th className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground whitespace-nowrap">{children}</th>
);
type TD = { children?: React.ReactNode; bold?: boolean; className?: string };
const TD = ({ children, bold, className }: TD) => (
  <td className={cn("px-3 py-2 text-xs whitespace-nowrap", bold && "font-semibold", className)}>{children}</td>
);

const addRecordSchema = z.object({
  platformId: z.number({ required_error: "Platform is required" }),
  buyingHouseId: z.number({ required_error: "Buying house is required" }),
  clientId: z.number().nullable().optional(),
  costModelId: z.number({ required_error: "Cost model is required" }),
  period: z.string().min(1, "Period is required"),
  appsflyerPins: z.number().int().min(0),
  fraudPins: z.number().int().min(0),
  payoutRate: z.number().min(0),
  marginPct: z.number().min(0).max(100),
  forexSellingRate: z.number().min(0),
  forexBuyingRate: z.number().min(0),
  salesTaxPct: z.number().min(0),
  remittanceTaxPct: z.number().min(0),
  withholdingTaxPct: z.number().min(0),
  bulkDiscountPct: z.number().min(0),
  platformBulkDiscountPct: z.number().min(0),
});
type AddRecordForm = z.infer<typeof addRecordSchema>;

export default function BillingPage() {
  const [periodFilter, setPeriodFilter] = useState("");
  const [bhFilter, setBhFilter] = useState("all");
  const [clientFilter, setClientFilter] = useState("all");
  const [platformFilter, setPlatformFilter] = useState("all");
  const [addOpen, setAddOpen] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();

  const params = {
    ...(periodFilter ? { period: periodFilter } : {}),
    ...(bhFilter !== "all" ? { buyingHouseId: parseInt(bhFilter) } : {}),
    ...(clientFilter !== "all" ? { clientId: parseInt(clientFilter) } : {}),
    ...(platformFilter !== "all" ? { platformId: parseInt(platformFilter) } : {}),
  };

  const { data: records, isLoading } = useListAllBillingRecords(params);
  const { data: buyingHouses } = useListBuyingHouses();
  const { data: clients } = useListClients();
  const { data: platforms } = useListPlatforms();

  const deleteMutation = useDeleteBillingRecord({
    mutation: {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getListAllBillingRecordsQueryKey() }); toast({ title: "Record deleted" }); },
      onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
    },
  });

  const computed = (records ?? []).map(r => ({ ...r, ...computeRow(r) }));

  const totals = computed.reduce((acc, r) => ({
    appsflyerPins: acc.appsflyerPins + r.appsflyerPins,
    fraudPins: acc.fraudPins + r.fraudPins,
    actualPins: acc.actualPins + r.actualPins,
    netAmtUsd: acc.netAmtUsd + r.netAmtUsd,
    netAmtPkr: acc.netAmtPkr + r.netAmtPkr,
    grossAmtPkr: acc.grossAmtPkr + r.grossAmtPkr,
    salesTax: acc.salesTax + r.salesTax,
    totalAmtPkr: acc.totalAmtPkr + r.totalAmtPkr,
    bulkDiscountAmt: acc.bulkDiscountAmt + r.bulkDiscountAmt,
    amtAfterDiscount: acc.amtAfterDiscount + r.amtAfterDiscount,
    wht: acc.wht + r.wht,
    receivablePkr: acc.receivablePkr + r.receivablePkr,
    netPayableUsd: acc.netPayableUsd + r.netPayableUsd,
    remittanceTax: acc.remittanceTax + r.remittanceTax,
    totalPayableUsd: acc.totalPayableUsd + r.totalPayableUsd,
    platformDiscountAmt: acc.platformDiscountAmt + r.platformDiscountAmt,
    totalPayablePkr: acc.totalPayablePkr + r.totalPayablePkr,
    netMarginPkr: acc.netMarginPkr + r.netMarginPkr,
  }), {
    appsflyerPins: 0, fraudPins: 0, actualPins: 0, netAmtUsd: 0, netAmtPkr: 0,
    grossAmtPkr: 0, salesTax: 0, totalAmtPkr: 0, bulkDiscountAmt: 0, amtAfterDiscount: 0,
    wht: 0, receivablePkr: 0, netPayableUsd: 0, remittanceTax: 0, totalPayableUsd: 0,
    platformDiscountAmt: 0, totalPayablePkr: 0, netMarginPkr: 0,
  });

  const exportCSV = () => {
    if (!computed.length) return;
    const headers = ["S#","Client","Via (BH)","Platform","Period","AF Pins","Fraud Pins","Actual Pins","Payout Rate","Net Amt (USD)","Forex Sell","Net Amt (PKR)","Gross Amt (PKR)","Sales Tax","Total Amt (PKR)","BH Discount","After Discount","WHT","Receivable (PKR)","Net Payable (USD)","Remittance Tax","Total Payable (USD)","Forex Buy","Platform Discount","Total Payable (PKR)","Net Margin (PKR)","Logged By","Logged At"];
    const rows = computed.map((r, i) => [i+1,r.clientName??"",r.buyingHouseName??"",r.platformName??"",r.period,r.appsflyerPins,r.fraudPins,r.actualPins,r.payoutRate.toFixed(4),r.netAmtUsd.toFixed(2),r.forexSellingRate,r.netAmtPkr.toFixed(2),r.grossAmtPkr.toFixed(2),r.salesTax.toFixed(2),r.totalAmtPkr.toFixed(2),r.bulkDiscountAmt.toFixed(2),r.amtAfterDiscount.toFixed(2),r.wht.toFixed(2),r.receivablePkr.toFixed(2),r.netPayableUsd.toFixed(2),r.remittanceTax.toFixed(2),r.totalPayableUsd.toFixed(2),r.forexBuyingRate,r.platformDiscountAmt.toFixed(2),r.totalPayablePkr.toFixed(2),r.netMarginPkr.toFixed(2),r.createdBy??"",`"${new Date(r.createdAt).toLocaleString()}"`]);
    const csv = [headers,...rows].map(r=>r.join(",")).join("\n");
    const blob = new Blob([csv],{type:"text/csv"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href=url; a.download=`billing-all.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Billing</h1>
          <p className="text-sm text-muted-foreground">{records?.length ?? 0} records</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <Input type="month" className="w-40 text-sm" value={periodFilter} onChange={e => setPeriodFilter(e.target.value)} />
        <Select value={platformFilter} onValueChange={setPlatformFilter}>
          <SelectTrigger className="w-40 text-sm"><SelectValue placeholder="All platforms" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All platforms</SelectItem>
            {platforms?.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={bhFilter} onValueChange={setBhFilter}>
          <SelectTrigger className="w-44 text-sm"><SelectValue placeholder="All buying houses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All buying houses</SelectItem>
            {buyingHouses?.map(bh => <SelectItem key={bh.id} value={String(bh.id)}>{bh.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={clientFilter} onValueChange={setClientFilter}>
          <SelectTrigger className="w-40 text-sm"><SelectValue placeholder="All clients" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All clients</SelectItem>
            {clients?.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={exportCSV}>
            <Download className="h-3.5 w-3.5" /> Export CSV
          </Button>
          {hasPermission("View Billing") && (
            <Button size="sm" className="gap-1.5 text-xs" onClick={() => setAddOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Add Record
            </Button>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-x-auto">
        <table className="w-full min-w-max">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <TH>S#</TH><TH>Client</TH><TH>Via (BH)</TH><TH>Platform</TH><TH>Period</TH>
              <TH>AF Pins</TH><TH>Fraud Pins</TH><TH>Actual Pins</TH>
              <TH>Payout Rate</TH><TH>Net Amt (USD)</TH><TH>Forex Sell</TH><TH>Net Amt (PKR)</TH>
              <TH>Gross Amt (PKR)</TH><TH>Sales Tax</TH><TH>Total Amt (PKR)</TH>
              <TH>BH Discount</TH><TH>After Discount</TH><TH>WHT</TH><TH>Receivable (PKR)</TH>
              <TH>Net Payable (USD)</TH><TH>Remittance Tax</TH><TH>Total Payable (USD)</TH>
              <TH>Forex Buy</TH><TH>Platform Discount</TH><TH>Total Payable (PKR)</TH>
              <TH>Net Margin (PKR)</TH><TH>Logged By</TH><TH>Logged At</TH>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(3)].map((_, i) => (
                <tr key={i} className="border-b border-border">
                  {[...Array(29)].map((_, j) => <td key={j} className="px-3 py-2"><Skeleton className="h-3 w-16" /></td>)}
                </tr>
              ))
            ) : computed.length === 0 ? (
              <tr><td colSpan={29} className="px-5 py-10 text-center text-sm text-muted-foreground">No billing records</td></tr>
            ) : (
              <>
                {computed.map((r, i) => (
                  <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/20">
                    <TD>{i + 1}</TD>
                    <TD bold>{r.clientName ?? "—"}</TD>
                    <TD>{r.buyingHouseName ?? "—"}</TD>
                    <TD>{r.platformName ?? "—"}</TD>
                    <TD bold>{r.period}</TD>
                    <TD>{r.appsflyerPins.toLocaleString()}</TD>
                    <TD>{r.fraudPins.toLocaleString()}</TD>
                    <TD bold>{r.actualPins.toLocaleString()}</TD>
                    <TD>{fmtNum(r.payoutRate, 4)}</TD>
                    <TD>{fmtNum(r.netAmtUsd)}</TD>
                    <TD>{fmtNum(r.forexSellingRate, 4)}</TD>
                    <TD>{fmtNum(r.netAmtPkr)}</TD>
                    <TD>{fmtNum(r.grossAmtPkr)}</TD>
                    <TD>{fmtNum(r.salesTax)}</TD>
                    <TD>{fmtNum(r.totalAmtPkr)}</TD>
                    <TD>{fmtNum(r.bulkDiscountAmt)}</TD>
                    <TD>{fmtNum(r.amtAfterDiscount)}</TD>
                    <TD>{fmtNum(r.wht)}</TD>
                    <TD bold className={r.receivablePkr < 0 ? "text-red-600" : ""}>{fmtNum(r.receivablePkr)}</TD>
                    <TD>{fmtNum(r.netPayableUsd)}</TD>
                    <TD>{fmtNum(r.remittanceTax)}</TD>
                    <TD>{fmtNum(r.totalPayableUsd)}</TD>
                    <TD>{fmtNum(r.forexBuyingRate, 4)}</TD>
                    <TD>{fmtNum(r.platformDiscountAmt)}</TD>
                    <TD>{fmtNum(r.totalPayablePkr)}</TD>
                    <TD bold className={r.netMarginPkr < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}>
                      {fmtNum(r.netMarginPkr)}
                    </TD>
                    <TD>{r.createdBy ?? "—"}</TD>
                    <TD>{new Date(r.createdAt).toLocaleDateString()} {new Date(r.createdAt).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</TD>
                  </tr>
                ))}
                <tr className="border-t-2 border-border bg-muted/30">
                  <TD bold></TD><TD bold>Total</TD><TD></TD><TD></TD><TD></TD>
                  <TD bold>{totals.appsflyerPins.toLocaleString()}</TD>
                  <TD bold>{totals.fraudPins.toLocaleString()}</TD>
                  <TD bold>{totals.actualPins.toLocaleString()}</TD>
                  <TD></TD>
                  <TD bold>{fmtNum(totals.netAmtUsd)}</TD><TD></TD>
                  <TD bold>{fmtNum(totals.netAmtPkr)}</TD>
                  <TD bold>{fmtNum(totals.grossAmtPkr)}</TD>
                  <TD bold>{fmtNum(totals.salesTax)}</TD>
                  <TD bold>{fmtNum(totals.totalAmtPkr)}</TD>
                  <TD bold>{fmtNum(totals.bulkDiscountAmt)}</TD>
                  <TD bold>{fmtNum(totals.amtAfterDiscount)}</TD>
                  <TD bold>{fmtNum(totals.wht)}</TD>
                  <TD bold>{fmtNum(totals.receivablePkr)}</TD>
                  <TD bold>{fmtNum(totals.netPayableUsd)}</TD>
                  <TD bold>{fmtNum(totals.remittanceTax)}</TD>
                  <TD bold>{fmtNum(totals.totalPayableUsd)}</TD>
                  <TD></TD>
                  <TD bold>{fmtNum(totals.platformDiscountAmt)}</TD>
                  <TD bold>{fmtNum(totals.totalPayablePkr)}</TD>
                  <TD bold className={totals.netMarginPkr < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}>
                    {fmtNum(totals.netMarginPkr)}
                  </TD>
                  <TD></TD><TD></TD>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>

      <AddRecordDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        platforms={platforms ?? []}
        buyingHouses={buyingHouses ?? []}
        clients={clients ?? []}
        onSuccess={() => qc.invalidateQueries({ queryKey: getListAllBillingRecordsQueryKey() })}
      />
    </div>
  );
}

function AddRecordDialog({ open, onClose, platforms, buyingHouses, clients, onSuccess }: {
  open: boolean; onClose: () => void;
  platforms: Platform[]; buyingHouses: BuyingHouse[];
  clients: Array<{ id: number; name: string; buyingHouseId: number | null }>;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const form = useForm<AddRecordForm>({ resolver: zodResolver(addRecordSchema) });

  const selectedPlatformId = form.watch("platformId");
  const selectedBHId = form.watch("buyingHouseId");
  const selectedPlatform = platforms.find(p => p.id === selectedPlatformId);
  const selectedBH = buyingHouses.find(bh => bh.id === selectedBHId);
  const filteredClients = clients.filter(c => c.buyingHouseId === selectedBHId || !selectedBHId);

  // Pre-fill from buying house when selected
  useEffect(() => {
    if (selectedBH) {
      if (selectedBH.forexSellingRate != null) form.setValue("forexSellingRate", selectedBH.forexSellingRate);
      if (selectedBH.salesTaxPct != null) form.setValue("salesTaxPct", selectedBH.salesTaxPct);
      if (selectedBH.withholdingTaxPct != null) form.setValue("withholdingTaxPct", selectedBH.withholdingTaxPct);
      form.setValue("bulkDiscountPct", selectedBH.bulkDiscountPct ?? 0);
    }
  }, [selectedBHId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pre-fill from platform when selected
  useEffect(() => {
    if (selectedPlatform) {
      if (selectedPlatform.forexBuyingRate != null) form.setValue("forexBuyingRate", selectedPlatform.forexBuyingRate);
      if (selectedPlatform.remittanceTaxPct != null) form.setValue("remittanceTaxPct", selectedPlatform.remittanceTaxPct);
      form.setValue("platformBulkDiscountPct", selectedPlatform.bulkDiscountPct ?? 0);
    }
  }, [selectedPlatformId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pre-fill global forex as fallback when dialog opens
  useEffect(() => {
    if (open) {
      const globalRate = getGlobalForexRate();
      if (!form.getValues("forexSellingRate")) form.setValue("forexSellingRate", globalRate);
      if (!form.getValues("forexBuyingRate")) form.setValue("forexBuyingRate", globalRate);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-fill payout rate + margin from selected cost model
  const selectedCostModelId = form.watch("costModelId");
  const costModels = selectedPlatform?.costModels ?? [];
  useEffect(() => {
    const cm = costModels.find(c => c.id === selectedCostModelId);
    if (cm) { form.setValue("payoutRate", cm.payoutRate); form.setValue("marginPct", cm.marginPct); }
  }, [selectedCostModelId]); // eslint-disable-line react-hooks/exhaustive-deps

  const createMutation = useCreateBillingRecord({
    mutation: {
      onSuccess: () => { onSuccess(); onClose(); form.reset(); toast({ title: "Billing record added" }); },
      onError: () => toast({ title: "Failed to add record", variant: "destructive" }),
    },
  });

  const onSubmit = (data: AddRecordForm) => {
    createMutation.mutate({
      id: data.platformId,
      data: {
        buyingHouseId: data.buyingHouseId,
        clientId: data.clientId ?? null,
        costModelId: data.costModelId,
        period: data.period,
        appsflyerPins: data.appsflyerPins,
        fraudPins: data.fraudPins,
        payoutRate: data.payoutRate,
        marginPct: data.marginPct,
        forexSellingRate: data.forexSellingRate,
        forexBuyingRate: data.forexBuyingRate,
        salesTaxPct: data.salesTaxPct,
        remittanceTaxPct: data.remittanceTaxPct,
        withholdingTaxPct: data.withholdingTaxPct,
        bulkDiscountPct: data.bulkDiscountPct,
        platformBulkDiscountPct: data.platformBulkDiscountPct,
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Add Billing Record</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
            {/* Platform */}
            <FormField control={form.control} name="platformId" render={({ field }) => (
              <FormItem><FormLabel>Platform</FormLabel>
                <Select onValueChange={v => field.onChange(parseInt(v))} value={field.value ? String(field.value) : ""}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Select platform" /></SelectTrigger></FormControl>
                  <SelectContent>{platforms.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}</SelectContent>
                </Select><FormMessage />
              </FormItem>
            )} />
            {/* Cost Model */}
            <FormField control={form.control} name="costModelId" render={({ field }) => (
              <FormItem><FormLabel>Cost Model</FormLabel>
                <Select onValueChange={v => field.onChange(parseInt(v))} value={field.value ? String(field.value) : ""} disabled={!selectedPlatformId}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Select cost model" /></SelectTrigger></FormControl>
                  <SelectContent>{costModels.map(cm => <SelectItem key={cm.id} value={String(cm.id)}>{cm.name} (${cm.payoutRate}/pin · {cm.marginPct}%)</SelectItem>)}</SelectContent>
                </Select><FormMessage />
              </FormItem>
            )} />
            {/* Buying House */}
            <FormField control={form.control} name="buyingHouseId" render={({ field }) => (
              <FormItem><FormLabel>Buying House</FormLabel>
                <Select onValueChange={v => field.onChange(parseInt(v))} value={field.value ? String(field.value) : ""}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Select buying house" /></SelectTrigger></FormControl>
                  <SelectContent>{buyingHouses.map(bh => <SelectItem key={bh.id} value={String(bh.id)}>{bh.name}</SelectItem>)}</SelectContent>
                </Select><FormMessage />
              </FormItem>
            )} />
            {/* Client */}
            <FormField control={form.control} name="clientId" render={({ field }) => (
              <FormItem><FormLabel>Client <span className="text-muted-foreground">(optional)</span></FormLabel>
                <Select onValueChange={v => field.onChange(v === "none" ? null : parseInt(v))} value={field.value != null ? String(field.value) : "none"}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {filteredClients.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select><FormMessage />
              </FormItem>
            )} />
            {/* Period */}
            <FormField control={form.control} name="period" render={({ field }) => (
              <FormItem><FormLabel>Period</FormLabel><FormControl><Input type="month" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            {/* Pins */}
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="appsflyerPins" render={({ field }) => (
                <FormItem><FormLabel>AF Pins</FormLabel><FormControl><Input type="number" min={0} {...field} onChange={e => field.onChange(parseInt(e.target.value)||0)} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="fraudPins" render={({ field }) => (
                <FormItem><FormLabel>Fraud Pins</FormLabel><FormControl><Input type="number" min={0} {...field} onChange={e => field.onChange(parseInt(e.target.value)||0)} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            {/* Rates */}
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="payoutRate" render={({ field }) => (
                <FormItem><FormLabel>Payout Rate (USD/pin)</FormLabel><FormControl><Input type="number" step="0.0001" min={0} {...field} value={field.value??""} onChange={e => field.onChange(parseFloat(e.target.value)||0)} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="marginPct" render={({ field }) => (
                <FormItem><FormLabel>Margin %</FormLabel><FormControl><Input type="number" step="0.01" min={0} max={100} {...field} value={field.value??""} onChange={e => field.onChange(parseFloat(e.target.value)||0)} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            {/* Forex */}
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="forexSellingRate" render={({ field }) => (
                <FormItem><FormLabel>Forex Selling Rate (PKR)</FormLabel><FormControl><Input type="number" step="0.0001" min={0} {...field} value={field.value??""} onChange={e => field.onChange(parseFloat(e.target.value)||0)} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="forexBuyingRate" render={({ field }) => (
                <FormItem><FormLabel>Forex Buying Rate (PKR)</FormLabel><FormControl><Input type="number" step="0.0001" min={0} {...field} value={field.value??""} onChange={e => field.onChange(parseFloat(e.target.value)||0)} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            {/* Tax */}
            <div className="grid grid-cols-3 gap-3">
              <FormField control={form.control} name="salesTaxPct" render={({ field }) => (
                <FormItem><FormLabel>Sales Tax %</FormLabel><FormControl><Input type="number" step="0.01" min={0} {...field} value={field.value??""} onChange={e => field.onChange(parseFloat(e.target.value)||0)} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="remittanceTaxPct" render={({ field }) => (
                <FormItem><FormLabel>Remittance Tax %</FormLabel><FormControl><Input type="number" step="0.01" min={0} {...field} value={field.value??""} onChange={e => field.onChange(parseFloat(e.target.value)||0)} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="withholdingTaxPct" render={({ field }) => (
                <FormItem><FormLabel>WHT %</FormLabel><FormControl><Input type="number" step="0.01" min={0} {...field} value={field.value??""} onChange={e => field.onChange(parseFloat(e.target.value)||0)} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            {/* Discounts */}
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="bulkDiscountPct" render={({ field }) => (
                <FormItem><FormLabel>BH Bulk Discount %</FormLabel><FormControl><Input type="number" step="0.01" min={0} {...field} value={field.value??""} onChange={e => field.onChange(parseFloat(e.target.value)||0)} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="platformBulkDiscountPct" render={({ field }) => (
                <FormItem><FormLabel>Platform Discount %</FormLabel><FormControl><Input type="number" step="0.01" min={0} {...field} value={field.value??""} onChange={e => field.onChange(parseFloat(e.target.value)||0)} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={createMutation.isPending}>{createMutation.isPending ? "Adding..." : "Add Record"}</Button>
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
git add artifacts/adops/src/pages/Billing.tsx
git commit -m "feat(ui): add standalone Billing module with full audit table and Add Record form"
```

---

## Task 13: Platform DataTab (rename TransactionsTab, make read-only, payable view)

**Files:**
- Create: `artifacts/adops/src/pages/PlatformDetail/DataTab.tsx` (replaces TransactionsTab.tsx)
- Delete: `artifacts/adops/src/pages/PlatformDetail/TransactionsTab.tsx`
- Modify: `artifacts/adops/src/pages/PlatformDetail.tsx`
- Modify: `artifacts/adops/src/pages/PlatformDetail/DetailsTab.tsx`

- [ ] **Step 1: Create DataTab.tsx** — Platform payable-focused read-only view

```tsx
import { useState } from "react";
import { Download } from "lucide-react";
import { useListBillingRecords, useListBuyingHouses, useListClients } from "@workspace/api-client-react";
import type { Platform } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { computeRow } from "@/lib/computeRow";
import { cn } from "@/lib/utils";

function fmtNum(n: number | null | undefined, d = 2) {
  if (n == null || isNaN(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}
type TH = { children?: React.ReactNode };
const TH = ({ children }: TH) => <th className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground whitespace-nowrap">{children}</th>;
type TD = { children?: React.ReactNode; bold?: boolean; className?: string };
const TD = ({ children, bold, className }: TD) => <td className={cn("px-3 py-2 text-xs whitespace-nowrap", bold && "font-semibold", className)}>{children}</td>;

export default function PlatformDataTab({ platformId, platform }: { platformId: number; platform: Platform }) {
  const [periodFilter, setPeriodFilter] = useState("");
  const [bhFilter, setBhFilter] = useState("all");
  const [clientFilter, setClientFilter] = useState("all");

  const params = {
    ...(periodFilter ? { period: periodFilter } : {}),
    ...(bhFilter !== "all" ? { buyingHouseId: parseInt(bhFilter) } : {}),
    ...(clientFilter !== "all" ? { clientId: parseInt(clientFilter) } : {}),
  };
  const { data: records, isLoading } = useListBillingRecords(platformId, params);
  const { data: buyingHouses } = useListBuyingHouses();
  const { data: clients } = useListClients();

  const computed = (records ?? []).map(r => ({ ...r, ...computeRow(r) }));

  const totals = computed.reduce((acc, r) => ({
    appsflyerPins: acc.appsflyerPins + r.appsflyerPins,
    fraudPins: acc.fraudPins + r.fraudPins,
    actualPins: acc.actualPins + r.actualPins,
    netPayableUsd: acc.netPayableUsd + r.netPayableUsd,
    remittanceTax: acc.remittanceTax + r.remittanceTax,
    totalPayableUsd: acc.totalPayableUsd + r.totalPayableUsd,
    platformDiscountAmt: acc.platformDiscountAmt + r.platformDiscountAmt,
    totalPayablePkr: acc.totalPayablePkr + r.totalPayablePkr,
  }), { appsflyerPins: 0, fraudPins: 0, actualPins: 0, netPayableUsd: 0, remittanceTax: 0, totalPayableUsd: 0, platformDiscountAmt: 0, totalPayablePkr: 0 });

  const exportCSV = () => {
    if (!computed.length) return;
    const headers = ["S#","Client","Via (BH)","Period","AF Pins","Fraud Pins","Actual Pins","Payout Rate","Net Payable (USD)","Remittance Tax","Total Payable (USD)","Forex Buying Rate","Platform Discount","Total Payable (PKR)"];
    const rows = computed.map((r,i) => [i+1,r.clientName??"",r.buyingHouseName??"",r.period,r.appsflyerPins,r.fraudPins,r.actualPins,r.payoutRate.toFixed(4),r.netPayableUsd.toFixed(2),r.remittanceTax.toFixed(2),r.totalPayableUsd.toFixed(2),r.forexBuyingRate,r.platformDiscountAmt.toFixed(2),r.totalPayablePkr.toFixed(2)]);
    const csv = [headers,...rows].map(r=>r.join(",")).join("\n");
    const blob = new Blob([csv],{type:"text/csv"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href=url; a.download=`data-${platform.name}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input type="month" className="w-40 text-sm" value={periodFilter} onChange={e => setPeriodFilter(e.target.value)} />
        <Select value={bhFilter} onValueChange={setBhFilter}>
          <SelectTrigger className="w-44 text-sm"><SelectValue placeholder="All buying houses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All buying houses</SelectItem>
            {buyingHouses?.map(bh => <SelectItem key={bh.id} value={String(bh.id)}>{bh.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={clientFilter} onValueChange={setClientFilter}>
          <SelectTrigger className="w-40 text-sm"><SelectValue placeholder="All clients" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All clients</SelectItem>
            {clients?.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="ml-auto">
          <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={exportCSV}>
            <Download className="h-3.5 w-3.5" /> Export CSV
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-x-auto">
        <table className="w-full min-w-max">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <TH>S#</TH><TH>Client</TH><TH>Via (BH)</TH><TH>Period</TH>
              <TH>AF Pins</TH><TH>Fraud Pins</TH><TH>Actual Pins</TH><TH>Payout Rate</TH>
              <TH>Net Payable (USD)</TH><TH>Remittance Tax</TH><TH>Total Payable (USD)</TH>
              <TH>Forex Buying Rate</TH><TH>Platform Discount</TH><TH>Total Payable (PKR)</TH>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(3)].map((_,i) => (
                <tr key={i} className="border-b border-border">
                  {[...Array(14)].map((_,j) => <td key={j} className="px-3 py-2"><Skeleton className="h-3 w-16" /></td>)}
                </tr>
              ))
            ) : computed.length === 0 ? (
              <tr><td colSpan={14} className="px-5 py-10 text-center text-sm text-muted-foreground">No data records</td></tr>
            ) : (
              <>
                {computed.map((r, i) => (
                  <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/20">
                    <TD>{i+1}</TD><TD bold>{r.clientName??"—"}</TD><TD>{r.buyingHouseName??"—"}</TD>
                    <TD bold>{r.period}</TD>
                    <TD>{r.appsflyerPins.toLocaleString()}</TD><TD>{r.fraudPins.toLocaleString()}</TD>
                    <TD bold>{r.actualPins.toLocaleString()}</TD>
                    <TD>{fmtNum(r.payoutRate,4)}</TD>
                    <TD>{fmtNum(r.netPayableUsd)}</TD><TD>{fmtNum(r.remittanceTax)}</TD>
                    <TD>{fmtNum(r.totalPayableUsd)}</TD>
                    <TD>{fmtNum(r.forexBuyingRate,4)}</TD>
                    <TD>{fmtNum(r.platformDiscountAmt)}</TD>
                    <TD bold>{fmtNum(r.totalPayablePkr)}</TD>
                  </tr>
                ))}
                <tr className="border-t-2 border-border bg-muted/30">
                  <TD bold></TD><TD bold>Total</TD><TD></TD><TD></TD>
                  <TD bold>{totals.appsflyerPins.toLocaleString()}</TD>
                  <TD bold>{totals.fraudPins.toLocaleString()}</TD>
                  <TD bold>{totals.actualPins.toLocaleString()}</TD>
                  <TD></TD>
                  <TD bold>{fmtNum(totals.netPayableUsd)}</TD>
                  <TD bold>{fmtNum(totals.remittanceTax)}</TD>
                  <TD bold>{fmtNum(totals.totalPayableUsd)}</TD>
                  <TD></TD>
                  <TD bold>{fmtNum(totals.platformDiscountAmt)}</TD>
                  <TD bold>{fmtNum(totals.totalPayablePkr)}</TD>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Delete TransactionsTab.tsx**
```bash
rm "artifacts/adops/src/pages/PlatformDetail/TransactionsTab.tsx"
```

- [ ] **Step 3: Update PlatformDetail.tsx**

Replace the import and tab trigger/content:
```tsx
// Replace:
import PlatformTransactionsTab from "./PlatformDetail/TransactionsTab";
// With:
import PlatformDataTab from "./PlatformDetail/DataTab";

// Replace tab trigger:
<TabsTrigger value="transactions">Transactions</TabsTrigger>
// With:
<TabsTrigger value="data">Data</TabsTrigger>

// Replace tab content:
<TabsContent value="transactions">
  <PlatformTransactionsTab platformId={id} platform={platform} />
</TabsContent>
// With:
<TabsContent value="data">
  <PlatformDataTab platformId={id} platform={platform} />
</TabsContent>
```

Also change `defaultValue="details"` — keep as is.

- [ ] **Step 4: Update DetailsTab.tsx** — read the file, then:
  - Remove `salesTaxPct` and `withholdingTaxPct` form fields from the edit form
  - Add `forexBuyingRate` and `bulkDiscountPct` numeric fields

- [ ] **Step 5: Commit**
```bash
git add artifacts/adops/src/pages/PlatformDetail/
git commit -m "feat(ui): platform tab Transactions→Data (read-only payable view); update edit dialog"
```

---

## Task 14: BuyingHouses — edit dialog new fields + BuyingHouseDetail Data tab

**Files:**
- Modify: `artifacts/adops/src/pages/BuyingHouses.tsx`
- Modify: `artifacts/adops/src/pages/BuyingHouseDetail.tsx`

- [ ] **Step 1: Update BuyingHouses.tsx** — read the file, then:
  - Extend `bhSchema` to include `salesTaxPct`, `withholdingTaxPct`, `forexSellingRate`, `bulkDiscountPct` (all `z.number().nullable().optional()`)
  - Add four numeric `FormField` inputs to `BHDialog` for these fields
  - Pass values through in `onSubmit`

- [ ] **Step 2: Update BuyingHouseDetail.tsx** — add a "Data" section after the client list showing BH-centric receivable data

Import and use `useListBuyingHouseBillingRecords` (already exists). Update the section from a simple clients list to a full data view:

Use `useListAllBillingRecords({ buyingHouseId: id })` (returns the full `BillingRecord` shape needed for `computeRow`) — **not** `useListBuyingHouseBillingRecords`, which returns a different simplified type that lacks the snapshot fields required for `computeRow`.

Agreed columns: **Client | Period | Platform | AF Pins | Fraud Pins | Actual Pins | Gross Amt (PKR) | BH Discount | Receivable (PKR)**

```tsx
import { useListAllBillingRecords } from "@workspace/api-client-react";
import { computeRow } from "@/lib/computeRow";
import { cn } from "@/lib/utils";

// Inside BuyingHouseDetail component, after the existing clients section:

const { data: allRecords, isLoading: recordsLoading } = useListAllBillingRecords({ buyingHouseId: id });
const computed = (allRecords ?? []).map(r => ({ ...r, ...computeRow(r) }));

const bhTotals = computed.reduce((acc, r) => ({
  appsflyerPins: acc.appsflyerPins + r.appsflyerPins,
  fraudPins: acc.fraudPins + r.fraudPins,
  actualPins: acc.actualPins + r.actualPins,
  grossAmtPkr: acc.grossAmtPkr + r.grossAmtPkr,
  bulkDiscountAmt: acc.bulkDiscountAmt + r.bulkDiscountAmt,
  receivablePkr: acc.receivablePkr + r.receivablePkr,
}), { appsflyerPins: 0, fraudPins: 0, actualPins: 0, grossAmtPkr: 0, bulkDiscountAmt: 0, receivablePkr: 0 });
```

JSX to add after the clients card:

```tsx
{/* BH Data — receivable view */}
<div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
  <div className="px-5 py-3 border-b border-border bg-muted/30">
    <h2 className="text-sm font-semibold text-foreground">Data</h2>
    <p className="text-xs text-muted-foreground mt-0.5">Billing records for this buying house</p>
  </div>
  <div className="overflow-x-auto">
    <table className="w-full min-w-max">
      <thead>
        <tr className="border-b border-border bg-muted/20">
          <TH>Client</TH><TH>Period</TH><TH>Platform</TH>
          <TH>AF Pins</TH><TH>Fraud Pins</TH><TH>Actual Pins</TH>
          <TH>Gross Amt (PKR)</TH><TH>BH Discount</TH><TH>Receivable (PKR)</TH>
        </tr>
      </thead>
      <tbody>
        {recordsLoading ? (
          [...Array(3)].map((_, i) => (
            <tr key={i} className="border-b border-border">
              {[...Array(9)].map((_, j) => <td key={j} className="px-3 py-2"><Skeleton className="h-3 w-16" /></td>)}
            </tr>
          ))
        ) : computed.length === 0 ? (
          <tr><td colSpan={9} className="px-5 py-10 text-center text-sm text-muted-foreground">No billing records</td></tr>
        ) : (
          <>
            {computed.map(r => (
              <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/20">
                <TD bold>{r.clientName ?? "—"}</TD>
                <TD bold>{r.period}</TD>
                <TD>{r.platformName ?? "—"}</TD>
                <TD>{r.appsflyerPins.toLocaleString()}</TD>
                <TD>{r.fraudPins.toLocaleString()}</TD>
                <TD bold>{r.actualPins.toLocaleString()}</TD>
                <TD>{fmtNum(r.grossAmtPkr)}</TD>
                <TD>{fmtNum(r.bulkDiscountAmt)}</TD>
                <TD bold className={r.receivablePkr < 0 ? "text-red-600" : ""}>{fmtNum(r.receivablePkr)}</TD>
              </tr>
            ))}
            <tr className="border-t-2 border-border bg-muted/30">
              <TD bold>Total</TD><TD></TD><TD></TD>
              <TD bold>{bhTotals.appsflyerPins.toLocaleString()}</TD>
              <TD bold>{bhTotals.fraudPins.toLocaleString()}</TD>
              <TD bold>{bhTotals.actualPins.toLocaleString()}</TD>
              <TD bold>{fmtNum(bhTotals.grossAmtPkr)}</TD>
              <TD bold>{fmtNum(bhTotals.bulkDiscountAmt)}</TD>
              <TD bold className={bhTotals.receivablePkr < 0 ? "text-red-600" : "text-emerald-600"}>{fmtNum(bhTotals.receivablePkr)}</TD>
            </tr>
          </>
        )}
      </tbody>
    </table>
  </div>
</div>
```

Add `TH`, `TD`, `fmtNum` helpers at the top of `BuyingHouseDetail.tsx` (same pattern as Billing.tsx and DataTab.tsx):

```tsx
function fmtNum(n: number | null | undefined, d = 2) {
  if (n == null || isNaN(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}
const TH = ({ children }: { children?: React.ReactNode }) =>
  <th className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground whitespace-nowrap">{children}</th>;
const TD = ({ children, bold, className }: { children?: React.ReactNode; bold?: boolean; className?: string }) =>
  <td className={cn("px-3 py-2 text-xs whitespace-nowrap", bold && "font-semibold", className)}>{children}</td>;
```

- [ ] **Step 3: Commit**
```bash
git add artifacts/adops/src/pages/BuyingHouses.tsx artifacts/adops/src/pages/BuyingHouseDetail.tsx
git commit -m "feat(ui): BuyingHouse edit dialog new fields; add Data section to BuyingHouseDetail"
```

---

## Task 15: ClientDetail — filter by clientId, rename section

**Files:**
- Modify: `artifacts/adops/src/pages/ClientDetail.tsx`

- [ ] **Step 1: Update the hook call**

Replace `useListBuyingHouseBillingRecords` with `useListAllBillingRecords` filtered by clientId:

```tsx
// Remove:
import { useGetClient, useListBuyingHouseBillingRecords } from "@workspace/api-client-react";
// Add:
import { useGetClient, useListAllBillingRecords } from "@workspace/api-client-react";

// Replace hook call:
const { data: billingRecords, isLoading: recordsLoading } = useListAllBillingRecords(
  client?.id != null ? { clientId: client.id } : {}
);
```

- [ ] **Step 2: Update the table** — rename section header "Billing History" → "Data". Update table columns to match the full `BillingRecord` shape from `useListAllBillingRecords`:

| Period | Via (BH) | Platform | AF Pins | Fraud Pins | Actual Pins | Receivable (PKR) | Net Margin (PKR) |

Compute `receivablePkr` and `netMarginPkr` using `computeRow` imported from `@/lib/computeRow`:
```tsx
import { computeRow } from "@/lib/computeRow";
const computed = (billingRecords ?? []).map(r => ({ ...r, ...computeRow(r) }));
```

- [ ] **Step 3: Remove the `!buyingHouseId` guard** — now filtering by clientId directly, so a client without a buying house can still have billing records (though unlikely).

- [ ] **Step 4: Commit**
```bash
git add artifacts/adops/src/pages/ClientDetail.tsx
git commit -m "feat(ui): ClientDetail Data tab — filter by clientId, show full billing context"
```

---

## Task 16: Final verification

- [ ] **Step 1: TypeScript check**
```bash
cd "e:/Futurama Projects/adops-intelligence-platform"
pnpm run typecheck 2>&1 | tail -15
```
Expected: all packages show `Done`, zero errors.

- [ ] **Step 2: Build api-server**
```bash
cd artifacts/api-server && pnpm run build 2>&1 | tail -5
```
Expected: `Done in Xs`

- [ ] **Step 3: Final commit**
```bash
git add -A
git commit -m "feat: billing restructure complete — dual forex, bulk discounts, Billing module, Data tabs"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] `buying_houses` gains salesTaxPct, withholdingTaxPct, forexSellingRate, bulkDiscountPct — Tasks 1, 2, 7, 14
- [x] `platforms` loses salesTaxPct/withholdingTaxPct, gains forexBuyingRate/bulkDiscountPct — Tasks 1, 2, 8, 13
- [x] `billing_records` gets dual forex, bulk discounts, clientId — Tasks 1, 2, 9
- [x] Updated computeRow formula with dual forex + bulk discounts, applied before WHT — Tasks 5, 6
- [x] Shared computeRow utility on both backend and frontend — Tasks 5, 6
- [x] Standalone Billing module at `/billing` with full audit table and Add Record form — Tasks 10, 11, 12
- [x] Add Record form auto-fills from platform and buying house selections — Task 12
- [x] Platform "Data" tab (read-only, payable view) — Task 13
- [x] Platform DetailsTab updated (remove old tax fields, add new fields) — Task 13
- [x] Buying House edit dialog with new fields — Task 14
- [x] Buying House detail Data section — Task 14
- [x] Client detail uses clientId filter, shows full billing context — Task 15
- [x] "Transactions" → "Billing" in sidebar, auth, seed — Tasks 10, 11

**Type consistency:**
- `ComputeRowInput` in backend uses `string` fields (Drizzle numeric → string), frontend uses `number` ✓
- `computeRow` return type identical between backend and frontend ✓
- `BillingRecord` response shape used consistently across billing.ts, billing-records.ts, and frontend ✓
- `forexSellingRate`/`forexBuyingRate` naming consistent DB → schema → OpenAPI → generated types → routes → frontend ✓
- `useListAllBillingRecords` used in BuyingHouseDetail Data tab (not `useListBuyingHouseBillingRecords`) so full `BillingRecord` shape is available for `computeRow` ✓
- `clientId` filter param added to `GET /billing-records/all` query string in OpenAPI spec ✓
- `clientName` resolved in both `billing.ts` (list-all) and `billing-records.ts` (per-platform) routes ✓

---

## Known Gotchas

### 1. Data migration of existing billing_records
The migration (`Task 1`) sets `forex_selling_rate = forex_buying_rate = forex_rate` for all existing rows. This is intentional — old records had one rate; we snapshot both sides at the same value. The `DEFAULT 0` for `bulk_discount_pct` / `platform_bulk_discount_pct` is correct (no discounts on old records).

### 2. Tax field migration — no data to migrate
`sales_tax_pct` and `withholding_tax_pct` are **dropped from platforms** and added to **buying_houses**. Existing platform rows lose these values. Buying house rows start nullable. The operator must re-enter tax rates for each buying house after migration. There is no automatic mapping because a platform serves multiple buying houses, each potentially with different tax rates.

### 3. `clientId` on new billing_records — not NULL
The add-record form (`Task 12`) requires the user to select a Client before submitting. The API route should validate `clientId` is present (400 if missing). Existing records have `NULL` clientId (allowed by schema) — this is intentional for backward compatibility.

### 4. BuyingHouseDetail imports `useListAllBillingRecords`
**Do NOT use `useListBuyingHouseBillingRecords`** for the Data tab — it returns a different response shape (`BuyingHouseBillingRecord`) that lacks the snapshot fields needed by `computeRow`. Use `useListAllBillingRecords({ buyingHouseId: id })` instead, which returns the full `BillingRecord` array.

### 5. OpenAPI spec — `GET /billing-records/all` new query param
The existing `/billing-records/all` endpoint (Task 9) must add `clientId` as an optional integer query parameter so `useListAllBillingRecords({ clientId })` works for the Client Data tab. Without this, the generated hook won't accept the `clientId` filter.

### 6. DetailsTab.tsx on Platform — read before edit
`PlatformDetail/DetailsTab.tsx` currently renders `salesTaxPct` and `withholdingTaxPct` form fields. In Task 13 Step 4, **read the file first** before editing — the field names may differ from what's expected (check for `sales_tax_pct` vs `salesTaxPct` as form field names).

### 7. `bulk_discount_pct` name collision in migration
Both `buying_houses` and `platforms` tables gain a `bulk_discount_pct` column. The Drizzle schema for `billing_records` needs **two distinct** field names: `bulkDiscountPct` (BH side) and `platformBulkDiscountPct` (platform side), mapping to `bulk_discount_pct` and `platform_bulk_discount_pct` respectively.

### 8. Seed data — new fields
`seed.ts` (Task 11) should assign realistic values to buying houses and platforms created in seed:
- Buying houses: `salesTaxPct: 17`, `withholdingTaxPct: 10`, `forexSellingRate: 280.0`
- Platforms: `forexBuyingRate: 279.2`, `remittanceTaxPct: 5`
- Bulk discounts: leave null in seed (most real records won't have them)

---

## Execution Dependency Order

Tasks must run in this order — each depends on the previous layer:

```
Task 1  (migration SQL + apply)
  └─ Task 2  (Drizzle schemas)
       └─ Task 3  (OpenAPI spec)
            └─ Task 4  (codegen — generates api-zod + api-client-react)
                 ├─ Task 5  (backend computeRow)
                 │    ├─ Task 7  (buying-houses route)
                 │    ├─ Task 8  (platforms route)
                 │    └─ Task 9  (billing-records route)
                 │         └─ Task 6  (frontend computeRow — can run parallel with 7/8/9)
                 │              ├─ Task 10 (sidebar + App.tsx)
                 │              ├─ Task 11 (seed.ts)
                 │              ├─ Task 12 (Billing.tsx + AddRecord form)
                 │              ├─ Task 13 (Platform DataTab)
                 │              ├─ Task 14 (BuyingHouseDetail + BuyingHouses edit)
                 │              └─ Task 15 (ClientDetail Data tab)
                 └─ Task 16 (final typecheck + build)
```

Tasks 7, 8, 9 can run in parallel after Task 5. Tasks 10–15 can run in parallel after Task 6.

---

## Add-Record Form Field Mapping (reference for Task 12)

When the user selects a **Client**, the form auto-loads the client's linked buying house and pre-fills it. When the user selects a **Buying House**, the form queries the BH object and pre-fills:
- `salesTaxPct` ← `buyingHouse.salesTaxPct ?? 0`
- `withholdingTaxPct` ← `buyingHouse.withholdingTaxPct ?? 0`
- `forexSellingRate` ← `buyingHouse.forexSellingRate ?? globalForexRate`
- `bulkDiscountPct` ← `buyingHouse.bulkDiscountPct ?? 0`

When the user selects a **Platform**, the form queries the platform object and pre-fills:
- `remittanceTaxPct` ← `platform.remittanceTaxPct ?? 0`
- `forexBuyingRate` ← `platform.forexBuyingRate ?? globalForexRate`
- `platformBulkDiscountPct` ← `platform.bulkDiscountPct ?? 0`

All these fields remain **editable** — pre-fill is a convenience, not a lock. The record snapshots whatever values are in the form at submit time.

`globalForexRate` is the fallback from settings (`useGetSettings().data?.forexRate`). If the BH/platform has a specific rate configured, that takes precedence. If neither has one, fall back to global.

