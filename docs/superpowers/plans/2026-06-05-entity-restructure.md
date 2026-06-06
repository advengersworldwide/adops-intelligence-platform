# Entity Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the free-text `buyingHouse` field and misused `clientId` on billing records with a proper `buying_houses` first-class entity, update all layers (DB → OpenAPI → codegen → API routes → frontend), and add Buying Houses to the sidebar with analytics.

**Architecture:** Drizzle schema files are the source of truth for the DB; the manual SQL migration runs first (before schema updates) to migrate existing data safely. OpenAPI spec is the source of truth for types; codegen regenerates Zod schemas and React Query hooks from it. Frontend pages use the generated hooks exclusively.

**Tech Stack:** PostgreSQL + Drizzle ORM, Express, OpenAPI 3.1 + Orval codegen, React + Wouter + TanStack Query, shadcn/ui, Recharts (via shadcn chart)

---

## File Map

| Action | Path |
|---|---|
| Create | `lib/db/src/schema/buying-houses.ts` |
| Create | `lib/db/migrations/0002_entity_restructure.sql` |
| Modify | `lib/db/src/schema/clients.ts` |
| Modify | `lib/db/src/schema/billing-records.ts` |
| Modify | `lib/db/src/schema/index.ts` |
| Modify | `lib/api-spec/openapi.yaml` |
| Generated | `lib/api-zod/src/generated/**` |
| Generated | `lib/api-client-react/src/generated/**` |
| Create | `artifacts/api-server/src/routes/buying-houses.ts` |
| Modify | `artifacts/api-server/src/routes/clients.ts` |
| Modify | `artifacts/api-server/src/routes/billing-records.ts` |
| Modify | `artifacts/api-server/src/routes/index.ts` |
| Modify | `artifacts/api-server/src/lib/seed.ts` |
| Modify | `artifacts/adops/src/lib/auth.ts` |
| Modify | `artifacts/adops/src/components/layout/Sidebar.tsx` |
| Modify | `artifacts/adops/src/App.tsx` |
| Create | `artifacts/adops/src/pages/BuyingHouses.tsx` |
| Create | `artifacts/adops/src/pages/BuyingHouseDetail.tsx` |
| Modify | `artifacts/adops/src/pages/Clients.tsx` |
| Create | `artifacts/adops/src/pages/ClientDetail.tsx` |
| Modify | `artifacts/adops/src/pages/PlatformDetail/TransactionsTab.tsx` |

---

## Task 1: DB Schema — buying_houses table + export

**Files:**
- Create: `lib/db/src/schema/buying-houses.ts`
- Modify: `lib/db/src/schema/index.ts`

- [ ] **Step 1: Create buying-houses.ts schema**

```typescript
// lib/db/src/schema/buying-houses.ts
import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";

export const buyingHousesTable = pgTable("buying_houses", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BuyingHouse = typeof buyingHousesTable.$inferSelect;
```

- [ ] **Step 2: Add export to index.ts**

In `lib/db/src/schema/index.ts`, add the export as the first line:
```typescript
export * from "./buying-houses";
export * from "./clients";
export * from "./platforms";
export * from "./campaigns";
export * from "./transactions";
export * from "./auth";
export * from "./platform-cost-models";
export * from "./billing-records";
```

- [ ] **Step 3: Commit**
```bash
git add lib/db/src/schema/buying-houses.ts lib/db/src/schema/index.ts
git commit -m "feat(db): add buying_houses schema"
```

---

## Task 2: Migration SQL — write and apply

**Files:**
- Create: `lib/db/migrations/0002_entity_restructure.sql`

> **Important:** Run this SQL migration BEFORE updating the Drizzle schema files. It migrates data from `billing_records.client_id` to `buying_house_id` before dropping the old column. Running `drizzle-kit push` first would drop `client_id` and lose the mapping.

- [ ] **Step 1: Write the migration SQL file**

```sql
-- lib/db/migrations/0002_entity_restructure.sql
-- Entity restructure: buying_houses becomes first-class entity.
-- billing_records.client_id → buying_house_id.
-- clients.buying_house text removed; clients.buying_house_id FK added.

-- 1. Create buying_houses table
CREATE TABLE IF NOT EXISTS buying_houses (
  id serial PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Populate buying_houses from distinct clients currently referenced in billing_records
INSERT INTO buying_houses (name)
SELECT DISTINCT c.name
FROM clients c
INNER JOIN billing_records br ON br.client_id = c.id;

-- 3. Add buying_house_id to billing_records (nullable for now)
ALTER TABLE billing_records ADD COLUMN buying_house_id integer;

-- 4. Populate billing_records.buying_house_id from the new buying_houses by name match
UPDATE billing_records br
SET buying_house_id = bh.id
FROM clients c
INNER JOIN buying_houses bh ON bh.name = c.name
WHERE br.client_id = c.id;

-- 5. Make buying_house_id NOT NULL and add FK
ALTER TABLE billing_records
  ALTER COLUMN buying_house_id SET NOT NULL,
  ADD CONSTRAINT billing_records_buying_house_id_fkey
    FOREIGN KEY (buying_house_id) REFERENCES buying_houses(id);

-- 6. Drop old client_id column from billing_records
ALTER TABLE billing_records DROP COLUMN client_id;

-- 7. Add buying_house_id (nullable FK) to clients
ALTER TABLE clients
  ADD COLUMN buying_house_id integer
  REFERENCES buying_houses(id) ON DELETE SET NULL;

-- 8. Drop old buying_house text column from clients
ALTER TABLE clients DROP COLUMN buying_house;
```

- [ ] **Step 2: Apply the migration against your database**

Run from the workspace root (requires `psql` in PATH and a valid `DATABASE_URL` in `.env`):
```bash
# Load DATABASE_URL from .env, then run the migration
export $(grep -E '^DATABASE_URL' .env | xargs)
psql "$DATABASE_URL" -f lib/db/migrations/0002_entity_restructure.sql
```

Expected output: `ALTER TABLE`, `CREATE TABLE`, `INSERT 0 N`, `UPDATE N`, `ALTER TABLE` (multiple lines), no errors.

- [ ] **Step 3: Verify in psql**
```sql
-- Run these checks to confirm migration succeeded:
SELECT COUNT(*) FROM buying_houses;              -- should be > 0 if billing records existed
SELECT column_name FROM information_schema.columns WHERE table_name = 'billing_records';  -- should include buying_house_id, NOT client_id
SELECT column_name FROM information_schema.columns WHERE table_name = 'clients';          -- should include buying_house_id, NOT buying_house
```

- [ ] **Step 4: Commit**
```bash
git add lib/db/migrations/0002_entity_restructure.sql
git commit -m "feat(db): migration — buying_houses entity, rename billing_records.client_id"
```

---

## Task 3: DB Schema — update clients.ts and billing-records.ts

**Files:**
- Modify: `lib/db/src/schema/clients.ts`
- Modify: `lib/db/src/schema/billing-records.ts`

- [ ] **Step 1: Update clients.ts**

Replace the entire file:
```typescript
// lib/db/src/schema/clients.ts
import { pgTable, text, serial, timestamp, numeric, pgEnum, integer } from "drizzle-orm/pg-core";
import { buyingHousesTable } from "./buying-houses";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const pricingModelEnum = pgEnum("pricing_model", ["fixed", "percentage"]);

export const clientsTable = pgTable("clients", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  buyingHouseId: integer("buying_house_id")
    .references(() => buyingHousesTable.id, { onDelete: "set null" }),
  pricingModel: pricingModelEnum("pricing_model").notNull().default("fixed"),
  marginValue: numeric("margin_value", { precision: 12, scale: 4 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertClientSchema = createInsertSchema(clientsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertClient = z.infer<typeof insertClientSchema>;
export type Client = typeof clientsTable.$inferSelect;
```

- [ ] **Step 2: Update billing-records.ts**

Replace the entire file:
```typescript
// lib/db/src/schema/billing-records.ts
import { pgTable, serial, integer, text, numeric, timestamp } from "drizzle-orm/pg-core";
import { platformsTable } from "./platforms";
import { buyingHousesTable } from "./buying-houses";
import { platformCostModelsTable } from "./platform-cost-models";

export const billingRecordsTable = pgTable("billing_records", {
  id: serial("id").primaryKey(),
  platformId: integer("platform_id")
    .notNull()
    .references(() => platformsTable.id, { onDelete: "cascade" }),
  buyingHouseId: integer("buying_house_id")
    .notNull()
    .references(() => buyingHousesTable.id),
  costModelId: integer("cost_model_id")
    .notNull()
    .references(() => platformCostModelsTable.id),
  period: text("period").notNull(),
  appsflyerPins: integer("appsflyer_pins").notNull(),
  fraudPins: integer("fraud_pins").notNull(),
  payoutRate: numeric("payout_rate", { precision: 12, scale: 4 }).notNull(),
  marginPct: numeric("margin_pct", { precision: 6, scale: 2 }).notNull(),
  forexRate: numeric("forex_rate", { precision: 10, scale: 4 }).notNull(),
  salesTaxPct: numeric("sales_tax_pct", { precision: 6, scale: 2 }).notNull(),
  remittanceTaxPct: numeric("remittance_tax_pct", { precision: 6, scale: 2 }).notNull(),
  withholdingTaxPct: numeric("withholding_tax_pct", { precision: 6, scale: 2 }).notNull(),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BillingRecord = typeof billingRecordsTable.$inferSelect;
```

- [ ] **Step 3: Verify TypeScript compiles for the db package**
```bash
cd "e:/Futurama Projects/adops-intelligence-platform"
pnpm --filter @workspace/db run typecheck 2>&1 | head -30
```
Expected: no errors (or only pre-existing unrelated errors).

- [ ] **Step 4: Commit**
```bash
git add lib/db/src/schema/clients.ts lib/db/src/schema/billing-records.ts
git commit -m "feat(db): update clients + billing_records schemas for buying_houses FK"
```

---

## Task 4: OpenAPI Spec — full update

**Files:**
- Modify: `lib/api-spec/openapi.yaml`

This is the largest single change. Make all edits below in sequence.

### 4a — Add buying-houses tag

- [ ] **Step 1: Add `buying-houses` tag** in the `tags:` block (after `uploads`):
```yaml
  - name: buying-houses
    description: Buying house management and analytics
```

### 4b — Add buying-houses paths (after the `/analytics/alerts` path, before `components:`)

- [ ] **Step 2: Add all buying-houses paths**
```yaml
  # ── Buying Houses ─────────────────────────────────────────────────────────────
  /buying-houses:
    get:
      operationId: listBuyingHouses
      tags: [buying-houses]
      summary: List all buying houses with aggregate stats
      responses:
        "200":
          description: List of buying houses
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/BuyingHouse"
    post:
      operationId: createBuyingHouse
      tags: [buying-houses]
      summary: Create a buying house
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/BuyingHouseInput"
      responses:
        "201":
          description: Created
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/BuyingHouse"
        "400":
          description: Validation error

  /buying-houses/{id}:
    get:
      operationId: getBuyingHouse
      tags: [buying-houses]
      summary: Get a buying house by ID
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      responses:
        "200":
          description: Buying house
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/BuyingHouse"
        "404":
          description: Not found
    patch:
      operationId: updateBuyingHouse
      tags: [buying-houses]
      summary: Update a buying house name
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
              $ref: "#/components/schemas/BuyingHouseInput"
      responses:
        "200":
          description: Updated
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/BuyingHouse"
        "404":
          description: Not found
    delete:
      operationId: deleteBuyingHouse
      tags: [buying-houses]
      summary: Delete a buying house
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      responses:
        "204":
          description: Deleted
        "404":
          description: Not found

  /buying-houses/{id}/analytics:
    get:
      operationId: getBuyingHouseAnalytics
      tags: [buying-houses]
      summary: KPIs, monthly trend, and client list for a buying house
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      responses:
        "200":
          description: Analytics
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/BuyingHouseAnalytics"
        "404":
          description: Not found

  /buying-houses/{id}/billing-records:
    get:
      operationId: listBuyingHouseBillingRecords
      tags: [buying-houses]
      summary: List computed billing records for a buying house (for client detail page)
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      responses:
        "200":
          description: Billing records
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/BuyingHouseBillingRecord"
        "404":
          description: Not found
```

### 4c — Remove campaign paths

- [ ] **Step 3: Delete the entire campaigns paths block** — remove everything from `# ── Campaigns ──` through the closing of `/campaigns/{id}` delete operation (lines covering `/campaigns`, `/campaigns/{id}` GET/PATCH/DELETE).

### 4d — Update `/platforms/{id}/billing-records` query params

- [ ] **Step 4: In the `listBillingRecords` GET params, rename `clientId` to `buyingHouseId`**

Find:
```yaml
        - name: clientId
          in: query
          schema:
            type: ["integer", "null"]
```
Replace with:
```yaml
        - name: buyingHouseId
          in: query
          schema:
            type: ["integer", "null"]
```

### 4e — Update `Client` schema

- [ ] **Step 5: Replace the `Client` schema block**

Find the `# ── Client ──` section and replace the three schemas (`Client`, `ClientInput`, `ClientUpdate`) with:
```yaml
    # ── Client ──────────────────────────────────────────────────────────────────
    Client:
      type: object
      required: [id, name, pricingModel, createdAt]
      properties:
        id:
          type: integer
        name:
          type: string
        buyingHouseId:
          type: ["integer", "null"]
        buyingHouseName:
          type: ["string", "null"]
        pricingModel:
          type: string
          enum: [fixed, percentage]
        marginValue:
          type: ["number", "null"]
          description: Fixed amount or % margin value
        createdAt:
          type: string

    ClientInput:
      type: object
      required: [name, pricingModel]
      properties:
        name:
          type: string
          minLength: 1
        buyingHouseId:
          type: ["integer", "null"]
        pricingModel:
          type: string
          enum: [fixed, percentage]
        marginValue:
          type: ["number", "null"]

    ClientUpdate:
      type: object
      properties:
        name:
          type: string
          minLength: 1
        buyingHouseId:
          type: ["integer", "null"]
        pricingModel:
          type: string
          enum: [fixed, percentage]
        marginValue:
          type: ["number", "null"]
```

### 4f — Update `BillingRecord` and `BillingRecordInput` schemas

- [ ] **Step 6: Replace `BillingRecord` schema**

Find the `BillingRecord:` schema block and replace it:
```yaml
    BillingRecord:
      type: object
      required: [id, platformId, buyingHouseId, costModelId, period, appsflyerPins, fraudPins, payoutRate, marginPct, forexRate, salesTaxPct, remittanceTaxPct, withholdingTaxPct, createdAt]
      properties:
        id:
          type: integer
        platformId:
          type: integer
        buyingHouseId:
          type: integer
        buyingHouseName:
          type: ["string", "null"]
        costModelId:
          type: integer
        costModelName:
          type: ["string", "null"]
        costModelPayoutRate:
          type: ["number", "null"]
        costModelMarginPct:
          type: ["number", "null"]
        period:
          type: string
        appsflyerPins:
          type: integer
        fraudPins:
          type: integer
        payoutRate:
          type: number
        marginPct:
          type: number
        forexRate:
          type: number
        salesTaxPct:
          type: number
        remittanceTaxPct:
          type: number
        withholdingTaxPct:
          type: number
        createdBy:
          type: ["string", "null"]
        createdAt:
          type: string

    BillingRecordInput:
      type: object
      required: [buyingHouseId, costModelId, period, appsflyerPins, fraudPins, payoutRate, marginPct, forexRate, salesTaxPct, remittanceTaxPct, withholdingTaxPct]
      properties:
        buyingHouseId:
          type: integer
        costModelId:
          type: integer
        period:
          type: string
        appsflyerPins:
          type: integer
        fraudPins:
          type: integer
        payoutRate:
          type: number
        marginPct:
          type: number
        forexRate:
          type: number
        salesTaxPct:
          type: number
        remittanceTaxPct:
          type: number
        withholdingTaxPct:
          type: number
```

### 4g — Add new BuyingHouse schemas (before `# ── Platform ──` in components/schemas)

- [ ] **Step 7: Add BuyingHouse schemas** — insert before the `# ── Platform ──` comment:
```yaml
    # ── BuyingHouse ──────────────────────────────────────────────────────────────
    BuyingHouse:
      type: object
      required: [id, name, clientCount, netMarginPkr, createdAt]
      properties:
        id:
          type: integer
        name:
          type: string
        clientCount:
          type: integer
        netMarginPkr:
          type: number
        createdAt:
          type: string

    BuyingHouseInput:
      type: object
      required: [name]
      properties:
        name:
          type: string
          minLength: 1

    BuyingHouseAnalytics:
      type: object
      required: [totalReceivablePkr, totalPayablePkr, netMarginPkr, marginPct, monthlyTrend, clients]
      properties:
        totalReceivablePkr:
          type: number
        totalPayablePkr:
          type: number
        netMarginPkr:
          type: number
        marginPct:
          type: number
        monthlyTrend:
          type: array
          items:
            $ref: "#/components/schemas/BuyingHouseTrendPoint"
        clients:
          type: array
          items:
            $ref: "#/components/schemas/BuyingHouseClientItem"

    BuyingHouseTrendPoint:
      type: object
      required: [period, receivablePkr, payablePkr, netMarginPkr]
      properties:
        period:
          type: string
        receivablePkr:
          type: number
        payablePkr:
          type: number
        netMarginPkr:
          type: number

    BuyingHouseClientItem:
      type: object
      required: [id, name, pricingModel]
      properties:
        id:
          type: integer
        name:
          type: string
        pricingModel:
          type: string
        marginValue:
          type: ["number", "null"]

    BuyingHouseBillingRecord:
      type: object
      required: [id, period, platformId, appsflyerPins, fraudPins, actualPins, netMarginPkr, createdAt]
      properties:
        id:
          type: integer
        period:
          type: string
        platformId:
          type: integer
        platformName:
          type: ["string", "null"]
        appsflyerPins:
          type: integer
        fraudPins:
          type: integer
        actualPins:
          type: integer
        netMarginPkr:
          type: number
        createdAt:
          type: string
```

- [ ] **Step 8: Commit**
```bash
git add lib/api-spec/openapi.yaml
git commit -m "feat(spec): entity restructure — buying-houses CRUD + analytics; update Client/BillingRecord; remove campaigns"
```

---

## Task 5: Run Codegen

**Files:**
- Auto-generated: `lib/api-zod/src/generated/**`
- Auto-generated: `lib/api-client-react/src/generated/**`

- [ ] **Step 1: Run codegen**
```bash
cd "e:/Futurama Projects/adops-intelligence-platform"
pnpm -w run codegen
```

Expected: Orval outputs new files for buying-houses types and hooks; updates Client/BillingRecord types; removes campaign types.

- [ ] **Step 2: Verify expected hooks exist in generated output**
```bash
grep -n "useListBuyingHouses\|useGetBuyingHouseAnalytics\|useListBuyingHouseBillingRecords\|buyingHouseId" lib/api-client-react/src/generated/api.ts | head -20
```
Expected: all three hook names and `buyingHouseId` appear in output.

- [ ] **Step 3: Verify old names are gone**
```bash
grep -n "buyingHouse[^I]\|clientId\|clientName" lib/api-zod/src/generated/types/billingRecord.ts 2>/dev/null | head -10
```
Expected: no matches (old field names gone from BillingRecord type).

- [ ] **Step 4: Commit**
```bash
git add lib/api-zod/src/generated lib/api-client-react/src/generated
git commit -m "feat(codegen): regenerate types and hooks for entity restructure"
```

---

## Task 6: API Route — buying-houses

**Files:**
- Create: `artifacts/api-server/src/routes/buying-houses.ts`

- [ ] **Step 1: Create the route file**

```typescript
// artifacts/api-server/src/routes/buying-houses.ts
import { Router, type IRouter } from "express";
import { eq, count } from "drizzle-orm";
import { db, buyingHousesTable, billingRecordsTable, clientsTable, platformsTable } from "@workspace/db";
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

function computeNetMargin(r: {
  appsflyerPins: number; fraudPins: number;
  payoutRate: string; marginPct: string; forexRate: string;
  salesTaxPct: string; remittanceTaxPct: string; withholdingTaxPct: string;
}): { receivablePkr: number; totalPayablePkr: number; netMarginPkr: number } {
  const actualPins = r.appsflyerPins - r.fraudPins;
  const payoutRate = Number(r.payoutRate);
  const marginPct = Number(r.marginPct);
  const forexRate = Number(r.forexRate);
  const salesTaxPct = Number(r.salesTaxPct);
  const remittanceTaxPct = Number(r.remittanceTaxPct);
  const withholdingTaxPct = Number(r.withholdingTaxPct);

  const netAmtUsd = actualPins * payoutRate;
  const netAmtPkr = netAmtUsd * forexRate;
  const grossAmtPkr = marginPct > 0 ? netAmtPkr / (1 - marginPct / 100) : netAmtPkr;
  const salesTax = grossAmtPkr * (salesTaxPct / 100);
  const totalAmtPkr = grossAmtPkr + salesTax;
  const receivablePkr = totalAmtPkr - (totalAmtPkr * withholdingTaxPct / 100) - salesTax;
  const netPayableUsd = netAmtUsd * (1 - marginPct / 100);
  const remittanceTax = netPayableUsd * (remittanceTaxPct / 100);
  const totalPayableUsd = netPayableUsd + remittanceTax;
  const totalPayablePkr = totalPayableUsd * forexRate;
  return { receivablePkr, totalPayablePkr, netMarginPkr: receivablePkr - totalPayablePkr };
}

router.get("/buying-houses", async (req, res): Promise<void> => {
  const bhs = await db.select().from(buyingHousesTable).orderBy(buyingHousesTable.createdAt);
  const result = await Promise.all(bhs.map(async (bh) => {
    const [{ clientCount }] = await db
      .select({ clientCount: count() })
      .from(clientsTable)
      .where(eq(clientsTable.buyingHouseId, bh.id));
    const records = await db.select().from(billingRecordsTable)
      .where(eq(billingRecordsTable.buyingHouseId, bh.id));
    const netMarginPkr = records.reduce((sum, r) => sum + computeNetMargin(r).netMarginPkr, 0);
    return { id: bh.id, name: bh.name, clientCount: Number(clientCount), netMarginPkr, createdAt: bh.createdAt.toISOString() };
  }));
  res.json(ListBuyingHousesResponse.parse(result));
});

router.post("/buying-houses", async (req, res): Promise<void> => {
  const parsed = CreateBuyingHouseBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [row] = await db.insert(buyingHousesTable).values({ name: parsed.data.name }).returning();
  res.status(201).json(GetBuyingHouseResponse.parse({ id: row.id, name: row.name, clientCount: 0, netMarginPkr: 0, createdAt: row.createdAt.toISOString() }));
});

router.get("/buying-houses/:id", async (req, res): Promise<void> => {
  const params = GetBuyingHouseParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [bh] = await db.select().from(buyingHousesTable).where(eq(buyingHousesTable.id, params.data.id));
  if (!bh) { res.status(404).json({ error: "Buying house not found" }); return; }
  const [{ clientCount }] = await db
    .select({ clientCount: count() })
    .from(clientsTable)
    .where(eq(clientsTable.buyingHouseId, bh.id));
  const records = await db.select().from(billingRecordsTable)
    .where(eq(billingRecordsTable.buyingHouseId, bh.id));
  const netMarginPkr = records.reduce((sum, r) => sum + computeNetMargin(r).netMarginPkr, 0);
  res.json(GetBuyingHouseResponse.parse({ id: bh.id, name: bh.name, clientCount: Number(clientCount), netMarginPkr, createdAt: bh.createdAt.toISOString() }));
});

router.patch("/buying-houses/:id", async (req, res): Promise<void> => {
  const params = UpdateBuyingHouseParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = CreateBuyingHouseBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [row] = await db.update(buyingHousesTable).set({ name: parsed.data.name })
    .where(eq(buyingHousesTable.id, params.data.id)).returning();
  if (!row) { res.status(404).json({ error: "Buying house not found" }); return; }
  const [{ clientCount }] = await db
    .select({ clientCount: count() })
    .from(clientsTable)
    .where(eq(clientsTable.buyingHouseId, row.id));
  const records = await db.select().from(billingRecordsTable)
    .where(eq(billingRecordsTable.buyingHouseId, row.id));
  const netMarginPkr = records.reduce((sum, r) => sum + computeNetMargin(r).netMarginPkr, 0);
  res.json(GetBuyingHouseResponse.parse({ id: row.id, name: row.name, clientCount: Number(clientCount), netMarginPkr, createdAt: row.createdAt.toISOString() }));
});

router.delete("/buying-houses/:id", async (req, res): Promise<void> => {
  const params = DeleteBuyingHouseParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [row] = await db.delete(buyingHousesTable)
    .where(eq(buyingHousesTable.id, params.data.id)).returning();
  if (!row) { res.status(404).json({ error: "Buying house not found" }); return; }
  res.sendStatus(204);
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
    const { receivablePkr, totalPayablePkr: payablePkr, netMarginPkr } = computeNetMargin(r);
    totalReceivablePkr += receivablePkr;
    totalPayablePkr += payablePkr;
    const prev = periodMap.get(r.period) ?? { receivablePkr: 0, payablePkr: 0, netMarginPkr: 0 };
    periodMap.set(r.period, {
      receivablePkr: prev.receivablePkr + receivablePkr,
      payablePkr: prev.payablePkr + payablePkr,
      netMarginPkr: prev.netMarginPkr + netMarginPkr,
    });
  }

  const netMarginPkr = totalReceivablePkr - totalPayablePkr;
  const marginPct = totalReceivablePkr > 0 ? (netMarginPkr / totalReceivablePkr) * 100 : 0;
  const monthlyTrend = Array.from(periodMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, vals]) => ({ period, ...vals }));

  const clientRows = await db.select({
    id: clientsTable.id,
    name: clientsTable.name,
    pricingModel: clientsTable.pricingModel,
    marginValue: clientsTable.marginValue,
  }).from(clientsTable).where(eq(clientsTable.buyingHouseId, params.data.id));

  const clients = clientRows.map(c => ({
    id: c.id,
    name: c.name,
    pricingModel: c.pricingModel,
    marginValue: c.marginValue !== null ? parseFloat(c.marginValue) : null,
  }));

  res.json(GetBuyingHouseAnalyticsResponse.parse({ totalReceivablePkr, totalPayablePkr, netMarginPkr, marginPct, monthlyTrend, clients }));
});

router.get("/buying-houses/:id/billing-records", async (req, res): Promise<void> => {
  const params = ListBuyingHouseBillingRecordsParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [bh] = await db.select().from(buyingHousesTable).where(eq(buyingHousesTable.id, params.data.id));
  if (!bh) { res.status(404).json({ error: "Buying house not found" }); return; }

  const rows = await db
    .select({
      id: billingRecordsTable.id,
      period: billingRecordsTable.period,
      platformId: billingRecordsTable.platformId,
      appsflyerPins: billingRecordsTable.appsflyerPins,
      fraudPins: billingRecordsTable.fraudPins,
      payoutRate: billingRecordsTable.payoutRate,
      marginPct: billingRecordsTable.marginPct,
      forexRate: billingRecordsTable.forexRate,
      salesTaxPct: billingRecordsTable.salesTaxPct,
      remittanceTaxPct: billingRecordsTable.remittanceTaxPct,
      withholdingTaxPct: billingRecordsTable.withholdingTaxPct,
      createdAt: billingRecordsTable.createdAt,
      platformName: platformsTable.name,
    })
    .from(billingRecordsTable)
    .leftJoin(platformsTable, eq(billingRecordsTable.platformId, platformsTable.id))
    .where(eq(billingRecordsTable.buyingHouseId, params.data.id))
    .orderBy(billingRecordsTable.period);

  const mapped = rows.map(r => ({
    id: r.id,
    period: r.period,
    platformId: r.platformId,
    platformName: r.platformName ?? null,
    appsflyerPins: r.appsflyerPins,
    fraudPins: r.fraudPins,
    actualPins: r.appsflyerPins - r.fraudPins,
    netMarginPkr: computeNetMargin(r).netMarginPkr,
    createdAt: r.createdAt.toISOString(),
  }));

  res.json(ListBuyingHouseBillingRecordsResponse.parse(mapped));
});

export default router;
```

- [ ] **Step 2: Commit**
```bash
git add artifacts/api-server/src/routes/buying-houses.ts
git commit -m "feat(api): buying-houses CRUD + analytics + billing-records endpoints"
```

---

## Task 7: API Route — update clients.ts

**Files:**
- Modify: `artifacts/api-server/src/routes/clients.ts`

- [ ] **Step 1: Replace the entire file**

```typescript
// artifacts/api-server/src/routes/clients.ts
import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, clientsTable, buyingHousesTable } from "@workspace/db";
import {
  CreateClientBody,
  UpdateClientBody,
  UpdateClientParams,
  GetClientParams,
  DeleteClientParams,
  ListClientsResponse,
  GetClientResponse,
  UpdateClientResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function mapRow(r: typeof clientsTable.$inferSelect) {
  let buyingHouseName: string | null = null;
  if (r.buyingHouseId !== null && r.buyingHouseId !== undefined) {
    const [bh] = await db.select({ name: buyingHousesTable.name })
      .from(buyingHousesTable)
      .where(eq(buyingHousesTable.id, r.buyingHouseId));
    buyingHouseName = bh?.name ?? null;
  }
  return {
    id: r.id,
    name: r.name,
    buyingHouseId: r.buyingHouseId ?? null,
    buyingHouseName,
    pricingModel: r.pricingModel,
    marginValue: r.marginValue !== null ? parseFloat(r.marginValue) : null,
    createdAt: r.createdAt.toISOString(),
  };
}

router.get("/clients", async (req, res): Promise<void> => {
  const rows = await db.select().from(clientsTable).orderBy(clientsTable.createdAt);
  const mapped = await Promise.all(rows.map(mapRow));
  res.json(ListClientsResponse.parse(mapped));
});

router.post("/clients", async (req, res): Promise<void> => {
  const parsed = CreateClientBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [row] = await db.insert(clientsTable).values({
    name: parsed.data.name,
    buyingHouseId: parsed.data.buyingHouseId ?? null,
    pricingModel: parsed.data.pricingModel as "fixed" | "percentage",
    marginValue: parsed.data.marginValue !== null && parsed.data.marginValue !== undefined
      ? String(parsed.data.marginValue) : null,
  }).returning();
  res.status(201).json(GetClientResponse.parse(await mapRow(row)));
});

router.get("/clients/:id", async (req, res): Promise<void> => {
  const params = GetClientParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [row] = await db.select().from(clientsTable).where(eq(clientsTable.id, params.data.id));
  if (!row) { res.status(404).json({ error: "Client not found" }); return; }
  res.json(GetClientResponse.parse(await mapRow(row)));
});

router.patch("/clients/:id", async (req, res): Promise<void> => {
  const params = UpdateClientParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateClientBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const updates: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.buyingHouseId !== undefined) updates.buyingHouseId = parsed.data.buyingHouseId;
  if (parsed.data.pricingModel !== undefined) updates.pricingModel = parsed.data.pricingModel;
  if (parsed.data.marginValue !== undefined) updates.marginValue = parsed.data.marginValue !== null ? String(parsed.data.marginValue) : null;
  const [row] = await db.update(clientsTable).set(updates).where(eq(clientsTable.id, params.data.id)).returning();
  if (!row) { res.status(404).json({ error: "Client not found" }); return; }
  res.json(UpdateClientResponse.parse(await mapRow(row)));
});

router.delete("/clients/:id", async (req, res): Promise<void> => {
  const params = DeleteClientParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [row] = await db.delete(clientsTable).where(eq(clientsTable.id, params.data.id)).returning();
  if (!row) { res.status(404).json({ error: "Client not found" }); return; }
  res.sendStatus(204);
});

export default router;
```

- [ ] **Step 2: Commit**
```bash
git add artifacts/api-server/src/routes/clients.ts
git commit -m "feat(api): update clients route — buyingHouseId FK, join buyingHouseName"
```

---

## Task 8: API Route — update billing-records.ts

**Files:**
- Modify: `artifacts/api-server/src/routes/billing-records.ts`

- [ ] **Step 1: Replace the entire file**

```typescript
// artifacts/api-server/src/routes/billing-records.ts
import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, billingRecordsTable, buyingHousesTable, platformCostModelsTable } from "@workspace/db";
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
  return {
    id: r.id,
    platformId: r.platformId,
    buyingHouseId: r.buyingHouseId,
    buyingHouseName: bh?.name ?? null,
    costModelId: r.costModelId,
    costModelName: cm?.name ?? null,
    costModelPayoutRate: cm ? Number(cm.payoutRate) : null,
    costModelMarginPct: cm ? Number(cm.marginPct) : null,
    period: r.period,
    appsflyerPins: r.appsflyerPins,
    fraudPins: r.fraudPins,
    payoutRate: Number(r.payoutRate),
    marginPct: Number(r.marginPct),
    forexRate: Number(r.forexRate),
    salesTaxPct: Number(r.salesTaxPct),
    remittanceTaxPct: Number(r.remittanceTaxPct),
    withholdingTaxPct: Number(r.withholdingTaxPct),
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
      costModelId: parsed.data.costModelId,
      period: parsed.data.period,
      appsflyerPins: parsed.data.appsflyerPins,
      fraudPins: parsed.data.fraudPins,
      payoutRate: String(parsed.data.payoutRate),
      marginPct: String(parsed.data.marginPct),
      forexRate: String(parsed.data.forexRate),
      salesTaxPct: String(parsed.data.salesTaxPct),
      remittanceTaxPct: String(parsed.data.remittanceTaxPct),
      withholdingTaxPct: String(parsed.data.withholdingTaxPct),
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
git commit -m "feat(api): billing-records — clientId → buyingHouseId throughout"
```

---

## Task 9: API — route index + seed

**Files:**
- Modify: `artifacts/api-server/src/routes/index.ts`
- Modify: `artifacts/api-server/src/lib/seed.ts`

- [ ] **Step 1: Update route index — add buying-houses, remove campaigns**

Replace the entire `artifacts/api-server/src/routes/index.ts`:
```typescript
import { Router, type IRouter } from "express";
import healthRouter from "./health";
import clientsRouter from "./clients";
import platformsRouter from "./platforms";
import platformCostModelsRouter from "./platform-cost-models";
import billingRecordsRouter from "./billing-records";
import buyingHousesRouter from "./buying-houses";
import transactionsRouter from "./transactions";
import analyticsRouter from "./analytics";
import uploadRouter from "./upload";
import rolesRouter from "./roles";
import usersRouter from "./users";
import aiRouter from "./ai";

const router: IRouter = Router();

router.use(healthRouter);
router.use(clientsRouter);
router.use(platformsRouter);
router.use(platformCostModelsRouter);
router.use(billingRecordsRouter);
router.use(buyingHousesRouter);
router.use(transactionsRouter);
router.use(analyticsRouter);
router.use(uploadRouter);
router.use(rolesRouter);
router.use(usersRouter);
router.use(aiRouter);

export default router;
```

- [ ] **Step 2: Update seed.ts — add "Edit Buying Houses" and "View Buying Houses" to roles**

Replace `artifacts/api-server/src/lib/seed.ts`:
```typescript
import bcrypt from "bcryptjs";
import { db, rolesTable, usersTable } from "@workspace/db";

const DEFAULT_ROLES = [
  {
    name: "System Admin",
    permissions: [
      "View Dashboard", "View Clients", "Edit Clients",
      "View Platforms", "Edit Platforms",
      "View Buying Houses", "Edit Buying Houses",
      "View Transactions", "Upload Data",
      "View Analytics", "Manage Settings",
    ] as string[],
    isSystem: true,
  },
  {
    name: "Viewer",
    permissions: [
      "View Dashboard", "View Clients", "View Platforms",
      "View Buying Houses",
      "View Transactions", "View Analytics",
    ] as string[],
    isSystem: true,
  },
  {
    name: "Operator",
    permissions: [
      "View Dashboard", "View Clients", "Edit Clients",
      "View Platforms", "Edit Platforms",
      "View Buying Houses", "Edit Buying Houses",
      "View Transactions", "Upload Data",
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
    } else {
      await db.update(rolesTable).set({ permissions: role.permissions })
        .where(require("drizzle-orm").eq(rolesTable.name, role.name));
    }
  }

  const existingAdmin = await db.select().from(usersTable)
    .then(rows => rows.find(u => u.email === "admin@advengers.com"));
  if (!existingAdmin) {
    const adminPassword = process.env["ADMIN_DEFAULT_PASSWORD"];
    if (!adminPassword) {
      console.warn("[seed] ADMIN_DEFAULT_PASSWORD not set — skipping default admin seed");
    } else {
      const hashedPassword = await bcrypt.hash(adminPassword, 12);
      await db.insert(usersTable).values({
        name: "System Admin",
        email: "admin@advengers.com",
        password: hashedPassword,
        role: "System Admin",
        isSystem: true,
      });
    }
  }
}
```

> Note: The seed now also UPDATEs existing system roles to add the new permissions, so re-running on a live DB adds the new permission strings to existing roles.

- [ ] **Step 3: Fix the inline require in seed.ts** — the `require("drizzle-orm").eq` is ugly; replace with a proper import. Update the top of seed.ts to add:
```typescript
import { eq } from "drizzle-orm";
```
And replace `require("drizzle-orm").eq(rolesTable.name, role.name)` with `eq(rolesTable.name, role.name)`.

- [ ] **Step 4: Commit**
```bash
git add artifacts/api-server/src/routes/index.ts artifacts/api-server/src/lib/seed.ts
git commit -m "feat(api): wire buying-houses router; add View/Edit Buying Houses permissions to seed"
```

---

## Task 10: Frontend — auth.ts + Sidebar + App.tsx

**Files:**
- Modify: `artifacts/adops/src/lib/auth.ts`
- Modify: `artifacts/adops/src/components/layout/Sidebar.tsx`
- Modify: `artifacts/adops/src/App.tsx`

- [ ] **Step 1: Add new permissions to auth.ts**

In `artifacts/adops/src/lib/auth.ts`, replace the `ALL_PERMISSIONS` array:
```typescript
export const ALL_PERMISSIONS = [
  "View Dashboard",
  "View Clients",
  "Edit Clients",
  "View Platforms",
  "Edit Platforms",
  "View Buying Houses",
  "Edit Buying Houses",
  "View Transactions",
  "Upload Data",
  "View Analytics",
  "Manage Settings",
];
```

- [ ] **Step 2: Update Sidebar.tsx**

Replace the `navItems` array in `artifacts/adops/src/components/layout/Sidebar.tsx`:
```typescript
import {
  LayoutDashboard,
  Users,
  Monitor,
  Building2,
  ArrowLeftRight,
  Upload,
  BarChart3,
  Settings,
  ChevronLeft,
  ChevronRight,
  Zap,
  LogOut,
} from "lucide-react";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, permission: "View Dashboard" },
  { href: "/clients", label: "Clients", icon: Users, permission: "View Clients" },
  { href: "/buying-houses", label: "Buying Houses", icon: Building2, permission: "View Buying Houses" },
  { href: "/platforms", label: "Platforms", icon: Monitor, permission: "View Platforms" },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRight, permission: "View Transactions" },
  { href: "/upload", label: "Upload Data", icon: Upload, permission: "Upload Data" },
  { href: "/analytics", label: "Analytics", icon: BarChart3, permission: "View Analytics" },
  { href: "/settings", label: "Settings", icon: Settings, permission: "Manage Settings" },
];
```

Note: `Megaphone` import is removed (was for Campaigns); `Building2` is added for Buying Houses.

- [ ] **Step 3: Update App.tsx — add new routes, remove campaigns route**

In `artifacts/adops/src/App.tsx`:

Add imports at the top:
```typescript
import BuyingHousesPage from "@/pages/BuyingHouses";
import BuyingHouseDetailPage from "@/pages/BuyingHouseDetail";
import ClientDetailPage from "@/pages/ClientDetail";
```

Remove the Campaigns import:
```typescript
// DELETE this line:
import CampaignsPage from "@/pages/Campaigns";
```

Replace the route block — remove the campaigns route and add three new routes. The full `<Switch>` routes section becomes:
```tsx
<Route path="/login"><Redirect to="/" /></Route>
<Route path="/"><PermissionGuard permission="View Dashboard" component={DashboardPage} /></Route>
<Route path="/clients"><PermissionGuard permission="View Clients" component={ClientsPage} /></Route>
<Route path="/clients/:id">
  {(params) => (
    <PermissionGuard permission="View Clients" component={() => <ClientDetailPage id={parseInt(params.id!, 10)} />} />
  )}
</Route>
<Route path="/buying-houses"><PermissionGuard permission="View Buying Houses" component={BuyingHousesPage} /></Route>
<Route path="/buying-houses/:id">
  {(params) => (
    <PermissionGuard permission="View Buying Houses" component={() => <BuyingHouseDetailPage id={parseInt(params.id!, 10)} />} />
  )}
</Route>
<Route path="/platforms"><PermissionGuard permission="View Platforms" component={PlatformsPage} /></Route>
<Route path="/platforms/:id">
  {(params) => (
    <PermissionGuard permission="View Platforms" component={() => <PlatformDetailPage id={parseInt(params.id!, 10)} />} />
  )}
</Route>
<Route path="/transactions"><PermissionGuard permission="View Transactions" component={TransactionsPage} /></Route>
<Route path="/upload"><PermissionGuard permission="Upload Data" component={UploadPage} /></Route>
<Route path="/analytics"><PermissionGuard permission="View Analytics" component={AnalyticsPage} /></Route>
<Route path="/settings"><PermissionGuard permission="Manage Settings" component={SettingsPage} /></Route>
<Route component={NotFound} />
```

- [ ] **Step 4: Commit**
```bash
git add artifacts/adops/src/lib/auth.ts artifacts/adops/src/components/layout/Sidebar.tsx artifacts/adops/src/App.tsx
git commit -m "feat(ui): add Buying Houses to sidebar; add /buying-houses, /clients/:id routes; remove Campaigns"
```

---

## Task 11: Frontend — BuyingHouses.tsx (list page)

**Files:**
- Create: `artifacts/adops/src/pages/BuyingHouses.tsx`

- [ ] **Step 1: Create the file**

```tsx
// artifacts/adops/src/pages/BuyingHouses.tsx
import { useState, useEffect } from "react";
import { Plus, Pencil, Trash2, ChevronRight } from "lucide-react";
import { Link } from "wouter";
import {
  useListBuyingHouses, useCreateBuyingHouse, useUpdateBuyingHouse, useDeleteBuyingHouse,
  getListBuyingHousesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { hasPermission } from "@/lib/auth";

const bhSchema = z.object({ name: z.string().min(1, "Name is required") });
type BHForm = z.infer<typeof bhSchema>;

interface BHRow { id: number; name: string; clientCount: number; netMarginPkr: number; createdAt: string }

function fmtPkr(n: number) {
  return n.toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export default function BuyingHousesPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [editBH, setEditBH] = useState<BHRow | null>(null);
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: buyingHouses, isLoading } = useListBuyingHouses();

  const createMutation = useCreateBuyingHouse({
    mutation: {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getListBuyingHousesQueryKey() }); setCreateOpen(false); toast({ title: "Buying house created" }); },
      onError: () => toast({ title: "Failed to create", variant: "destructive" }),
    },
  });

  const updateMutation = useUpdateBuyingHouse({
    mutation: {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getListBuyingHousesQueryKey() }); setEditBH(null); toast({ title: "Buying house updated" }); },
      onError: () => toast({ title: "Failed to update", variant: "destructive" }),
    },
  });

  const deleteMutation = useDeleteBuyingHouse({
    mutation: {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getListBuyingHousesQueryKey() }); toast({ title: "Buying house deleted" }); },
      onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Buying Houses</h1>
          <p className="text-sm text-muted-foreground">{buyingHouses?.length ?? 0} buying houses total</p>
        </div>
        {hasPermission("Edit Buying Houses") && (
          <Button size="sm" className="gap-1.5 text-xs" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Add Buying House
          </Button>
        )}
      </div>

      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {["Name", "Clients", "Net Margin (PKR)", hasPermission("Edit Buying Houses") ? "Actions" : null].filter((h): h is string => h !== null).map(h => (
                <th key={h} className="px-5 py-3 text-left text-xs font-medium text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(3)].map((_, i) => (
                <tr key={i} className="border-b border-border">
                  {[...Array(4)].map((_, j) => <td key={j} className="px-5 py-3"><Skeleton className="h-4 w-24" /></td>)}
                </tr>
              ))
            ) : !buyingHouses?.length ? (
              <tr><td colSpan={4} className="px-5 py-10 text-center text-sm text-muted-foreground">No buying houses yet</td></tr>
            ) : (
              buyingHouses.map(bh => (
                <tr key={bh.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-5 py-3 text-sm font-medium text-foreground">
                    <Link href={`/buying-houses/${bh.id}`} className="flex items-center gap-1 hover:text-primary">
                      {bh.name} <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-sm text-muted-foreground">{bh.clientCount}</td>
                  <td className="px-5 py-3 text-sm font-medium"
                    style={{ color: bh.netMarginPkr >= 0 ? undefined : "rgb(220 38 38)" }}>
                    PKR {fmtPkr(bh.netMarginPkr)}
                  </td>
                  {hasPermission("Edit Buying Houses") && (
                    <td className="px-5 py-3">
                      <div className="flex gap-1">
                        <button onClick={() => setEditBH(bh as BHRow)}
                          className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => deleteMutation.mutate({ id: bh.id })}
                          className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <BHDialog
        open={createOpen || !!editBH}
        onClose={() => { setCreateOpen(false); setEditBH(null); }}
        defaultValues={editBH ? { name: editBH.name } : undefined}
        onSubmit={(data) => {
          if (editBH) updateMutation.mutate({ id: editBH.id, data });
          else createMutation.mutate({ data });
        }}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
        title={editBH ? "Edit Buying House" : "Add Buying House"}
      />
    </div>
  );
}

function BHDialog({ open, onClose, defaultValues, onSubmit, isSubmitting, title }: {
  open: boolean; onClose: () => void; defaultValues?: BHForm;
  onSubmit: (data: BHForm) => void; isSubmitting: boolean; title: string;
}) {
  const form = useForm<BHForm>({ resolver: zodResolver(bhSchema), defaultValues: defaultValues ?? { name: "" } });
  useEffect(() => { if (open) form.reset(defaultValues ?? { name: "" }); }, [open, defaultValues, form]);
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem>
                <FormLabel>Name</FormLabel>
                <FormControl><Input placeholder="e.g. Starcom, GroupM" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Saving..." : "Save"}</Button>
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
git add artifacts/adops/src/pages/BuyingHouses.tsx
git commit -m "feat(ui): add BuyingHouses list page with CRUD"
```

---

## Task 12: Frontend — BuyingHouseDetail.tsx

**Files:**
- Create: `artifacts/adops/src/pages/BuyingHouseDetail.tsx`

- [ ] **Step 1: Create the file**

```tsx
// artifacts/adops/src/pages/BuyingHouseDetail.tsx
import { Link } from "wouter";
import { ArrowLeft, Building2 } from "lucide-react";
import { useGetBuyingHouse, useGetBuyingHouseAnalytics } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";

function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-bold text-foreground">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

function fmtPkr(n: number) {
  return "PKR " + n.toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export default function BuyingHouseDetailPage({ id }: { id: number }) {
  const { data: bh, isLoading: bhLoading } = useGetBuyingHouse(id);
  const { data: analytics, isLoading: analyticsLoading } = useGetBuyingHouseAnalytics(id);

  if (bhLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
        </div>
      </div>
    );
  }

  if (!bh) return <div className="text-sm text-muted-foreground">Buying house not found.</div>;

  const marginPct = analytics?.marginPct ?? 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/buying-houses">
          <button className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent">
            <ArrowLeft className="h-4 w-4" />
          </button>
        </Link>
        <Building2 className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-xl font-bold text-foreground">{bh.name}</h1>
      </div>

      {/* KPI Cards */}
      {analyticsLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard label="Total Receivable" value={fmtPkr(analytics?.totalReceivablePkr ?? 0)} />
          <KpiCard label="Total Payable" value={fmtPkr(analytics?.totalPayablePkr ?? 0)} />
          <KpiCard
            label="Net Margin"
            value={fmtPkr(analytics?.netMarginPkr ?? 0)}
          />
          <KpiCard
            label="Margin %"
            value={`${marginPct.toFixed(1)}%`}
          />
        </div>
      )}

      {/* Monthly Trend Chart */}
      {analytics && analytics.monthlyTrend.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-foreground mb-4">Monthly Net Margin (PKR)</h2>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={analytics.monthlyTrend}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="period" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => (v / 1000).toFixed(0) + "K"} />
              <Tooltip formatter={(v: number) => fmtPkr(v)} />
              <Area
                type="monotone"
                dataKey="netMarginPkr"
                name="Net Margin"
                stroke="hsl(var(--primary))"
                fill="hsl(var(--primary) / 0.1)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Client List */}
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-muted/30">
          <h2 className="text-sm font-semibold text-foreground">Clients under this buying house</h2>
        </div>
        {analyticsLoading ? (
          <div className="p-5 space-y-2">
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}
          </div>
        ) : !analytics?.clients.length ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">No clients assigned yet</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="px-5 py-2.5 text-left text-xs font-medium text-muted-foreground">Client</th>
                <th className="px-5 py-2.5 text-left text-xs font-medium text-muted-foreground">Pricing Model</th>
                <th className="px-5 py-2.5 text-left text-xs font-medium text-muted-foreground">Margin Value</th>
              </tr>
            </thead>
            <tbody>
              {analytics.clients.map(c => (
                <tr key={c.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <td className="px-5 py-3 text-sm font-medium text-foreground">{c.name}</td>
                  <td className="px-5 py-3">
                    <span className={cn(
                      "rounded-full px-2.5 py-0.5 text-xs font-semibold",
                      c.pricingModel === "fixed"
                        ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                        : "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300"
                    )}>
                      {c.pricingModel}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-sm text-muted-foreground">
                    {c.marginValue != null
                      ? c.pricingModel === "percentage" ? `${c.marginValue}%` : `$${c.marginValue}`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**
```bash
git add artifacts/adops/src/pages/BuyingHouseDetail.tsx
git commit -m "feat(ui): add BuyingHouseDetail analytics page"
```

---

## Task 13: Frontend — update Clients.tsx

**Files:**
- Modify: `artifacts/adops/src/pages/Clients.tsx`

This replaces the free-text `buyingHouse` field with a buying house dropdown and makes the client name a clickable link.

- [ ] **Step 1: Replace the entire file**

```tsx
// artifacts/adops/src/pages/Clients.tsx
import { useState, useEffect } from "react";
import { Plus, Pencil, Trash2, Search, ChevronRight } from "lucide-react";
import { Link } from "wouter";
import {
  useListClients, useCreateClient, useUpdateClient, useDeleteClient,
  getListClientsQueryKey, useListBuyingHouses,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { hasPermission } from "@/lib/auth";

const clientSchema = z.object({
  name: z.string().min(1, "Name is required"),
  buyingHouseId: z.number().nullable().optional(),
  pricingModel: z.enum(["fixed", "percentage"]),
  marginValue: z.coerce.number().optional().nullable(),
});
type ClientForm = z.infer<typeof clientSchema>;

interface ClientRow {
  id: number; name: string;
  buyingHouseId: number | null; buyingHouseName: string | null;
  pricingModel: string; marginValue?: number | null; createdAt: string;
}

export default function ClientsPage() {
  const [search, setSearch] = useState("");
  const [editClient, setEditClient] = useState<ClientRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: clients, isLoading } = useListClients();
  const { data: buyingHouses } = useListBuyingHouses();

  const createMutation = useCreateClient({
    mutation: {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getListClientsQueryKey() }); setCreateOpen(false); toast({ title: "Client created" }); },
      onError: () => toast({ title: "Failed to create client", variant: "destructive" }),
    },
  });

  const updateMutation = useUpdateClient({
    mutation: {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getListClientsQueryKey() }); setEditClient(null); toast({ title: "Client updated" }); },
      onError: () => toast({ title: "Failed to update client", variant: "destructive" }),
    },
  });

  const deleteMutation = useDeleteClient({
    mutation: {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getListClientsQueryKey() }); toast({ title: "Client deleted" }); },
      onError: () => toast({ title: "Failed to delete client", variant: "destructive" }),
    },
  });

  const filtered = clients?.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.buyingHouseName ?? "").toLowerCase().includes(search.toLowerCase())
  ) ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Clients</h1>
          <p className="text-sm text-muted-foreground">{clients?.length ?? 0} clients total</p>
        </div>
        {hasPermission("Edit Clients") && (
          <Button size="sm" className="gap-1.5 text-xs" onClick={() => setCreateOpen(true)} data-testid="create-client-btn">
            <Plus className="h-3.5 w-3.5" /> Add Client
          </Button>
        )}
      </div>

      <div className="relative w-72">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Search clients..." value={search} onChange={e => setSearch(e.target.value)}
          className="pl-9 text-sm" data-testid="client-search" />
      </div>

      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {["Name", "Buying House", "Pricing Model", "Margin Value", "Created", hasPermission("Edit Clients") ? "Actions" : null]
                .filter((h): h is string => h !== null)
                .map(h => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-medium text-muted-foreground">{h}</th>
                ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(4)].map((_, i) => (
                <tr key={i} className="border-b border-border">
                  {[...Array(6)].map((_, j) => <td key={j} className="px-5 py-3"><Skeleton className="h-4 w-24" /></td>)}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} className="px-5 py-10 text-center text-sm text-muted-foreground">No clients found</td></tr>
            ) : (
              filtered.map(c => (
                <tr key={c.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors" data-testid={`client-row-${c.id}`}>
                  <td className="px-5 py-3 text-sm font-medium text-foreground">
                    <Link href={`/clients/${c.id}`} className="flex items-center gap-1 hover:text-primary">
                      {c.name} <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-sm text-muted-foreground">{c.buyingHouseName ?? "—"}</td>
                  <td className="px-5 py-3">
                    <span className={cn(
                      "rounded-full px-2.5 py-0.5 text-xs font-semibold",
                      c.pricingModel === "fixed"
                        ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                        : "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300"
                    )}>
                      {c.pricingModel}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-sm text-muted-foreground">
                    {c.marginValue != null ? (c.pricingModel === "percentage" ? `${c.marginValue}%` : `$${c.marginValue}`) : "—"}
                  </td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">{new Date(c.createdAt).toLocaleDateString()}</td>
                  {hasPermission("Edit Clients") && (
                    <td className="px-5 py-3">
                      <div className="flex gap-1">
                        <button onClick={() => setEditClient(c as ClientRow)}
                          className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                          data-testid={`edit-client-${c.id}`}>
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => deleteMutation.mutate({ id: c.id })}
                          className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          data-testid={`delete-client-${c.id}`}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <ClientDialog
        open={createOpen || !!editClient}
        onClose={() => { setCreateOpen(false); setEditClient(null); }}
        buyingHouses={buyingHouses ?? []}
        defaultValues={editClient ? {
          name: editClient.name,
          buyingHouseId: editClient.buyingHouseId ?? null,
          pricingModel: editClient.pricingModel as "fixed" | "percentage",
          marginValue: editClient.marginValue ?? null,
        } : undefined}
        onSubmit={(data) => {
          if (editClient) updateMutation.mutate({ id: editClient.id, data });
          else createMutation.mutate({ data });
        }}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
        title={editClient ? "Edit Client" : "Add Client"}
      />
    </div>
  );
}

function ClientDialog({ open, onClose, defaultValues, onSubmit, isSubmitting, title, buyingHouses }: {
  open: boolean; onClose: () => void; defaultValues?: ClientForm;
  onSubmit: (data: ClientForm) => void; isSubmitting: boolean; title: string;
  buyingHouses: Array<{ id: number; name: string }>;
}) {
  const form = useForm<ClientForm>({
    resolver: zodResolver(clientSchema),
    defaultValues: defaultValues ?? { name: "", buyingHouseId: null, pricingModel: "fixed", marginValue: null },
  });

  useEffect(() => {
    if (open) form.reset(defaultValues ?? { name: "", buyingHouseId: null, pricingModel: "fixed", marginValue: null });
  }, [open, defaultValues, form]);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem>
                <FormLabel>Name</FormLabel>
                <FormControl><Input placeholder="Client name" {...field} data-testid="client-name-input" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="buyingHouseId" render={({ field }) => (
              <FormItem>
                <FormLabel>Buying House <span className="text-muted-foreground">(optional)</span></FormLabel>
                <Select
                  onValueChange={v => field.onChange(v === "none" ? null : parseInt(v))}
                  value={field.value != null ? String(field.value) : "none"}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Select buying house" /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {buyingHouses.map(bh => <SelectItem key={bh.id} value={String(bh.id)}>{bh.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="pricingModel" render={({ field }) => (
              <FormItem>
                <FormLabel>Pricing Model</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="fixed">Fixed</SelectItem>
                    <SelectItem value="percentage">Percentage</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="marginValue" render={({ field }) => (
              <FormItem>
                <FormLabel>Margin Value</FormLabel>
                <FormControl>
                  <Input type="number" placeholder="e.g. 15" {...field}
                    value={field.value ?? ""}
                    onChange={e => field.onChange(e.target.value === "" ? null : parseFloat(e.target.value))} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={isSubmitting} data-testid="submit-client-btn">
                {isSubmitting ? "Saving..." : "Save"}
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
git add artifacts/adops/src/pages/Clients.tsx
git commit -m "feat(ui): update Clients — buying house dropdown, clickable name link"
```

---

## Task 14: Frontend — ClientDetail.tsx

**Files:**
- Create: `artifacts/adops/src/pages/ClientDetail.tsx`

- [ ] **Step 1: Create the file**

```tsx
// artifacts/adops/src/pages/ClientDetail.tsx
import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { useGetClient, useListBuyingHouseBillingRecords } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

function fmtPkr(n: number) {
  return "PKR " + n.toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export default function ClientDetailPage({ id }: { id: number }) {
  const { data: client, isLoading: clientLoading } = useGetClient(id);

  // Billing records belong to the buying house; fetch when we know the client's buying house
  const buyingHouseId = client?.buyingHouseId ?? null;
  const { data: billingRecords, isLoading: recordsLoading } = useListBuyingHouseBillingRecords(
    buyingHouseId ?? 0,
    { query: { enabled: buyingHouseId !== null } }
  );

  if (clientLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (!client) return <div className="text-sm text-muted-foreground">Client not found.</div>;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/clients">
          <button className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent">
            <ArrowLeft className="h-4 w-4" />
          </button>
        </Link>
        <h1 className="text-xl font-bold text-foreground">{client.name}</h1>
        {client.buyingHouseName && (
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
            {client.buyingHouseName}
          </span>
        )}
      </div>

      {/* Client Info */}
      <div className="rounded-2xl border border-border bg-card shadow-sm p-5 grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <p className="text-xs text-muted-foreground">Name</p>
          <p className="text-sm font-medium mt-0.5">{client.name}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Buying House</p>
          <p className="text-sm font-medium mt-0.5">{client.buyingHouseName ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Pricing Model</p>
          <span className={cn(
            "inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold mt-0.5",
            client.pricingModel === "fixed"
              ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
              : "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300"
          )}>
            {client.pricingModel}
          </span>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Margin Value</p>
          <p className="text-sm font-medium mt-0.5">
            {client.marginValue != null
              ? client.pricingModel === "percentage" ? `${client.marginValue}%` : `$${client.marginValue}`
              : "—"}
          </p>
        </div>
      </div>

      {/* Billing History */}
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-muted/30">
          <h2 className="text-sm font-semibold text-foreground">Billing History</h2>
          {client.buyingHouseName && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Records for buying house: {client.buyingHouseName}
            </p>
          )}
        </div>
        {!buyingHouseId ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">
            No buying house assigned — no billing history available.
          </p>
        ) : recordsLoading ? (
          <div className="p-5 space-y-2">
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}
          </div>
        ) : !billingRecords?.length ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">No billing records yet.</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="px-5 py-2.5 text-left text-xs font-medium text-muted-foreground">Period</th>
                <th className="px-5 py-2.5 text-left text-xs font-medium text-muted-foreground">Platform</th>
                <th className="px-5 py-2.5 text-left text-xs font-medium text-muted-foreground">Actual Pins</th>
                <th className="px-5 py-2.5 text-left text-xs font-medium text-muted-foreground">Net Margin (PKR)</th>
              </tr>
            </thead>
            <tbody>
              {billingRecords.map(r => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <td className="px-5 py-3 text-sm font-medium">{r.period}</td>
                  <td className="px-5 py-3 text-sm text-muted-foreground">{r.platformName ?? "—"}</td>
                  <td className="px-5 py-3 text-sm">{r.actualPins.toLocaleString()}</td>
                  <td className={cn(
                    "px-5 py-3 text-sm font-medium",
                    r.netMarginPkr < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"
                  )}>
                    {fmtPkr(r.netMarginPkr)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**
```bash
git add artifacts/adops/src/pages/ClientDetail.tsx
git commit -m "feat(ui): add ClientDetail read-only page with billing history"
```

---

## Task 15: Frontend — update TransactionsTab.tsx

**Files:**
- Modify: `artifacts/adops/src/pages/PlatformDetail/TransactionsTab.tsx`

This updates the "Billing Entity" → "Buying House" label, replaces the client filter with a buying house filter, and updates the Add Record dialog to select from buying houses.

- [ ] **Step 1: Replace the imports and filter state at the top of the component**

Find and replace the import line:
```typescript
// OLD:
import {
  useListBillingRecords, useCreateBillingRecord, useDeleteBillingRecord,
  getListBillingRecordsQueryKey, useListClients,
} from "@workspace/api-client-react";
```
With:
```typescript
import {
  useListBillingRecords, useCreateBillingRecord, useDeleteBillingRecord,
  getListBillingRecordsQueryKey, useListBuyingHouses,
} from "@workspace/api-client-react";
```

- [ ] **Step 2: Update component state and query params**

In `PlatformTransactionsTab`, replace:
```typescript
const [clientFilter, setClientFilter] = useState("all");
```
With:
```typescript
const [buyingHouseFilter, setBuyingHouseFilter] = useState("all");
```

Replace:
```typescript
const queryParams = {
  ...(periodFilter ? { period: periodFilter } : {}),
  ...(clientFilter !== "all" ? { clientId: parseInt(clientFilter) } : {}),
};
const { data: records, isLoading } = useListBillingRecords(platformId, queryParams);
const { data: clients } = useListClients();
```
With:
```typescript
const queryParams = {
  ...(periodFilter ? { period: periodFilter } : {}),
  ...(buyingHouseFilter !== "all" ? { buyingHouseId: parseInt(buyingHouseFilter) } : {}),
};
const { data: records, isLoading } = useListBillingRecords(platformId, queryParams);
const { data: buyingHouses } = useListBuyingHouses();
```

- [ ] **Step 3: Update the filter UI and table header label**

Replace the client filter `<Select>` in the toolbar:
```tsx
// OLD:
<Select value={clientFilter} onValueChange={setClientFilter}>
  <SelectTrigger className="w-40 text-sm"><SelectValue placeholder="All clients" /></SelectTrigger>
  <SelectContent>
    <SelectItem value="all">All clients</SelectItem>
    {clients?.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
  </SelectContent>
</Select>
```
With:
```tsx
<Select value={buyingHouseFilter} onValueChange={setBuyingHouseFilter}>
  <SelectTrigger className="w-44 text-sm"><SelectValue placeholder="All buying houses" /></SelectTrigger>
  <SelectContent>
    <SelectItem value="all">All buying houses</SelectItem>
    {buyingHouses?.map(bh => <SelectItem key={bh.id} value={String(bh.id)}>{bh.name}</SelectItem>)}
  </SelectContent>
</Select>
```

Replace the column header `<TH>Billing Entity</TH>` with `<TH>Buying House</TH>`.

Replace the cell `<TD bold>{r.clientName ?? "—"}</TD>` with `<TD bold>{r.buyingHouseName ?? "—"}</TD>`.

- [ ] **Step 4: Update export CSV function**

In the `exportCSV` function, replace:
- Header: `"Billing Entity"` → `"Buying House"`
- Row field: `r.clientName??""` → `r.buyingHouseName??""`

- [ ] **Step 5: Update `AddRecordDialog` — switch client select to buying house select**

In `AddRecordDialog`, replace:
```typescript
// OLD signature includes:
const { data: clients } = useListClients();
```
With:
```typescript
const { data: buyingHouses } = useListBuyingHouses();
```

Replace the `clientId` FormField:
```tsx
// OLD:
<FormField control={form.control} name="clientId" render={({ field }) => (
  <FormItem><FormLabel>Billing Entity</FormLabel>
    <Select onValueChange={v => field.onChange(parseInt(v))} value={field.value ? String(field.value) : ""}>
      <FormControl><SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger></FormControl>
      <SelectContent>
        {clients?.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
      </SelectContent>
    </Select><FormMessage />
  </FormItem>
)} />
```
With:
```tsx
<FormField control={form.control} name="buyingHouseId" render={({ field }) => (
  <FormItem><FormLabel>Buying House</FormLabel>
    <Select onValueChange={v => field.onChange(parseInt(v))} value={field.value ? String(field.value) : ""}>
      <FormControl><SelectTrigger><SelectValue placeholder="Select buying house" /></SelectTrigger></FormControl>
      <SelectContent>
        {buyingHouses?.map(bh => <SelectItem key={bh.id} value={String(bh.id)}>{bh.name}</SelectItem>)}
      </SelectContent>
    </Select><FormMessage />
  </FormItem>
)} />
```

Also update the `addRecordSchema` at the top of the file:
```typescript
// OLD:
clientId: z.number({ required_error: "Client is required" }),
```
```typescript
// NEW:
buyingHouseId: z.number({ required_error: "Buying house is required" }),
```

And in the mutation call:
```typescript
// The form.handleSubmit(data => createMutation.mutate({ id: platformId, data })) stays the same
// but the 'data' object now has buyingHouseId instead of clientId — this matches after the schema change above
```

- [ ] **Step 6: Commit**
```bash
git add artifacts/adops/src/pages/PlatformDetail/TransactionsTab.tsx
git commit -m "feat(ui): TransactionsTab — Billing Entity → Buying House label and filter"
```

---

## Task 16: Final verification

- [ ] **Step 1: TypeScript check across all packages**
```bash
cd "e:/Futurama Projects/adops-intelligence-platform"
pnpm -w run typecheck 2>&1 | head -50
```
Expected: zero TypeScript errors (or only pre-existing unrelated errors). Fix any errors before proceeding.

- [ ] **Step 2: Start the API server and verify buying-houses endpoints**
```bash
# In one terminal, start the API server
pnpm --filter api-server run dev

# In another terminal, test:
curl http://localhost:8080/api/buying-houses
# Expected: JSON array (may be empty or contain migrated records)

curl -X POST http://localhost:8080/api/buying-houses \
  -H "Content-Type: application/json" \
  -d '{"name":"Starcom"}'
# Expected: 201 with { id, name, clientCount: 0, netMarginPkr: 0, createdAt }
```

- [ ] **Step 3: Start the frontend and do a smoke test**
```bash
pnpm --filter adops run dev
```
Verify in browser:
- Sidebar shows "Buying Houses" (not "Campaigns")
- `/buying-houses` page loads and shows the list (with migrated records as buying houses)
- `/buying-houses/:id` detail page loads with KPI cards
- `/clients` page shows "Buying House" column with the dropdown in create/edit dialog
- `/clients/:id` shows the detail page with billing history
- Platform detail → Transactions tab shows "Buying House" column header and dropdown filter

- [ ] **Step 4: Final commit**
```bash
git add .
git commit -m "feat: entity restructure complete — buying houses, client detail, updated billing entity flow"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] `buying_houses` table created — Task 1
- [x] `clients.buying_house` text dropped → `buying_house_id` FK — Tasks 2, 3
- [x] `billing_records.client_id` → `buying_house_id` FK — Tasks 2, 3
- [x] Data migration — Task 2
- [x] Campaigns removed from sidebar (DB kept) — Task 10
- [x] `"Edit Buying Houses"` permission added to seed — Task 9
- [x] Buying Houses CRUD API — Task 6
- [x] Buying Houses analytics API — Task 6
- [x] Buying Houses billing records API — Task 6
- [x] Clients API updated (buyingHouseId join) — Task 7
- [x] Billing records API updated (buyingHouseId) — Task 8
- [x] Sidebar: Buying Houses added, Campaigns removed — Task 10
- [x] `/buying-houses` list page — Task 11
- [x] `/buying-houses/:id` analytics detail page — Task 12
- [x] `/clients` updated (dropdown, clickable link) — Task 13
- [x] `/clients/:id` read-only detail page — Task 14
- [x] TransactionsTab label + filter updated — Task 15

**Type consistency check:**
- `computeNetMargin` in buying-houses.ts accepts `{ payoutRate: string; marginPct: string; ... }` — matches `billingRecordsTable.$inferSelect` shape ✓
- `BuyingHouseAnalytics.clients` items match `BuyingHouseClientItem` schema ✓
- `useListBuyingHouseBillingRecords(id, options)` call in ClientDetail uses `{ query: { enabled: ... } }` — matches Orval's React Query pattern ✓
- `buyingHouseId` in `addRecordSchema` matches `CreateBillingRecordBody` after codegen ✓