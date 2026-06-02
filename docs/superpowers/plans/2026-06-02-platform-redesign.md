# Platform Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat platform CRUD with a rich vendor profile, multi-cost-model configuration, billing records table, and a full platform detail page (Details | Transactions | Analytics).

**Architecture:** DB schema changes via Drizzle push → OpenAPI spec update → orval codegen regenerates Zod + React Query hooks → Express route additions → React frontend (new `/platforms/:id` route with 3 tabs). No test framework exists in this codebase; verification is done by running the dev server.

**Tech Stack:** Drizzle ORM (postgres), drizzle-kit push, orval codegen, Express, Zod, React + wouter + TanStack Query, Tailwind/shadcn

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `lib/db/src/schema/platforms.ts` | Add 16 new nullable columns, remove costModel/currency |
| Create | `lib/db/src/schema/platform-cost-models.ts` | `platform_cost_models` table |
| Create | `lib/db/src/schema/billing-records.ts` | `billing_records` table |
| Modify | `lib/db/src/schema/index.ts` | Export two new schemas |
| Modify | `lib/api-spec/openapi.yaml` | Update Platform schemas; add CostModel + BillingRecord schemas + endpoints |
| Regenerated | `lib/api-zod/src/generated/api.ts` | Zod validation schemas (auto via codegen) |
| Regenerated | `lib/api-client-react/src/generated/api.ts` | React Query hooks (auto via codegen) |
| Regenerated | `lib/api-client-react/src/generated/api.schemas.ts` | TS interfaces (auto via codegen) |
| Modify | `artifacts/api-server/src/routes/platforms.ts` | Update mapRow + CRUD for new fields |
| Create | `artifacts/api-server/src/routes/platform-cost-models.ts` | CRUD for cost models |
| Create | `artifacts/api-server/src/routes/billing-records.ts` | CRUD + list for billing records |
| Modify | `artifacts/api-server/src/routes/index.ts` | Mount two new routers |
| Modify | `artifacts/adops/src/pages/Platforms.tsx` | Update list columns, create dialog, name link |
| Modify | `artifacts/adops/src/App.tsx` | Add `/platforms/:id` route |
| Create | `artifacts/adops/src/pages/PlatformDetail.tsx` | Detail page shell + tab switcher |

---

## Phase 1 — Database

### Task 1: Update platforms schema

**Files:**
- Modify: `lib/db/src/schema/platforms.ts`

- [ ] **Step 1: Replace file content**

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
  paymentTerms: text("payment_terms"),   // "net_30" | "net_60" | "net_90" | "net_120" | "net_150"
  salesTaxPct: numeric("sales_tax_pct", { precision: 6, scale: 2 }),
  remittanceTaxPct: numeric("remittance_tax_pct", { precision: 6, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type Platform = typeof platformsTable.$inferSelect;
```

- [ ] **Step 2: Commit**

```bash
git add lib/db/src/schema/platforms.ts
git commit -m "feat(db): expand platforms table — add vendor profile + tax fields, remove costModel/currency"
```

---

### Task 2: Create platform_cost_models schema

**Files:**
- Create: `lib/db/src/schema/platform-cost-models.ts`

- [ ] **Step 1: Create the file**

```typescript
import { pgTable, serial, integer, text, numeric, timestamp } from "drizzle-orm/pg-core";
import { platformsTable } from "./platforms";

export const platformCostModelsTable = pgTable("platform_cost_models", {
  id: serial("id").primaryKey(),
  platformId: integer("platform_id")
    .notNull()
    .references(() => platformsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  marginPct: numeric("margin_pct", { precision: 6, scale: 2 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PlatformCostModel = typeof platformCostModelsTable.$inferSelect;
```

- [ ] **Step 2: Commit**

```bash
git add lib/db/src/schema/platform-cost-models.ts
git commit -m "feat(db): add platform_cost_models table"
```

---

### Task 3: Create billing_records schema

**Files:**
- Create: `lib/db/src/schema/billing-records.ts`

- [ ] **Step 1: Create the file**

```typescript
import { pgTable, serial, integer, text, numeric, timestamp } from "drizzle-orm/pg-core";
import { platformsTable } from "./platforms";
import { clientsTable } from "./clients";
import { platformCostModelsTable } from "./platform-cost-models";

export const billingRecordsTable = pgTable("billing_records", {
  id: serial("id").primaryKey(),
  platformId: integer("platform_id")
    .notNull()
    .references(() => platformsTable.id, { onDelete: "cascade" }),
  clientId: integer("client_id")
    .notNull()
    .references(() => clientsTable.id),
  costModelId: integer("cost_model_id")
    .notNull()
    .references(() => platformCostModelsTable.id),
  period: text("period").notNull(),         // "YYYY-MM"
  appsflyerPins: integer("appsflyer_pins").notNull(),
  fraudPins: integer("fraud_pins").notNull(),
  payoutRate: numeric("payout_rate", { precision: 12, scale: 4 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BillingRecord = typeof billingRecordsTable.$inferSelect;
```

- [ ] **Step 2: Commit**

```bash
git add lib/db/src/schema/billing-records.ts
git commit -m "feat(db): add billing_records table"
```

---

### Task 4: Export new schemas from DB index

**Files:**
- Modify: `lib/db/src/schema/index.ts`

- [ ] **Step 1: Add two exports**

```typescript
export * from "./clients";
export * from "./platforms";
export * from "./campaigns";
export * from "./transactions";
export * from "./auth";
export * from "./platform-cost-models";
export * from "./billing-records";
```

- [ ] **Step 2: Commit**

```bash
git add lib/db/src/schema/index.ts
git commit -m "feat(db): export platform-cost-models and billing-records schemas"
```

---

### Task 5: Push schema to database

- [ ] **Step 1: Run push (from repo root)**

```bash
pnpm --filter @workspace/db run push
```

Expected: Drizzle prints the SQL alterations (DROP COLUMN for cost_model + currency, ADD COLUMN for each new platform column, CREATE TABLE for platform_cost_models, CREATE TABLE for billing_records) and confirms success. If prompted to confirm destructive changes, type `y`.

- [ ] **Step 2: Commit push confirmation (no file changes needed)**

No files changed by the push command — schema files were already committed in Tasks 1-4.

---

## Phase 2 — OpenAPI Contract

### Task 6: Update openapi.yaml — Platform schemas

**Files:**
- Modify: `lib/api-spec/openapi.yaml`

- [ ] **Step 1: Replace the Platform, PlatformInput, PlatformUpdate schema blocks**

In the `components/schemas` section, replace the three existing Platform schemas with:

```yaml
    # ── Platform ─────────────────────────────────────────────────────────────────
    Platform:
      type: object
      required: [id, name, createdAt]
      properties:
        id:
          type: integer
        name:
          type: string
        address:
          type: ["string", "null"]
        pocName:
          type: ["string", "null"]
        pocNumber:
          type: ["string", "null"]
        pocEmail:
          type: ["string", "null"]
        companyEmail:
          type: ["string", "null"]
        companyNumber:
          type: ["string", "null"]
        bankName:
          type: ["string", "null"]
        bankAccountNumber:
          type: ["string", "null"]
        bankAddress:
          type: ["string", "null"]
        swiftCode:
          type: ["string", "null"]
        iban:
          type: ["string", "null"]
        salesTaxNumber:
          type: ["string", "null"]
        ntnNumber:
          type: ["string", "null"]
        paymentTerms:
          type: ["string", "null"]
          enum: [net_30, net_60, net_90, net_120, net_150, "null"]
        salesTaxPct:
          type: ["number", "null"]
        remittanceTaxPct:
          type: ["number", "null"]
        costModels:
          type: array
          items:
            $ref: "#/components/schemas/PlatformCostModel"
        createdAt:
          type: string

    PlatformInput:
      type: object
      required: [name]
      properties:
        name:
          type: string
          minLength: 1
        address:
          type: ["string", "null"]
        pocName:
          type: ["string", "null"]
        pocNumber:
          type: ["string", "null"]
        pocEmail:
          type: ["string", "null"]
        companyEmail:
          type: ["string", "null"]
        companyNumber:
          type: ["string", "null"]
        paymentTerms:
          type: ["string", "null"]

    PlatformUpdate:
      type: object
      properties:
        name:
          type: string
        address:
          type: ["string", "null"]
        pocName:
          type: ["string", "null"]
        pocNumber:
          type: ["string", "null"]
        pocEmail:
          type: ["string", "null"]
        companyEmail:
          type: ["string", "null"]
        companyNumber:
          type: ["string", "null"]
        bankName:
          type: ["string", "null"]
        bankAccountNumber:
          type: ["string", "null"]
        bankAddress:
          type: ["string", "null"]
        swiftCode:
          type: ["string", "null"]
        iban:
          type: ["string", "null"]
        salesTaxNumber:
          type: ["string", "null"]
        ntnNumber:
          type: ["string", "null"]
        paymentTerms:
          type: ["string", "null"]
        salesTaxPct:
          type: ["number", "null"]
        remittanceTaxPct:
          type: ["number", "null"]

    PlatformCostModel:
      type: object
      required: [id, platformId, name, marginPct, createdAt]
      properties:
        id:
          type: integer
        platformId:
          type: integer
        name:
          type: string
        marginPct:
          type: number
        createdAt:
          type: string

    PlatformCostModelInput:
      type: object
      required: [name, marginPct]
      properties:
        name:
          type: string
          minLength: 1
        marginPct:
          type: number

    PlatformCostModelUpdate:
      type: object
      properties:
        name:
          type: string
        marginPct:
          type: number

    BillingRecord:
      type: object
      required: [id, platformId, clientId, costModelId, period, appsflyerPins, fraudPins, payoutRate, createdAt]
      properties:
        id:
          type: integer
        platformId:
          type: integer
        clientId:
          type: integer
        clientName:
          type: ["string", "null"]
        costModelId:
          type: integer
        costModelName:
          type: ["string", "null"]
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
        createdAt:
          type: string

    BillingRecordInput:
      type: object
      required: [clientId, costModelId, period, appsflyerPins, fraudPins, payoutRate]
      properties:
        clientId:
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
```

- [ ] **Step 2: Commit schema changes**

```bash
git add lib/api-spec/openapi.yaml
git commit -m "feat(spec): update Platform schemas, add PlatformCostModel + BillingRecord schemas"
```

---

### Task 7: Add new endpoints to openapi.yaml

**Files:**
- Modify: `lib/api-spec/openapi.yaml`

- [ ] **Step 1: Add cost-model and billing-record paths**

After the `/platforms/{id}` block and before the `# ── Campaigns` comment, add:

```yaml
  /platforms/{id}/cost-models:
    post:
      operationId: createPlatformCostModel
      tags: [platforms]
      summary: Add a cost model to a platform
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
              $ref: "#/components/schemas/PlatformCostModelInput"
      responses:
        "201":
          description: Created
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/PlatformCostModel"
        "400":
          description: Validation error

  /platforms/{id}/cost-models/{cmId}:
    patch:
      operationId: updatePlatformCostModel
      tags: [platforms]
      summary: Update a cost model
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
        - name: cmId
          in: path
          required: true
          schema:
            type: integer
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/PlatformCostModelUpdate"
      responses:
        "200":
          description: Updated
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/PlatformCostModel"
        "404":
          description: Not found
    delete:
      operationId: deletePlatformCostModel
      tags: [platforms]
      summary: Delete a cost model
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
        - name: cmId
          in: path
          required: true
          schema:
            type: integer
      responses:
        "204":
          description: Deleted
        "404":
          description: Not found

  /platforms/{id}/billing-records:
    get:
      operationId: listBillingRecords
      tags: [platforms]
      summary: List billing records for a platform
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
        - name: period
          in: query
          schema:
            type: ["string", "null"]
        - name: clientId
          in: query
          schema:
            type: ["integer", "null"]
      responses:
        "200":
          description: List of billing records
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/BillingRecord"
    post:
      operationId: createBillingRecord
      tags: [platforms]
      summary: Add a billing record
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
              $ref: "#/components/schemas/BillingRecordInput"
      responses:
        "201":
          description: Created
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/BillingRecord"
        "400":
          description: Validation error

  /platforms/{id}/billing-records/{recordId}:
    delete:
      operationId: deleteBillingRecord
      tags: [platforms]
      summary: Delete a billing record
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
      responses:
        "204":
          description: Deleted
        "404":
          description: Not found
```

- [ ] **Step 2: Commit**

```bash
git add lib/api-spec/openapi.yaml
git commit -m "feat(spec): add cost-model and billing-record API endpoints"
```

---

### Task 8: Run codegen

- [ ] **Step 1: Run orval from repo root**

```bash
pnpm --filter @workspace/api-spec run codegen
```

Expected output: orval prints generated file paths for both `api-client-react` and `zod` outputs, then `tsc --build` succeeds with no errors.

If TypeScript errors appear, they're in the generated files — re-check the openapi.yaml for missing `required` fields or type mismatches, fix, and re-run.

- [ ] **Step 2: Commit regenerated files**

```bash
git add lib/api-zod/src/generated/ lib/api-client-react/src/generated/
git commit -m "chore: regenerate api-zod + api-client-react from updated openapi spec"
```

---

## Phase 3 — API Server

### Task 9: Update platforms route

**Files:**
- Modify: `artifacts/api-server/src/routes/platforms.ts`

- [ ] **Step 1: Replace file content**

```typescript
import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, platformsTable, platformCostModelsTable } from "@workspace/db";
import {
  CreatePlatformBody,
  UpdatePlatformBody,
  UpdatePlatformParams,
  GetPlatformParams,
  DeletePlatformParams,
  ListPlatformsResponse,
  GetPlatformResponse,
  UpdatePlatformResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function mapRow(r: typeof platformsTable.$inferSelect) {
  const costModels = await db
    .select()
    .from(platformCostModelsTable)
    .where(eq(platformCostModelsTable.platformId, r.id))
    .orderBy(platformCostModelsTable.createdAt);

  return {
    id: r.id,
    name: r.name,
    address: r.address,
    pocName: r.pocName,
    pocNumber: r.pocNumber,
    pocEmail: r.pocEmail,
    companyEmail: r.companyEmail,
    companyNumber: r.companyNumber,
    bankName: r.bankName,
    bankAccountNumber: r.bankAccountNumber,
    bankAddress: r.bankAddress,
    swiftCode: r.swiftCode,
    iban: r.iban,
    salesTaxNumber: r.salesTaxNumber,
    ntnNumber: r.ntnNumber,
    paymentTerms: r.paymentTerms,
    salesTaxPct: r.salesTaxPct !== null ? Number(r.salesTaxPct) : null,
    remittanceTaxPct: r.remittanceTaxPct !== null ? Number(r.remittanceTaxPct) : null,
    costModels: costModels.map(cm => ({
      id: cm.id,
      platformId: cm.platformId,
      name: cm.name,
      marginPct: Number(cm.marginPct),
      createdAt: cm.createdAt.toISOString(),
    })),
    createdAt: r.createdAt.toISOString(),
  };
}

router.get("/platforms", async (req, res): Promise<void> => {
  const rows = await db.select().from(platformsTable).orderBy(platformsTable.createdAt);
  const mapped = await Promise.all(rows.map(mapRow));
  res.json(ListPlatformsResponse.parse(mapped));
});

router.post("/platforms", async (req, res): Promise<void> => {
  const parsed = CreatePlatformBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db.insert(platformsTable).values(parsed.data).returning();
  res.status(201).json(GetPlatformResponse.parse(await mapRow(row)));
});

router.get("/platforms/:id", async (req, res): Promise<void> => {
  const params = GetPlatformParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.select().from(platformsTable).where(eq(platformsTable.id, params.data.id));
  if (!row) {
    res.status(404).json({ error: "Platform not found" });
    return;
  }
  res.json(GetPlatformResponse.parse(await mapRow(row)));
});

router.patch("/platforms/:id", async (req, res): Promise<void> => {
  const params = UpdatePlatformParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdatePlatformBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db
    .update(platformsTable)
    .set(parsed.data)
    .where(eq(platformsTable.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Platform not found" });
    return;
  }
  res.json(UpdatePlatformResponse.parse(await mapRow(row)));
});

router.delete("/platforms/:id", async (req, res): Promise<void> => {
  const params = DeletePlatformParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .delete(platformsTable)
    .where(eq(platformsTable.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Platform not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
```

- [ ] **Step 2: Commit**

```bash
git add artifacts/api-server/src/routes/platforms.ts
git commit -m "feat(api): update platforms route — new fields, embed costModels in response"
```

---

### Task 10: Create platform-cost-models route

**Files:**
- Create: `artifacts/api-server/src/routes/platform-cost-models.ts`

- [ ] **Step 1: Create the file**

```typescript
import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, platformCostModelsTable } from "@workspace/db";
import {
  CreatePlatformCostModelBody,
  CreatePlatformCostModelParams,
  UpdatePlatformCostModelBody,
  UpdatePlatformCostModelParams,
  DeletePlatformCostModelParams,
  GetPlatformCostModelResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

function mapCm(cm: typeof platformCostModelsTable.$inferSelect) {
  return {
    id: cm.id,
    platformId: cm.platformId,
    name: cm.name,
    marginPct: Number(cm.marginPct),
    createdAt: cm.createdAt.toISOString(),
  };
}

router.post("/platforms/:id/cost-models", async (req, res): Promise<void> => {
  const params = CreatePlatformCostModelParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = CreatePlatformCostModelBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [row] = await db
    .insert(platformCostModelsTable)
    .values({ platformId: params.data.id, ...parsed.data })
    .returning();
  res.status(201).json(GetPlatformCostModelResponse.parse(mapCm(row)));
});

router.patch("/platforms/:id/cost-models/:cmId", async (req, res): Promise<void> => {
  const params = UpdatePlatformCostModelParams.safeParse({
    id: parseInt(req.params.id as string, 10),
    cmId: parseInt(req.params.cmId as string, 10),
  });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdatePlatformCostModelBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [row] = await db
    .update(platformCostModelsTable)
    .set(parsed.data)
    .where(and(eq(platformCostModelsTable.id, params.data.cmId), eq(platformCostModelsTable.platformId, params.data.id)))
    .returning();
  if (!row) { res.status(404).json({ error: "Cost model not found" }); return; }
  res.json(GetPlatformCostModelResponse.parse(mapCm(row)));
});

router.delete("/platforms/:id/cost-models/:cmId", async (req, res): Promise<void> => {
  const params = DeletePlatformCostModelParams.safeParse({
    id: parseInt(req.params.id as string, 10),
    cmId: parseInt(req.params.cmId as string, 10),
  });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [row] = await db
    .delete(platformCostModelsTable)
    .where(and(eq(platformCostModelsTable.id, params.data.cmId), eq(platformCostModelsTable.platformId, params.data.id)))
    .returning();
  if (!row) { res.status(404).json({ error: "Cost model not found" }); return; }
  res.sendStatus(204);
});

export default router;
```

- [ ] **Step 2: Commit**

```bash
git add artifacts/api-server/src/routes/platform-cost-models.ts
git commit -m "feat(api): add platform cost-models route (POST/PATCH/DELETE)"
```

---

### Task 11: Create billing-records route

**Files:**
- Create: `artifacts/api-server/src/routes/billing-records.ts`

- [ ] **Step 1: Create the file**

```typescript
import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, billingRecordsTable, clientsTable, platformCostModelsTable } from "@workspace/db";
import {
  ListBillingRecordsParams,
  ListBillingRecordsQueryParams,
  CreateBillingRecordBody,
  CreateBillingRecordParams,
  DeleteBillingRecordParams,
  ListBillingRecordsResponse,
  GetBillingRecordResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function mapRecord(r: typeof billingRecordsTable.$inferSelect) {
  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, r.clientId));
  const [cm] = await db.select().from(platformCostModelsTable).where(eq(platformCostModelsTable.id, r.costModelId));
  return {
    id: r.id,
    platformId: r.platformId,
    clientId: r.clientId,
    clientName: client?.name ?? null,
    costModelId: r.costModelId,
    costModelName: cm?.name ?? null,
    costModelMarginPct: cm ? Number(cm.marginPct) : null,
    period: r.period,
    appsflyerPins: r.appsflyerPins,
    fraudPins: r.fraudPins,
    payoutRate: Number(r.payoutRate),
    createdAt: r.createdAt.toISOString(),
  };
}

router.get("/platforms/:id/billing-records", async (req, res): Promise<void> => {
  const params = ListBillingRecordsParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const query = ListBillingRecordsQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }

  let rows = await db
    .select()
    .from(billingRecordsTable)
    .where(eq(billingRecordsTable.platformId, params.data.id))
    .orderBy(billingRecordsTable.period, billingRecordsTable.createdAt);

  if (query.data.period) {
    rows = rows.filter(r => r.period === query.data.period);
  }
  if (query.data.clientId) {
    rows = rows.filter(r => r.clientId === query.data.clientId);
  }

  const mapped = await Promise.all(rows.map(mapRecord));
  res.json(ListBillingRecordsResponse.parse(mapped));
});

router.post("/platforms/:id/billing-records", async (req, res): Promise<void> => {
  const params = CreateBillingRecordParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = CreateBillingRecordBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [row] = await db
    .insert(billingRecordsTable)
    .values({ platformId: params.data.id, ...parsed.data })
    .returning();
  res.status(201).json(GetBillingRecordResponse.parse(await mapRecord(row)));
});

router.delete("/platforms/:id/billing-records/:recordId", async (req, res): Promise<void> => {
  const params = DeleteBillingRecordParams.safeParse({
    id: parseInt(req.params.id as string, 10),
    recordId: parseInt(req.params.recordId as string, 10),
  });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [row] = await db
    .delete(billingRecordsTable)
    .where(and(eq(billingRecordsTable.id, params.data.recordId), eq(billingRecordsTable.platformId, params.data.id)))
    .returning();
  if (!row) { res.status(404).json({ error: "Billing record not found" }); return; }
  res.sendStatus(204);
});

export default router;
```

- [ ] **Step 2: Commit**

```bash
git add artifacts/api-server/src/routes/billing-records.ts
git commit -m "feat(api): add billing-records route (GET/POST/DELETE)"
```

---

### Task 12: Mount new routers

**Files:**
- Modify: `artifacts/api-server/src/routes/index.ts`

- [ ] **Step 1: Add imports and mounts**

```typescript
import { Router, type IRouter } from "express";
import healthRouter from "./health";
import clientsRouter from "./clients";
import platformsRouter from "./platforms";
import platformCostModelsRouter from "./platform-cost-models";
import billingRecordsRouter from "./billing-records";
import campaignsRouter from "./campaigns";
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
router.use(campaignsRouter);
router.use(transactionsRouter);
router.use(analyticsRouter);
router.use(uploadRouter);
router.use(rolesRouter);
router.use(usersRouter);
router.use(aiRouter);

export default router;
```

- [ ] **Step 2: Verify API server typechecks**

```bash
pnpm --filter @workspace/api-server run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add artifacts/api-server/src/routes/index.ts
git commit -m "feat(api): mount platform-cost-models and billing-records routers"
```

---

## Phase 4 — Frontend

### Task 13: Update Platforms list page

**Files:**
- Modify: `artifacts/adops/src/pages/Platforms.tsx`

- [ ] **Step 1: Replace file content**

The key changes: remove `costModel`/`currency` from schema and table; make name a `<Link>`; slim down create dialog to 8 fields.

```tsx
import { useState, useEffect } from "react";
import { Plus, Pencil, Trash2, Search } from "lucide-react";
import { Link } from "wouter";
import {
  useListPlatforms, useCreatePlatform, useUpdatePlatform, useDeletePlatform,
  getListPlatformsQueryKey, useGetAnalyticsByPlatform,
} from "@workspace/api-client-react";
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
import { cn } from "@/lib/utils";
import { hasPermission } from "@/lib/auth";

const PAYMENT_TERMS = ["net_30", "net_60", "net_90", "net_120", "net_150"] as const;
const PAYMENT_LABEL: Record<string, string> = {
  net_30: "Net 30", net_60: "Net 60", net_90: "Net 90", net_120: "Net 120", net_150: "Net 150",
};

const createSchema = z.object({
  name: z.string().min(1, "Name is required"),
  address: z.string().optional(),
  pocName: z.string().optional(),
  pocNumber: z.string().optional(),
  pocEmail: z.string().email("Invalid email").optional().or(z.literal("")),
  companyEmail: z.string().email("Invalid email").optional().or(z.literal("")),
  companyNumber: z.string().optional(),
  paymentTerms: z.enum(PAYMENT_TERMS).optional(),
});
type CreateForm = z.infer<typeof createSchema>;

function fmt(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

export default function PlatformsPage() {
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: platforms, isLoading } = useListPlatforms();
  const { data: platformAnalytics } = useGetAnalyticsByPlatform();
  const analyticsMap = new Map((platformAnalytics ?? []).map(p => [p.platformId, p]));

  const createMutation = useCreatePlatform({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListPlatformsQueryKey() });
        setCreateOpen(false);
        toast({ title: "Platform created" });
      },
      onError: () => toast({ title: "Failed to create platform", variant: "destructive" }),
    },
  });

  const deleteMutation = useDeletePlatform({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListPlatformsQueryKey() });
        toast({ title: "Platform deleted" });
      },
      onError: () => toast({ title: "Failed to delete platform", variant: "destructive" }),
    },
  });

  const filtered = platforms?.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase())
  ) ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Platforms</h1>
          <p className="text-sm text-muted-foreground">{platforms?.length ?? 0} DSP platforms</p>
        </div>
        {hasPermission("Edit Platforms") && (
          <Button size="sm" className="gap-1.5 text-xs" onClick={() => setCreateOpen(true)} data-testid="create-platform-btn">
            <Plus className="h-3.5 w-3.5" /> Add Platform
          </Button>
        )}
      </div>

      <div className="relative w-72">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Search platforms..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 text-sm" />
      </div>

      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {["Name", "Payment Terms", "Cost Models", "Revenue", "Cost", "Profit", "Margin %", hasPermission("Edit Platforms") ? "Actions" : null]
                .filter((h): h is string => h !== null)
                .map(h => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-medium text-muted-foreground">{h}</th>
                ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(3)].map((_, i) => (
                <tr key={i} className="border-b border-border">
                  {[...Array(8)].map((_, j) => <td key={j} className="px-5 py-3"><Skeleton className="h-4 w-20" /></td>)}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className="px-5 py-10 text-center text-sm text-muted-foreground">No platforms found</td></tr>
            ) : (
              filtered.map(p => {
                const an = analyticsMap.get(p.id);
                return (
                  <tr key={p.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors" data-testid={`platform-row-${p.id}`}>
                    <td className="px-5 py-3 text-sm font-medium">
                      <Link href={`/platforms/${p.id}`} className="text-foreground hover:text-primary hover:underline">
                        {p.name}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-sm text-muted-foreground">
                      {p.paymentTerms ? PAYMENT_LABEL[p.paymentTerms] ?? p.paymentTerms : "—"}
                    </td>
                    <td className="px-5 py-3 text-sm text-muted-foreground">
                      {p.costModels?.length ? p.costModels.map(cm => cm.name).join(", ") : "—"}
                    </td>
                    <td className="px-5 py-3 text-sm font-medium">{an ? fmt(an.revenue) : "—"}</td>
                    <td className="px-5 py-3 text-sm text-muted-foreground">{an ? fmt(an.cost) : "—"}</td>
                    <td className={cn("px-5 py-3 text-sm font-semibold", an && an.profit < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400")}>
                      {an ? fmt(an.profit) : "—"}
                    </td>
                    <td className="px-5 py-3 text-sm text-muted-foreground">{an ? `${an.marginPct.toFixed(1)}%` : "—"}</td>
                    {hasPermission("Edit Platforms") && (
                      <td className="px-5 py-3">
                        <button
                          onClick={() => deleteMutation.mutate({ id: p.id })}
                          className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          data-testid={`delete-platform-${p.id}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <CreatePlatformDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSubmit={(data) => createMutation.mutate({ data })}
        isSubmitting={createMutation.isPending}
      />
    </div>
  );
}

function CreatePlatformDialog({ open, onClose, onSubmit, isSubmitting }: {
  open: boolean; onClose: () => void;
  onSubmit: (data: CreateForm) => void; isSubmitting: boolean;
}) {
  const form = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: { name: "", address: "", pocName: "", pocNumber: "", pocEmail: "", companyEmail: "", companyNumber: "" },
  });

  useEffect(() => {
    if (open) form.reset({ name: "", address: "", pocName: "", pocNumber: "", pocEmail: "", companyEmail: "", companyNumber: "" });
  }, [open, form]);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Add Platform</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem><FormLabel>Name <span className="text-destructive">*</span></FormLabel><FormControl><Input placeholder="e.g. The Trade Desk" {...field} data-testid="platform-name-input" /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="address" render={({ field }) => (
              <FormItem><FormLabel>Address</FormLabel><FormControl><Input placeholder="Company address" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="pocName" render={({ field }) => (
                <FormItem><FormLabel>POC Name</FormLabel><FormControl><Input placeholder="Contact name" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="pocNumber" render={({ field }) => (
                <FormItem><FormLabel>POC Number</FormLabel><FormControl><Input placeholder="+1 555 000" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <FormField control={form.control} name="pocEmail" render={({ field }) => (
              <FormItem><FormLabel>POC Email</FormLabel><FormControl><Input type="email" placeholder="poc@platform.com" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="companyEmail" render={({ field }) => (
                <FormItem><FormLabel>Company Email</FormLabel><FormControl><Input type="email" placeholder="billing@platform.com" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="companyNumber" render={({ field }) => (
                <FormItem><FormLabel>Company Number</FormLabel><FormControl><Input placeholder="Reg. number" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <FormField control={form.control} name="paymentTerms" render={({ field }) => (
              <FormItem><FormLabel>Payment Terms</FormLabel>
                <Select onValueChange={field.onChange} value={field.value ?? ""}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Select terms" /></SelectTrigger></FormControl>
                  <SelectContent>
                    {PAYMENT_TERMS.map(t => <SelectItem key={t} value={t}>{PAYMENT_LABEL[t]}</SelectItem>)}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={isSubmitting} data-testid="submit-platform-btn">
                {isSubmitting ? "Creating..." : "Create Platform"}
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
git add artifacts/adops/src/pages/Platforms.tsx
git commit -m "feat(ui): update platforms list — remove cost model/currency, add name link, new create dialog"
```

---

### Task 14: Add `/platforms/:id` route to App.tsx

**Files:**
- Modify: `artifacts/adops/src/App.tsx`

- [ ] **Step 1: Add import and route**

Add the import after the `PlatformsPage` import:

```tsx
import PlatformDetailPage from "@/pages/PlatformDetail";
```

Add the route after the `/platforms` route (before `/campaigns`):

```tsx
<Route path="/platforms/:id">
  {(params) => (
    <PermissionGuard permission="View Platforms" component={() => <PlatformDetailPage id={parseInt(params.id!, 10)} />} />
  )}
</Route>
```

- [ ] **Step 2: Commit**

```bash
git add artifacts/adops/src/App.tsx
git commit -m "feat(ui): add /platforms/:id route"
```

---

### Task 15: Create PlatformDetail page

**Files:**
- Create: `artifacts/adops/src/pages/PlatformDetail.tsx`

- [ ] **Step 1: Create the file**

```tsx
import { useState } from "react";
import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { useGetPlatform } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import PlatformDetailsTab from "./PlatformDetail/DetailsTab";
import PlatformTransactionsTab from "./PlatformDetail/TransactionsTab";
import PlatformAnalyticsTab from "./PlatformDetail/AnalyticsTab";

export default function PlatformDetailPage({ id }: { id: number }) {
  const { data: platform, isLoading } = useGetPlatform(id);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/platforms" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        {isLoading ? (
          <Skeleton className="h-7 w-48" />
        ) : (
          <h1 className="text-xl font-bold text-foreground">{platform?.name}</h1>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : platform ? (
        <Tabs defaultValue="details">
          <TabsList className="mb-4">
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="transactions">Transactions</TabsTrigger>
            <TabsTrigger value="analytics">Analytics</TabsTrigger>
          </TabsList>
          <TabsContent value="details">
            <PlatformDetailsTab platform={platform} />
          </TabsContent>
          <TabsContent value="transactions">
            <PlatformTransactionsTab platformId={id} platform={platform} />
          </TabsContent>
          <TabsContent value="analytics">
            <PlatformAnalyticsTab platformId={id} platform={platform} />
          </TabsContent>
        </Tabs>
      ) : (
        <p className="text-sm text-muted-foreground">Platform not found.</p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create the `PlatformDetail/` subdirectory stub files** (needed so Task 16-18 compile)

Create `artifacts/adops/src/pages/PlatformDetail/DetailsTab.tsx`:
```tsx
export default function PlatformDetailsTab({ platform }: { platform: any }) {
  return <div />;
}
```

Create `artifacts/adops/src/pages/PlatformDetail/TransactionsTab.tsx`:
```tsx
export default function PlatformTransactionsTab({ platformId, platform }: { platformId: number; platform: any }) {
  return <div />;
}
```

Create `artifacts/adops/src/pages/PlatformDetail/AnalyticsTab.tsx`:
```tsx
export default function PlatformAnalyticsTab({ platformId, platform }: { platformId: number; platform: any }) {
  return <div />;
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @workspace/adops run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add artifacts/adops/src/pages/PlatformDetail.tsx artifacts/adops/src/pages/PlatformDetail/
git commit -m "feat(ui): add PlatformDetail page shell with 3-tab layout"
```

---

### Task 16: Build DetailsTab

**Files:**
- Modify: `artifacts/adops/src/pages/PlatformDetail/DetailsTab.tsx`

- [ ] **Step 1: Replace stub with full implementation**

```tsx
import { useState, useEffect } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useUpdatePlatform, useCreatePlatformCostModel, useUpdatePlatformCostModel, useDeletePlatformCostModel, getGetPlatformQueryKey } from "@workspace/api-client-react";
import type { Platform } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { hasPermission } from "@/lib/auth";

const PAYMENT_TERMS = ["net_30", "net_60", "net_90", "net_120", "net_150"] as const;
const PAYMENT_LABEL: Record<string, string> = {
  net_30: "Net 30", net_60: "Net 60", net_90: "Net 90", net_120: "Net 120", net_150: "Net 150",
};

type CostModelRow = { id?: number; name: string; marginPct: string; isNew?: boolean };

export default function PlatformDetailsTab({ platform }: { platform: Platform }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const canEdit = hasPermission("Edit Platforms");

  const [form, setForm] = useState({
    name: platform.name ?? "",
    address: platform.address ?? "",
    pocName: platform.pocName ?? "",
    pocNumber: platform.pocNumber ?? "",
    pocEmail: platform.pocEmail ?? "",
    companyEmail: platform.companyEmail ?? "",
    companyNumber: platform.companyNumber ?? "",
    bankName: platform.bankName ?? "",
    bankAccountNumber: platform.bankAccountNumber ?? "",
    bankAddress: platform.bankAddress ?? "",
    swiftCode: platform.swiftCode ?? "",
    iban: platform.iban ?? "",
    salesTaxNumber: platform.salesTaxNumber ?? "",
    ntnNumber: platform.ntnNumber ?? "",
    paymentTerms: (platform.paymentTerms ?? "") as string,
    salesTaxPct: platform.salesTaxPct != null ? String(platform.salesTaxPct) : "",
    remittanceTaxPct: platform.remittanceTaxPct != null ? String(platform.remittanceTaxPct) : "",
  });

  const [costModels, setCostModels] = useState<CostModelRow[]>(
    (platform.costModels ?? []).map(cm => ({ id: cm.id, name: cm.name, marginPct: String(cm.marginPct) }))
  );

  useEffect(() => {
    setForm({
      name: platform.name ?? "",
      address: platform.address ?? "",
      pocName: platform.pocName ?? "",
      pocNumber: platform.pocNumber ?? "",
      pocEmail: platform.pocEmail ?? "",
      companyEmail: platform.companyEmail ?? "",
      companyNumber: platform.companyNumber ?? "",
      bankName: platform.bankName ?? "",
      bankAccountNumber: platform.bankAccountNumber ?? "",
      bankAddress: platform.bankAddress ?? "",
      swiftCode: platform.swiftCode ?? "",
      iban: platform.iban ?? "",
      salesTaxNumber: platform.salesTaxNumber ?? "",
      ntnNumber: platform.ntnNumber ?? "",
      paymentTerms: platform.paymentTerms ?? "",
      salesTaxPct: platform.salesTaxPct != null ? String(platform.salesTaxPct) : "",
      remittanceTaxPct: platform.remittanceTaxPct != null ? String(platform.remittanceTaxPct) : "",
    });
    setCostModels((platform.costModels ?? []).map(cm => ({ id: cm.id, name: cm.name, marginPct: String(cm.marginPct) })));
  }, [platform]);

  const updateMutation = useUpdatePlatform({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetPlatformQueryKey(platform.id) });
        toast({ title: "Platform updated" });
      },
      onError: () => toast({ title: "Failed to update platform", variant: "destructive" }),
    },
  });

  const createCmMutation = useCreatePlatformCostModel();
  const updateCmMutation = useUpdatePlatformCostModel();
  const deleteCmMutation = useDeletePlatformCostModel();

  const handleSave = async () => {
    const patchData: Record<string, unknown> = {
      name: form.name || undefined,
      address: form.address || null,
      pocName: form.pocName || null,
      pocNumber: form.pocNumber || null,
      pocEmail: form.pocEmail || null,
      companyEmail: form.companyEmail || null,
      companyNumber: form.companyNumber || null,
      bankName: form.bankName || null,
      bankAccountNumber: form.bankAccountNumber || null,
      bankAddress: form.bankAddress || null,
      swiftCode: form.swiftCode || null,
      iban: form.iban || null,
      salesTaxNumber: form.salesTaxNumber || null,
      ntnNumber: form.ntnNumber || null,
      paymentTerms: form.paymentTerms || null,
      salesTaxPct: form.salesTaxPct ? parseFloat(form.salesTaxPct) : null,
      remittanceTaxPct: form.remittanceTaxPct ? parseFloat(form.remittanceTaxPct) : null,
    };
    updateMutation.mutate({ id: platform.id, data: patchData as any });

    // Handle cost model saves
    const existing = platform.costModels ?? [];
    const existingIds = new Set(existing.map(cm => cm.id));

    for (const cm of costModels) {
      if (cm.isNew) {
        await createCmMutation.mutateAsync({ id: platform.id, data: { name: cm.name, marginPct: parseFloat(cm.marginPct) } });
      } else if (cm.id) {
        const orig = existing.find(e => e.id === cm.id);
        if (orig && (orig.name !== cm.name || String(orig.marginPct) !== cm.marginPct)) {
          await updateCmMutation.mutateAsync({ id: platform.id, cmId: cm.id, data: { name: cm.name, marginPct: parseFloat(cm.marginPct) } });
        }
      }
    }

    // Delete removed cost models
    for (const orig of existing) {
      if (!costModels.find(cm => cm.id === orig.id)) {
        await deleteCmMutation.mutateAsync({ id: platform.id, cmId: orig.id });
      }
    }

    qc.invalidateQueries({ queryKey: getGetPlatformQueryKey(platform.id) });
  };

  const field = (label: string, key: keyof typeof form, type = "text", placeholder = "") => (
    <div>
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <Input
        type={type}
        className="mt-1 text-sm"
        value={form[key]}
        placeholder={placeholder}
        disabled={!canEdit}
        onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
      />
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Section 1 */}
      <Section title="General">
        <div className="grid grid-cols-2 gap-4">
          {field("Name", "name", "text", "Platform name")}
          {field("Company Number", "companyNumber", "text", "Reg. number")}
          {field("Company Email", "companyEmail", "email", "billing@platform.com")}
        </div>
        {field("Address", "address", "text", "Full address")}
      </Section>

      {/* Section 2 */}
      <Section title="Point of Contact">
        <div className="grid grid-cols-3 gap-4">
          {field("POC Name", "pocName", "text", "Contact name")}
          {field("POC Number", "pocNumber", "text", "+1 555 000")}
          {field("POC Email", "pocEmail", "email", "poc@platform.com")}
        </div>
      </Section>

      {/* Section 3 */}
      <Section title="Financial & Legal">
        <div className="grid grid-cols-2 gap-4">
          {field("Bank Name", "bankName", "text", "Bank name")}
          {field("Account Number", "bankAccountNumber", "text", "Account no.")}
          {field("Bank Address", "bankAddress", "text", "Bank address")}
          {field("SWIFT Code", "swiftCode", "text", "SWIFT/BIC")}
          {field("IBAN", "iban", "text", "IBAN")}
          {field("Sales Tax Number", "salesTaxNumber", "text", "Tax reg. no.")}
          {field("NTN Number", "ntnNumber", "text", "NTN")}
        </div>
        <div className="grid grid-cols-2 gap-4 mt-4">
          {field("Sales Tax %", "salesTaxPct", "number", "e.g. 15")}
          {field("Remittance Tax %", "remittanceTaxPct", "number", "e.g. 10")}
        </div>
      </Section>

      {/* Section 4 */}
      <Section title="Payment Terms">
        <div className="w-48">
          <label className="text-xs font-medium text-muted-foreground">Terms</label>
          <Select
            value={form.paymentTerms}
            onValueChange={v => setForm(f => ({ ...f, paymentTerms: v }))}
            disabled={!canEdit}
          >
            <SelectTrigger className="mt-1 text-sm"><SelectValue placeholder="Select terms" /></SelectTrigger>
            <SelectContent>
              {PAYMENT_TERMS.map(t => <SelectItem key={t} value={t}>{PAYMENT_LABEL[t]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </Section>

      {/* Section 5 — Cost Models */}
      <Section title="Cost Models">
        <div className="space-y-2">
          {costModels.map((cm, i) => (
            <div key={i} className="flex items-center gap-3">
              <Input
                className="text-sm w-48"
                placeholder="e.g. CPM"
                value={cm.name}
                disabled={!canEdit}
                onChange={e => setCostModels(prev => prev.map((r, idx) => idx === i ? { ...r, name: e.target.value } : r))}
              />
              <div className="relative w-32">
                <Input
                  type="number"
                  className="text-sm pr-8"
                  placeholder="0.00"
                  value={cm.marginPct}
                  disabled={!canEdit}
                  onChange={e => setCostModels(prev => prev.map((r, idx) => idx === i ? { ...r, marginPct: e.target.value } : r))}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
              </div>
              {canEdit && (
                <button
                  onClick={() => setCostModels(prev => prev.filter((_, idx) => idx !== i))}
                  className="text-muted-foreground hover:text-destructive p-1"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
          {canEdit && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs mt-2"
              onClick={() => setCostModels(prev => [...prev, { name: "", marginPct: "", isNew: true }])}
            >
              <Plus className="h-3 w-3" /> Add Cost Model
            </Button>
          )}
        </div>
      </Section>

      {canEdit && (
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={updateMutation.isPending} size="sm">
            {updateMutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add artifacts/adops/src/pages/PlatformDetail/DetailsTab.tsx
git commit -m "feat(ui): implement PlatformDetail DetailsTab with all sections and cost models"
```

---

### Task 17: Build TransactionsTab

**Files:**
- Modify: `artifacts/adops/src/pages/PlatformDetail/TransactionsTab.tsx`

- [ ] **Step 1: Replace stub with full implementation**

```tsx
import { useState } from "react";
import { Plus, Trash2, Download } from "lucide-react";
import {
  useListBillingRecords, useCreateBillingRecord, useDeleteBillingRecord,
  getListBillingRecordsQueryKey, useListClients,
} from "@workspace/api-client-react";
import type { Platform } from "@workspace/api-client-react";
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
import { cn } from "@/lib/utils";

const addRecordSchema = z.object({
  clientId: z.number({ required_error: "Client is required" }),
  costModelId: z.number({ required_error: "Cost model is required" }),
  period: z.string().min(1, "Period is required"),
  appsflyerPins: z.number({ required_error: "Required" }).int().min(0),
  fraudPins: z.number({ required_error: "Required" }).int().min(0),
  payoutRate: z.number({ required_error: "Required" }).min(0),
});
type AddRecordForm = z.infer<typeof addRecordSchema>;

function getForexRate() {
  try {
    const rates = JSON.parse(localStorage.getItem("adops-exchange-rates") ?? "{}");
    return rates["pkr"] ?? 278;
  } catch {
    return 278;
  }
}

function computeRow(r: {
  appsflyerPins: number; fraudPins: number; payoutRate: number;
  costModelMarginPct: number | null | undefined;
}, salesTaxPct: number, remittanceTaxPct: number, forexRate: number) {
  const marginPct = r.costModelMarginPct ?? 0;
  const actualPins = r.appsflyerPins - r.fraudPins;
  const netAmtUsd = actualPins * r.payoutRate;
  const netAmtPkr = netAmtUsd * forexRate;
  const grossAmtPkr = marginPct > 0 ? netAmtPkr / (1 - marginPct / 100) : netAmtPkr;
  const salesTax = grossAmtPkr * (salesTaxPct / 100);
  const totalAmtPkr = grossAmtPkr + salesTax;
  const receivablePkr = grossAmtPkr; // confirmed formula placeholder — update when exact formula is known
  const netPayableUsd = netAmtUsd * (1 - marginPct / 100);
  const remittanceTax = netPayableUsd * (remittanceTaxPct / 100);
  const totalPayableUsd = netPayableUsd + remittanceTax;
  const totalPayablePkr = totalPayableUsd * forexRate;
  const netMarginPkr = receivablePkr - totalPayablePkr;
  return {
    actualPins, netAmtUsd, forexRate, netAmtPkr, grossAmtPkr,
    salesTax, totalAmtPkr, receivablePkr,
    netPayableUsd, remittanceTax, totalPayableUsd, totalPayablePkr, netMarginPkr,
  };
}

function fmtNum(n: number, decimals = 2) {
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export default function PlatformTransactionsTab({ platformId, platform }: { platformId: number; platform: Platform }) {
  const [periodFilter, setPeriodFilter] = useState("");
  const [clientFilter, setClientFilter] = useState("all");
  const [addOpen, setAddOpen] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();

  const queryParams = {
    ...(periodFilter ? { period: periodFilter } : {}),
    ...(clientFilter !== "all" ? { clientId: parseInt(clientFilter) } : {}),
  };

  const { data: records, isLoading } = useListBillingRecords(platformId, queryParams);
  const { data: clients } = useListClients();

  const deleteMutation = useDeleteBillingRecord({
    mutation: {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getListBillingRecordsQueryKey(platformId) }); toast({ title: "Record deleted" }); },
      onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
    },
  });

  const forexRate = getForexRate();
  const salesTaxPct = platform.salesTaxPct ?? 0;
  const remittanceTaxPct = platform.remittanceTaxPct ?? 0;

  const computed = (records ?? []).map(r => ({
    ...r,
    ...computeRow(
      { appsflyerPins: r.appsflyerPins, fraudPins: r.fraudPins, payoutRate: r.payoutRate, costModelMarginPct: r.costModelMarginPct },
      Number(salesTaxPct), Number(remittanceTaxPct), forexRate
    ),
  }));

  // Totals row
  const totals = computed.reduce((acc, r) => ({
    appsflyerPins: acc.appsflyerPins + r.appsflyerPins,
    fraudPins: acc.fraudPins + r.fraudPins,
    actualPins: acc.actualPins + r.actualPins,
    netAmtUsd: acc.netAmtUsd + r.netAmtUsd,
    netAmtPkr: acc.netAmtPkr + r.netAmtPkr,
    grossAmtPkr: acc.grossAmtPkr + r.grossAmtPkr,
    salesTax: acc.salesTax + r.salesTax,
    totalAmtPkr: acc.totalAmtPkr + r.totalAmtPkr,
    receivablePkr: acc.receivablePkr + r.receivablePkr,
    netPayableUsd: acc.netPayableUsd + r.netPayableUsd,
    remittanceTax: acc.remittanceTax + r.remittanceTax,
    totalPayableUsd: acc.totalPayableUsd + r.totalPayableUsd,
    totalPayablePkr: acc.totalPayablePkr + r.totalPayablePkr,
    netMarginPkr: acc.netMarginPkr + r.netMarginPkr,
  }), {
    appsflyerPins: 0, fraudPins: 0, actualPins: 0, netAmtUsd: 0, netAmtPkr: 0,
    grossAmtPkr: 0, salesTax: 0, totalAmtPkr: 0, receivablePkr: 0,
    netPayableUsd: 0, remittanceTax: 0, totalPayableUsd: 0, totalPayablePkr: 0, netMarginPkr: 0,
  });

  const exportCSV = () => {
    if (!computed.length) return;
    const headers = [
      "S#", "Billing Entity", "Appsflyer Pins", "Fraud Pins", "Actual Pins", "Payout Rate",
      "Net Amount (USD)", "Forex Rate", "Net Amount (PKR)", "Gross Amount (PKR)",
      `Sales Tax (${salesTaxPct}%)`, "Total Amount (PKR)", "Receivable (PKR)",
      "Net Payable (USD)", `Remittance Tax (${remittanceTaxPct}%)`,
      "Total Payable (USD)", "Forex Rate", "Total Payable (PKR)", "Net Margin (PKR)",
    ];
    const rows = computed.map((r, i) => [
      i + 1, r.clientName ?? "", r.appsflyerPins, r.fraudPins, r.actualPins, r.payoutRate,
      r.netAmtUsd.toFixed(2), forexRate, r.netAmtPkr.toFixed(2), r.grossAmtPkr.toFixed(2),
      r.salesTax.toFixed(2), r.totalAmtPkr.toFixed(2), r.receivablePkr.toFixed(2),
      r.netPayableUsd.toFixed(2), r.remittanceTax.toFixed(2),
      r.totalPayableUsd.toFixed(2), forexRate, r.totalPayablePkr.toFixed(2), r.netMarginPkr.toFixed(2),
    ]);
    const csv = [headers, ...rows].map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `billing-${platform.name}-${periodFilter || "all"}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const TH = ({ children }: { children: React.ReactNode }) => (
    <th className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground whitespace-nowrap">{children}</th>
  );
  const TD = ({ children, bold, className }: { children: React.ReactNode; bold?: boolean; className?: string }) => (
    <td className={cn("px-3 py-2 text-xs whitespace-nowrap", bold && "font-semibold", className)}>{children}</td>
  );

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Input
          type="month"
          className="w-40 text-sm"
          value={periodFilter}
          onChange={e => setPeriodFilter(e.target.value)}
          placeholder="Period"
        />
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
          {hasPermission("Edit Platforms") && (
            <Button size="sm" className="gap-1.5 text-xs" onClick={() => setAddOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Add Record
            </Button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-x-auto">
        <table className="w-full min-w-max">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <TH>S#</TH>
              <TH>Billing Entity</TH>
              <TH>Appsflyer Pins</TH>
              <TH>Fraud Pins</TH>
              <TH>Actual Pins</TH>
              <TH>Payout Rate</TH>
              <TH>Net Amount (USD)</TH>
              <TH>Forex Rate</TH>
              <TH>Net Amount (PKR)</TH>
              <TH>Gross Amount (PKR)</TH>
              <TH>Sales Tax ({fmtNum(Number(salesTaxPct), 0)}%)</TH>
              <TH>Total Amount (PKR)</TH>
              <TH>Receivable (PKR)</TH>
              <TH>Net Payable (USD)</TH>
              <TH>Remittance Tax ({fmtNum(Number(remittanceTaxPct), 0)}%)</TH>
              <TH>Total Payable (USD)</TH>
              <TH>Forex Rate</TH>
              <TH>Total Payable (PKR)</TH>
              <TH>Net Margin (PKR)</TH>
              {hasPermission("Edit Platforms") && <TH></TH>}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(3)].map((_, i) => (
                <tr key={i} className="border-b border-border">
                  {[...Array(20)].map((_, j) => <td key={j} className="px-3 py-2"><Skeleton className="h-3 w-16" /></td>)}
                </tr>
              ))
            ) : computed.length === 0 ? (
              <tr><td colSpan={20} className="px-5 py-10 text-center text-sm text-muted-foreground">No billing records</td></tr>
            ) : (
              <>
                {computed.map((r, i) => (
                  <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                    <TD>{i + 1}</TD>
                    <TD bold>{r.clientName ?? "—"}</TD>
                    <TD>{r.appsflyerPins.toLocaleString()}</TD>
                    <TD>{r.fraudPins.toLocaleString()}</TD>
                    <TD bold>{r.actualPins.toLocaleString()}</TD>
                    <TD>{fmtNum(r.payoutRate)}</TD>
                    <TD>{fmtNum(r.netAmtUsd)}</TD>
                    <TD>{fmtNum(forexRate, 2)}</TD>
                    <TD>{fmtNum(r.netAmtPkr)}</TD>
                    <TD>{fmtNum(r.grossAmtPkr)}</TD>
                    <TD>{fmtNum(r.salesTax)}</TD>
                    <TD>{fmtNum(r.totalAmtPkr)}</TD>
                    <TD>{fmtNum(r.receivablePkr)}</TD>
                    <TD>{fmtNum(r.netPayableUsd)}</TD>
                    <TD>{fmtNum(r.remittanceTax)}</TD>
                    <TD>{fmtNum(r.totalPayableUsd)}</TD>
                    <TD>{fmtNum(forexRate, 2)}</TD>
                    <TD>{fmtNum(r.totalPayablePkr)}</TD>
                    <TD bold className={r.netMarginPkr < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}>
                      {fmtNum(r.netMarginPkr)}
                    </TD>
                    {hasPermission("Edit Platforms") && (
                      <TD>
                        <button onClick={() => deleteMutation.mutate({ id: platformId, recordId: r.id })} className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </TD>
                    )}
                  </tr>
                ))}
                {/* Totals row */}
                <tr className="border-t-2 border-border bg-muted/30 font-semibold">
                  <TD bold></TD>
                  <TD bold>Total</TD>
                  <TD bold>{totals.appsflyerPins.toLocaleString()}</TD>
                  <TD bold>{totals.fraudPins.toLocaleString()}</TD>
                  <TD bold>{totals.actualPins.toLocaleString()}</TD>
                  <TD></TD>
                  <TD bold>{fmtNum(totals.netAmtUsd)}</TD>
                  <TD></TD>
                  <TD bold>{fmtNum(totals.netAmtPkr)}</TD>
                  <TD bold>{fmtNum(totals.grossAmtPkr)}</TD>
                  <TD bold>{fmtNum(totals.salesTax)}</TD>
                  <TD bold>{fmtNum(totals.totalAmtPkr)}</TD>
                  <TD bold>{fmtNum(totals.receivablePkr)}</TD>
                  <TD bold>{fmtNum(totals.netPayableUsd)}</TD>
                  <TD bold>{fmtNum(totals.remittanceTax)}</TD>
                  <TD bold>{fmtNum(totals.totalPayableUsd)}</TD>
                  <TD></TD>
                  <TD bold>{fmtNum(totals.totalPayablePkr)}</TD>
                  <TD bold className={totals.netMarginPkr < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}>
                    {fmtNum(totals.netMarginPkr)}
                  </TD>
                  {hasPermission("Edit Platforms") && <TD></TD>}
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>

      <AddRecordDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        platformId={platformId}
        costModels={platform.costModels ?? []}
      />
    </div>
  );
}

function AddRecordDialog({ open, onClose, platformId, costModels }: {
  open: boolean; onClose: () => void;
  platformId: number;
  costModels: { id: number; name: string; marginPct: number }[];
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: clients } = useListClients();

  const form = useForm<AddRecordForm>({
    resolver: zodResolver(addRecordSchema),
  });

  const createMutation = useCreateBillingRecord({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListBillingRecordsQueryKey(platformId) });
        onClose();
        toast({ title: "Billing record added" });
      },
      onError: () => toast({ title: "Failed to add record", variant: "destructive" }),
    },
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Add Billing Record</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(data => createMutation.mutate({ id: platformId, data }))} className="space-y-3">
            <FormField control={form.control} name="clientId" render={({ field }) => (
              <FormItem><FormLabel>Billing Entity</FormLabel>
                <Select onValueChange={v => field.onChange(parseInt(v))} value={field.value ? String(field.value) : ""}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Select client" /></SelectTrigger></FormControl>
                  <SelectContent>
                    {clients?.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="costModelId" render={({ field }) => (
              <FormItem><FormLabel>Cost Model</FormLabel>
                <Select onValueChange={v => field.onChange(parseInt(v))} value={field.value ? String(field.value) : ""}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Select cost model" /></SelectTrigger></FormControl>
                  <SelectContent>
                    {costModels.map(cm => <SelectItem key={cm.id} value={String(cm.id)}>{cm.name} ({cm.marginPct}%)</SelectItem>)}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="period" render={({ field }) => (
              <FormItem><FormLabel>Period</FormLabel><FormControl><Input type="month" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="appsflyerPins" render={({ field }) => (
                <FormItem><FormLabel>Appsflyer Pins</FormLabel><FormControl><Input type="number" min={0} {...field} onChange={e => field.onChange(parseInt(e.target.value))} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="fraudPins" render={({ field }) => (
                <FormItem><FormLabel>Fraud Pins</FormLabel><FormControl><Input type="number" min={0} {...field} onChange={e => field.onChange(parseInt(e.target.value))} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <FormField control={form.control} name="payoutRate" render={({ field }) => (
              <FormItem><FormLabel>Payout Rate (USD)</FormLabel><FormControl><Input type="number" step="0.01" min={0} {...field} onChange={e => field.onChange(parseFloat(e.target.value))} /></FormControl><FormMessage /></FormItem>
            )} />
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Adding..." : "Add Record"}
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
git add artifacts/adops/src/pages/PlatformDetail/TransactionsTab.tsx
git commit -m "feat(ui): implement billing records TransactionsTab with computed columns and totals row"
```

---

### Task 18: Build AnalyticsTab

**Files:**
- Modify: `artifacts/adops/src/pages/PlatformDetail/AnalyticsTab.tsx`

- [ ] **Step 1: Replace stub with full implementation**

```tsx
import { useState } from "react";
import { useListBillingRecords } from "@workspace/api-client-react";
import type { Platform } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from "recharts";

function getForexRate() {
  try {
    const rates = JSON.parse(localStorage.getItem("adops-exchange-rates") ?? "{}");
    return rates["pkr"] ?? 278;
  } catch { return 278; }
}

function computeNetMargin(r: {
  appsflyerPins: number; fraudPins: number; payoutRate: number;
  costModelMarginPct: number | null | undefined;
}, salesTaxPct: number, remittanceTaxPct: number, forexRate: number) {
  const marginPct = r.costModelMarginPct ?? 0;
  const actualPins = r.appsflyerPins - r.fraudPins;
  const netAmtUsd = actualPins * r.payoutRate;
  const netAmtPkr = netAmtUsd * forexRate;
  const grossAmtPkr = marginPct > 0 ? netAmtPkr / (1 - marginPct / 100) : netAmtPkr;
  const salesTax = grossAmtPkr * (salesTaxPct / 100);
  const receivablePkr = grossAmtPkr;
  const netPayableUsd = netAmtUsd * (1 - marginPct / 100);
  const remittanceTax = netPayableUsd * (remittanceTaxPct / 100);
  const totalPayableUsd = netPayableUsd + remittanceTax;
  const totalPayablePkr = totalPayableUsd * forexRate;
  return {
    receivablePkr,
    totalPayablePkr,
    netMarginPkr: receivablePkr - totalPayablePkr,
    marginPct: receivablePkr > 0 ? ((receivablePkr - totalPayablePkr) / receivablePkr) * 100 : 0,
  };
}

function KPI({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-bold text-foreground">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

const tooltipStyle = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "8px",
  fontSize: "12px",
};

export default function PlatformAnalyticsTab({ platformId, platform }: { platformId: number; platform: Platform }) {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const { data: records, isLoading } = useListBillingRecords(platformId, {});

  const forexRate = getForexRate();
  const salesTaxPct = Number(platform.salesTaxPct ?? 0);
  const remittanceTaxPct = Number(platform.remittanceTaxPct ?? 0);

  const allComputed = (records ?? []).map(r => ({
    ...r,
    ...computeNetMargin(r, salesTaxPct, remittanceTaxPct, forexRate),
  }));

  // Filter by period if date inputs are set
  const filtered = allComputed.filter(r => {
    if (dateFrom && r.period < dateFrom.slice(0, 7)) return false;
    if (dateTo && r.period > dateTo.slice(0, 7)) return false;
    return true;
  });

  const totalReceivable = filtered.reduce((s, r) => s + r.receivablePkr, 0);
  const totalPayable = filtered.reduce((s, r) => s + r.totalPayablePkr, 0);
  const totalMargin = totalReceivable - totalPayable;
  const overallMarginPct = totalReceivable > 0 ? (totalMargin / totalReceivable) * 100 : 0;

  // Monthly trend
  const byPeriod = new Map<string, { receivable: number; payable: number; margin: number }>();
  for (const r of filtered) {
    const existing = byPeriod.get(r.period) ?? { receivable: 0, payable: 0, margin: 0 };
    byPeriod.set(r.period, {
      receivable: existing.receivable + r.receivablePkr,
      payable: existing.payable + r.totalPayablePkr,
      margin: existing.margin + r.netMarginPkr,
    });
  }
  const trendData = Array.from(byPeriod.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([period, v]) => ({ period, ...v }));

  // Per-client breakdown
  const byClient = new Map<string, number>();
  for (const r of filtered) {
    const name = r.clientName ?? "Unknown";
    byClient.set(name, (byClient.get(name) ?? 0) + r.netMarginPkr);
  }
  const clientData = Array.from(byClient.entries()).map(([name, margin]) => ({ name, margin }));

  const fmt = (n: number) => {
    if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toFixed(0);
  };

  return (
    <div className="space-y-6">
      {/* Date filter */}
      <div className="flex items-center gap-3">
        <Input type="month" className="w-36 text-sm" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
        <span className="text-xs text-muted-foreground">to</span>
        <Input type="month" className="w-36 text-sm" value={dateTo} onChange={e => setDateTo(e.target.value)} />
      </div>

      {/* KPI cards */}
      {isLoading ? (
        <div className="grid grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KPI label="Total Receivable (PKR)" value={`₨ ${fmt(totalReceivable)}`} />
          <KPI label="Total Payable (PKR)" value={`₨ ${fmt(totalPayable)}`} />
          <KPI label="Net Margin (PKR)" value={`₨ ${fmt(totalMargin)}`} />
          <KPI label="Margin %" value={`${overallMarginPct.toFixed(1)}%`} />
        </div>
      )}

      {/* Monthly trend */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h3 className="text-sm font-semibold text-foreground mb-4">Monthly Net Margin (PKR)</h3>
        {isLoading ? <Skeleton className="h-48 w-full" /> : (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="period" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis tickFormatter={v => fmt(v)} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`₨ ${fmt(v)}`, ""]} />
              <Area type="monotone" dataKey="margin" stroke="hsl(var(--primary))" fill="hsl(var(--primary) / 0.15)" strokeWidth={2} name="Net Margin" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Per-client breakdown */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h3 className="text-sm font-semibold text-foreground mb-4">Net Margin by Billing Entity (PKR)</h3>
        {isLoading ? <Skeleton className="h-48 w-full" /> : (
          <ResponsiveContainer width="100%" height={Math.max(180, clientData.length * 40)}>
            <BarChart data={clientData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis type="number" tickFormatter={v => fmt(v)} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" width={100} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`₨ ${fmt(v)}`, "Net Margin"]} />
              <Bar dataKey="margin" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck the full adops app**

```bash
pnpm --filter @workspace/adops run typecheck
```

Expected: no errors. If there are type errors due to mismatched field names between the generated types and what we're passing, check the codegen output and update field names accordingly.

- [ ] **Step 3: Commit**

```bash
git add artifacts/adops/src/pages/PlatformDetail/AnalyticsTab.tsx
git commit -m "feat(ui): implement platform AnalyticsTab with KPI cards, monthly trend, and client breakdown"
```

---

## Self-Review Checklist

After all tasks complete:

- [ ] `pnpm --filter @workspace/db run push` succeeded
- [ ] `pnpm --filter @workspace/api-spec run codegen` succeeded with no TS errors
- [ ] `pnpm --filter @workspace/api-server run typecheck` passes
- [ ] `pnpm --filter @workspace/adops run typecheck` passes
- [ ] Navigate to `/platforms` — no Cost Model/Currency columns, name is clickable
- [ ] Create a platform — 8-field dialog, saves successfully
- [ ] Click platform name → navigates to `/platforms/:id`
- [ ] Details tab — all 5 sections editable, cost models add/remove/save
- [ ] Transactions tab — Add Record dialog shows cost model dropdown, record appears in table, computed columns display, totals row at bottom
- [ ] Analytics tab — KPI cards and charts render from billing record data
- [ ] Export CSV from Transactions tab produces correct file
