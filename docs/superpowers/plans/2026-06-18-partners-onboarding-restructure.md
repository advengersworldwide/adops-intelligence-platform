# Partners Rename + Onboarding Restructure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename Platforms → Partners across the stack, give Clients/Buying Houses/Partners a shared KYC field set, add Settings-managed global Cost Models + Payment Terms catalogs, add client Events (cost model + billable rate) and partner per-event payouts — config/onboarding only, leaving profit calculations for a later phase.

**Architecture:** Monorepo layered flow — `lib/db` (Drizzle schema, source of truth) → `lib/api-spec/openapi.yaml` (API contract) → orval generates `lib/api-zod` (zod + types) and `lib/api-client-react` (React Query hooks) → `artifacts/api-server` (Express routes) → `artifacts/adops` (React pages). DB sync is `drizzle-kit push` (no migration files). There is no test runner; the verification loop is `pnpm run typecheck`, `pnpm --filter @workspace/api-spec run codegen`, and `pnpm --filter @workspace/db run push-force`.

**Tech Stack:** TypeScript, Drizzle ORM (Postgres), Express 5, React + Vite, wouter, TanStack Query, react-hook-form + zod, shadcn/ui, orval.

---

## Conventions used in this plan

**Verification gates (run from repo root `e:/Futurama Projects/adops-intelligence-platform`):**
- `pnpm run typecheck` — typechecks libs + artifacts. This is the primary "green" gate.
- `pnpm --filter @workspace/api-spec run codegen` — regenerates `lib/api-zod` + `lib/api-client-react` from `openapi.yaml` (also runs `typecheck:libs`).
- `pnpm --filter @workspace/db run push-force` — pushes the Drizzle schema to the DB (requires `DATABASE_URL`; run only when a DB is available, e.g. before manual smoke testing).

**Orval naming (so generated symbols are predictable):** for an `operationId` like `createCostModel`, orval generates the React hook `useCreateCostModel` and zod schemas `CreateCostModelBody` (request body), `CreateCostModelParams` (path params), `CreateCostModelQueryParams` (query), `CreateCostModelResponse` (the 201/200 body schema). Array `200` responses generate `<Op>Response`.

**Identifier rename map (Platforms → Partners)** — applied in Phase 6:

| Old | New |
| --- | --- |
| `platformsTable` | `partnersTable` |
| table `"platforms"` | `"partners"` |
| `platformId` / `platform_id` | `partnerId` / `partner_id` |
| `platformBulkDiscountPct` / `platform_bulk_discount_pct` | `partnerBulkDiscountPct` / `partner_bulk_discount_pct` |
| type `Platform` / `PlatformInput` / `PlatformUpdate` / `PlatformAnalytics` | `Partner` / `PartnerInput` / `PartnerUpdate` / `PartnerAnalytics` |
| operationIds `listPlatforms`/`getPlatform`/`createPlatform`/`updatePlatform`/`deletePlatform` | `listPartners`/`getPartner`/`createPartner`/`updatePartner`/`deletePartner` |
| hooks `useListPlatforms`/`useGetPlatform`/… | `useListPartners`/`useGetPartner`/… |
| route paths `/platforms*` | `/partners*` |
| permission `View Platforms` / `Edit Platforms` | `View Partners` / `Edit Partners` |
| UI files `Platforms.tsx`, `PlatformDetail*` | `Partners.tsx`, `PartnerDetail*` |
| nav label `Platforms` | `Partners` |

---

## Phase 1 — Global catalogs: schema (cost_models, payment_terms) + shared KYC columns helper

**Files:**
- Create: `lib/db/src/schema/kyc-columns.ts`
- Create: `lib/db/src/schema/cost-models.ts`
- Create: `lib/db/src/schema/payment-terms.ts`
- Modify: `lib/db/src/schema/index.ts`

- [ ] **Step 1: Create the shared KYC columns helper**

Create `lib/db/src/schema/kyc-columns.ts`:

```ts
import { text } from "drizzle-orm/pg-core";

// Shared KYC column set applied to clients, buying_houses, and partners.
// Spread into a pgTable definition: pgTable("x", { id, name, ...kycColumns })
export const kycColumns = {
  address: text("address"),
  pocName: text("poc_name"),
  pocNumber: text("poc_number"),
  pocEmail: text("poc_email"),
  companyEmail: text("company_email"),
  companyNumber: text("company_number"),
  bankName: text("bank_name"),
  bankAccountNumber: text("bank_account_number"),
  bankAddress: text("bank_address"),
  swiftCode: text("swift_code"),
  iban: text("iban"),
  salesTaxNumber: text("sales_tax_number"),
  ntnNumber: text("ntn_number"),
};
```

- [ ] **Step 2: Create the cost_models table**

Create `lib/db/src/schema/cost-models.ts`:

```ts
import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const costModelsTable = pgTable("cost_models", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CostModel = typeof costModelsTable.$inferSelect;
```

- [ ] **Step 3: Create the payment_terms table**

Create `lib/db/src/schema/payment-terms.ts`:

```ts
import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const paymentTermsTable = pgTable("payment_terms", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PaymentTerm = typeof paymentTermsTable.$inferSelect;
```

- [ ] **Step 4: Export the new tables**

In `lib/db/src/schema/index.ts`, add these export lines (place after the existing `export * from "./clients";` line):

```ts
export * from "./cost-models";
export * from "./payment-terms";
export * from "./client-events";
export * from "./partner-clients";
export * from "./partner-event-payouts";
```

> Note: `client-events`, `partner-clients`, `partner-event-payouts` are created in Phases 3/5. Adding all exports now is harmless only after those files exist — so add ONLY the `cost-models` and `payment-terms` lines in this step, and add the other three lines in their respective phases. Add now:

```ts
export * from "./cost-models";
export * from "./payment-terms";
```

- [ ] **Step 5: Verify typecheck passes**

Run: `pnpm run typecheck`
Expected: PASS (new tables compile; nothing references them yet).

- [ ] **Step 6: Commit**

```bash
git add lib/db/src/schema/kyc-columns.ts lib/db/src/schema/cost-models.ts lib/db/src/schema/payment-terms.ts lib/db/src/schema/index.ts
git commit -m "feat(db): add cost_models, payment_terms tables + shared kyc columns helper"
```

---

## Phase 2 — Global catalogs: OpenAPI + routes + Settings UI

**Files:**
- Modify: `lib/api-spec/openapi.yaml`
- Create: `artifacts/api-server/src/routes/cost-models.ts`
- Create: `artifacts/api-server/src/routes/payment-terms.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`
- Modify: `artifacts/adops/src/pages/Settings.tsx`

- [ ] **Step 1: Add catalog schemas to openapi.yaml**

In `lib/api-spec/openapi.yaml`, under `components.schemas:` (e.g. right before the `Client:` schema at line ~1079), add:

```yaml
    CostModel:
      type: object
      required: [id, name, createdAt]
      properties:
        id: { type: integer }
        name: { type: string }
        createdAt: { type: string }

    CostModelInput:
      type: object
      required: [name]
      properties:
        name: { type: string, minLength: 1 }

    PaymentTerm:
      type: object
      required: [id, name, createdAt]
      properties:
        id: { type: integer }
        name: { type: string }
        createdAt: { type: string }

    PaymentTermInput:
      type: object
      required: [name]
      properties:
        name: { type: string, minLength: 1 }
```

- [ ] **Step 2: Add catalog paths to openapi.yaml**

In `lib/api-spec/openapi.yaml`, under `paths:` (e.g. after the `/clients/{id}` block at line ~148), add:

```yaml
  /cost-models:
    get:
      operationId: listCostModels
      tags: [cost-models]
      summary: List all cost models
      responses:
        "200":
          description: List of cost models
          content:
            application/json:
              schema:
                type: array
                items: { $ref: "#/components/schemas/CostModel" }
    post:
      operationId: createCostModel
      tags: [cost-models]
      summary: Create a cost model
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/CostModelInput" }
      responses:
        "201":
          description: Created
          content:
            application/json:
              schema: { $ref: "#/components/schemas/CostModel" }
        "400": { description: Validation error }

  /cost-models/{id}:
    delete:
      operationId: deleteCostModel
      tags: [cost-models]
      summary: Delete a cost model
      parameters:
        - { name: id, in: path, required: true, schema: { type: integer } }
      responses:
        "204": { description: Deleted }
        "404": { description: Not found }

  /payment-terms:
    get:
      operationId: listPaymentTerms
      tags: [payment-terms]
      summary: List all payment terms
      responses:
        "200":
          description: List of payment terms
          content:
            application/json:
              schema:
                type: array
                items: { $ref: "#/components/schemas/PaymentTerm" }
    post:
      operationId: createPaymentTerm
      tags: [payment-terms]
      summary: Create a payment term
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/PaymentTermInput" }
      responses:
        "201":
          description: Created
          content:
            application/json:
              schema: { $ref: "#/components/schemas/PaymentTerm" }
        "400": { description: Validation error }

  /payment-terms/{id}:
    delete:
      operationId: deletePaymentTerm
      tags: [payment-terms]
      summary: Delete a payment term
      parameters:
        - { name: id, in: path, required: true, schema: { type: integer } }
      responses:
        "204": { description: Deleted }
        "404": { description: Not found }
```

- [ ] **Step 3: Regenerate the API client + zod**

Run: `pnpm --filter @workspace/api-spec run codegen`
Expected: PASS. New files appear under `lib/api-zod/src/generated/` and `lib/api-client-react/src/generated/` (e.g. `useListCostModels`, `CreateCostModelBody`, `useListPaymentTerms`).

- [ ] **Step 4: Create the cost-models route**

Create `artifacts/api-server/src/routes/cost-models.ts`:

```ts
import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, costModelsTable } from "@workspace/db";
import {
  CreateCostModelBody,
  DeleteCostModelParams,
  ListCostModelsResponse,
  CreateCostModelResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

function mapRow(r: typeof costModelsTable.$inferSelect) {
  return { id: r.id, name: r.name, createdAt: r.createdAt.toISOString() };
}

router.get("/cost-models", async (_req, res): Promise<void> => {
  const rows = await db.select().from(costModelsTable).orderBy(costModelsTable.createdAt);
  res.json(ListCostModelsResponse.parse(rows.map(mapRow)));
});

router.post("/cost-models", async (req, res): Promise<void> => {
  const parsed = CreateCostModelBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [row] = await db.insert(costModelsTable).values({ name: parsed.data.name }).returning();
  res.status(201).json(CreateCostModelResponse.parse(mapRow(row)));
});

router.delete("/cost-models/:id", async (req, res): Promise<void> => {
  const params = DeleteCostModelParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [row] = await db.delete(costModelsTable).where(eq(costModelsTable.id, params.data.id)).returning();
  if (!row) { res.status(404).json({ error: "Cost model not found" }); return; }
  res.sendStatus(204);
});

export default router;
```

- [ ] **Step 5: Create the payment-terms route**

Create `artifacts/api-server/src/routes/payment-terms.ts`:

```ts
import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, paymentTermsTable } from "@workspace/db";
import {
  CreatePaymentTermBody,
  DeletePaymentTermParams,
  ListPaymentTermsResponse,
  CreatePaymentTermResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

function mapRow(r: typeof paymentTermsTable.$inferSelect) {
  return { id: r.id, name: r.name, createdAt: r.createdAt.toISOString() };
}

router.get("/payment-terms", async (_req, res): Promise<void> => {
  const rows = await db.select().from(paymentTermsTable).orderBy(paymentTermsTable.createdAt);
  res.json(ListPaymentTermsResponse.parse(rows.map(mapRow)));
});

router.post("/payment-terms", async (req, res): Promise<void> => {
  const parsed = CreatePaymentTermBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [row] = await db.insert(paymentTermsTable).values({ name: parsed.data.name }).returning();
  res.status(201).json(CreatePaymentTermResponse.parse(mapRow(row)));
});

router.delete("/payment-terms/:id", async (req, res): Promise<void> => {
  const params = DeletePaymentTermParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [row] = await db.delete(paymentTermsTable).where(eq(paymentTermsTable.id, params.data.id)).returning();
  if (!row) { res.status(404).json({ error: "Payment term not found" }); return; }
  res.sendStatus(204);
});

export default router;
```

- [ ] **Step 6: Register the new routers**

In `artifacts/api-server/src/routes/index.ts`: add imports near the other route imports:

```ts
import costModelsRouter from "./cost-models";
import paymentTermsRouter from "./payment-terms";
```

and add the `use` calls in the router body (after `router.use(clientsRouter);`):

```ts
router.use(costModelsRouter);
router.use(paymentTermsRouter);
```

- [ ] **Step 7: Add Settings catalog UI (reusable CatalogTab + two tabs)**

In `artifacts/adops/src/pages/Settings.tsx`:

1. Extend the imports from the API client (add to the existing `@workspace/api-client-react` usage — there is none yet in Settings, so add a new import near the top):

```ts
import {
  useListCostModels, useCreateCostModel, useDeleteCostModel, getListCostModelsQueryKey,
  useListPaymentTerms, useCreatePaymentTerm, useDeletePaymentTerm, getListPaymentTermsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
```

2. Add `"costModels" | "paymentTerms"` to the `activeTab` union:

```ts
const [activeTab, setActiveTab] = useState<"general" | "roles" | "users" | "costModels" | "paymentTerms">("general");
```

3. Add two entries to the tab list array (inside the `.map` over `[{ id: "general", ... }]`):

```ts
{ id: "costModels", label: "Cost Models" },
{ id: "paymentTerms", label: "Payment Terms" },
```

4. Add a reusable `CatalogTab` component at the bottom of the file (before the final closing of the module):

```tsx
function CatalogTab({
  title, description, items, onAdd, onDelete, placeholder,
}: {
  title: string;
  description: string;
  items: Array<{ id: number; name: string }>;
  onAdd: (name: string) => void;
  onDelete: (id: number) => void;
  placeholder: string;
}) {
  const [name, setName] = useState("");
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = name.trim();
    if (t) { onAdd(t); setName(""); }
  };
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <form onSubmit={submit} className="flex gap-2 max-w-md">
        <Input value={name} onChange={e => setName(e.target.value)} placeholder={placeholder} className="text-sm h-9" />
        <Button type="submit" size="sm" className="gap-1.5 text-xs"><Plus className="h-3.5 w-3.5" /> Add</Button>
      </form>
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden max-w-md">
        <table className="w-full">
          <tbody>
            {items.length === 0 ? (
              <tr><td className="px-5 py-8 text-center text-sm text-muted-foreground">None yet</td></tr>
            ) : items.map(it => (
              <tr key={it.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                <td className="px-5 py-3 text-sm font-medium text-foreground">{it.name}</td>
                <td className="px-5 py-3 text-right">
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0 hover:bg-destructive/10 text-destructive" onClick={() => onDelete(it.id)}>
                    <Trash2 className="h-3.5 w-3.5 text-red-500" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

5. Inside `SettingsPage`, add hooks + handlers (near the other hooks):

```tsx
const qc = useQueryClient();
const { data: costModels } = useListCostModels();
const createCostModel = useCreateCostModel({ mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getListCostModelsQueryKey() }); toast({ title: "Cost model added" }); } } });
const deleteCostModelM = useDeleteCostModel({ mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getListCostModelsQueryKey() }); toast({ title: "Cost model deleted" }); } } });
const { data: paymentTerms } = useListPaymentTerms();
const createPaymentTerm = useCreatePaymentTerm({ mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getListPaymentTermsQueryKey() }); toast({ title: "Payment term added" }); } } });
const deletePaymentTermM = useDeletePaymentTerm({ mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getListPaymentTermsQueryKey() }); toast({ title: "Payment term deleted" }); } } });
```

6. Add the two tab bodies after the `activeTab === "users"` block:

```tsx
{activeTab === "costModels" && (
  <CatalogTab
    title="Cost Models" description="Names referenced when configuring client events."
    placeholder="e.g. CPI, CPA, CPL"
    items={costModels ?? []}
    onAdd={(name) => createCostModel.mutate({ data: { name } })}
    onDelete={(id) => deleteCostModelM.mutate({ id })}
  />
)}
{activeTab === "paymentTerms" && (
  <CatalogTab
    title="Payment Terms" description="Names referenced by clients and partners."
    placeholder="e.g. Net 30, Net 60"
    items={paymentTerms ?? []}
    onAdd={(name) => createPaymentTerm.mutate({ data: { name } })}
    onDelete={(id) => deletePaymentTermM.mutate({ id })}
  />
)}
```

- [ ] **Step 8: Verify typecheck passes**

Run: `pnpm run typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/api-spec/openapi.yaml lib/api-zod lib/api-client-react artifacts/api-server/src/routes/cost-models.ts artifacts/api-server/src/routes/payment-terms.ts artifacts/api-server/src/routes/index.ts artifacts/adops/src/pages/Settings.tsx
git commit -m "feat: global cost models + payment terms catalogs (api + settings UI)"
```

---

## Phase 3 — Client: KYC + taxes + payment terms + events (schema, openapi, routes)

**Files:**
- Modify: `lib/db/src/schema/clients.ts`
- Create: `lib/db/src/schema/client-events.ts`
- Modify: `lib/db/src/schema/index.ts`
- Modify: `lib/api-spec/openapi.yaml`
- Modify: `artifacts/api-server/src/routes/clients.ts`
- Create: `artifacts/api-server/src/routes/client-events.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`

- [ ] **Step 1: Extend the clients table with KYC + tax rates + payment terms FK**

Replace the body of `lib/db/src/schema/clients.ts` with:

```ts
import { pgTable, text, serial, timestamp, integer, numeric } from "drizzle-orm/pg-core";
import { buyingHousesTable } from "./buying-houses";
import { paymentTermsTable } from "./payment-terms";
import { kycColumns } from "./kyc-columns";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const clientsTable = pgTable("clients", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  buyingHouseId: integer("buying_house_id")
    .references(() => buyingHousesTable.id, { onDelete: "set null" }),
  ...kycColumns,
  salesTaxPct: numeric("sales_tax_pct", { precision: 6, scale: 2 }),
  withholdingTaxPct: numeric("withholding_tax_pct", { precision: 6, scale: 2 }),
  paymentTermsId: integer("payment_terms_id")
    .references(() => paymentTermsTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertClientSchema = createInsertSchema(clientsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertClient = z.infer<typeof insertClientSchema>;
export type Client = typeof clientsTable.$inferSelect;
```

- [ ] **Step 2: Create the client_events table**

Create `lib/db/src/schema/client-events.ts`:

```ts
import { pgTable, serial, integer, text, numeric, timestamp } from "drizzle-orm/pg-core";
import { clientsTable } from "./clients";
import { costModelsTable } from "./cost-models";

export const clientEventsTable = pgTable("client_events", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  costModelId: integer("cost_model_id").references(() => costModelsTable.id, { onDelete: "set null" }),
  billableRate: numeric("billable_rate", { precision: 12, scale: 4 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ClientEvent = typeof clientEventsTable.$inferSelect;
```

- [ ] **Step 3: Export client_events**

In `lib/db/src/schema/index.ts`, add:

```ts
export * from "./client-events";
```

- [ ] **Step 4: Update the Client schemas in openapi.yaml**

In `lib/api-spec/openapi.yaml`, replace the `Client`, `ClientInput`, `ClientUpdate` schema blocks (lines ~1079–1111) with the following, and add the `ClientEvent*` schemas right after them. The KYC properties block is reused verbatim in `Client`, `ClientInput`, `ClientUpdate`.

```yaml
    Client:
      type: object
      required: [id, name, createdAt]
      properties:
        id: { type: integer }
        name: { type: string }
        buyingHouseId: { type: ["integer", "null"] }
        buyingHouseName: { type: ["string", "null"] }
        address: { type: ["string", "null"] }
        pocName: { type: ["string", "null"] }
        pocNumber: { type: ["string", "null"] }
        pocEmail: { type: ["string", "null"] }
        companyEmail: { type: ["string", "null"] }
        companyNumber: { type: ["string", "null"] }
        bankName: { type: ["string", "null"] }
        bankAccountNumber: { type: ["string", "null"] }
        bankAddress: { type: ["string", "null"] }
        swiftCode: { type: ["string", "null"] }
        iban: { type: ["string", "null"] }
        salesTaxNumber: { type: ["string", "null"] }
        ntnNumber: { type: ["string", "null"] }
        salesTaxPct: { type: ["number", "null"] }
        withholdingTaxPct: { type: ["number", "null"] }
        paymentTermsId: { type: ["integer", "null"] }
        paymentTermName: { type: ["string", "null"] }
        createdAt: { type: string }

    ClientInput:
      type: object
      required: [name]
      properties:
        name: { type: string, minLength: 1 }
        buyingHouseId: { type: ["integer", "null"] }

    ClientUpdate:
      type: object
      properties:
        name: { type: string, minLength: 1 }
        buyingHouseId: { type: ["integer", "null"] }
        address: { type: ["string", "null"] }
        pocName: { type: ["string", "null"] }
        pocNumber: { type: ["string", "null"] }
        pocEmail: { type: ["string", "null"] }
        companyEmail: { type: ["string", "null"] }
        companyNumber: { type: ["string", "null"] }
        bankName: { type: ["string", "null"] }
        bankAccountNumber: { type: ["string", "null"] }
        bankAddress: { type: ["string", "null"] }
        swiftCode: { type: ["string", "null"] }
        iban: { type: ["string", "null"] }
        salesTaxNumber: { type: ["string", "null"] }
        ntnNumber: { type: ["string", "null"] }
        salesTaxPct: { type: ["number", "null"] }
        withholdingTaxPct: { type: ["number", "null"] }
        paymentTermsId: { type: ["integer", "null"] }

    ClientEvent:
      type: object
      required: [id, clientId, name, billableRate, createdAt]
      properties:
        id: { type: integer }
        clientId: { type: integer }
        name: { type: string }
        costModelId: { type: ["integer", "null"] }
        costModelName: { type: ["string", "null"] }
        billableRate: { type: number }
        createdAt: { type: string }

    ClientEventInput:
      type: object
      required: [name, billableRate]
      properties:
        name: { type: string, minLength: 1 }
        costModelId: { type: ["integer", "null"] }
        billableRate: { type: number }

    ClientEventUpdate:
      type: object
      properties:
        name: { type: string, minLength: 1 }
        costModelId: { type: ["integer", "null"] }
        billableRate: { type: number }
```

- [ ] **Step 5: Add client-events paths to openapi.yaml**

Add under `paths:` (after `/clients/{id}` block):

```yaml
  /clients/{id}/events:
    get:
      operationId: listClientEvents
      tags: [clients]
      summary: List events for a client
      parameters:
        - { name: id, in: path, required: true, schema: { type: integer } }
      responses:
        "200":
          description: List of events
          content:
            application/json:
              schema:
                type: array
                items: { $ref: "#/components/schemas/ClientEvent" }
    post:
      operationId: createClientEvent
      tags: [clients]
      summary: Add an event to a client
      parameters:
        - { name: id, in: path, required: true, schema: { type: integer } }
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/ClientEventInput" }
      responses:
        "201":
          description: Created
          content:
            application/json:
              schema: { $ref: "#/components/schemas/ClientEvent" }
        "400": { description: Validation error }

  /clients/{id}/events/{eventId}:
    patch:
      operationId: updateClientEvent
      tags: [clients]
      summary: Update a client event
      parameters:
        - { name: id, in: path, required: true, schema: { type: integer } }
        - { name: eventId, in: path, required: true, schema: { type: integer } }
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/ClientEventUpdate" }
      responses:
        "200":
          description: Updated
          content:
            application/json:
              schema: { $ref: "#/components/schemas/ClientEvent" }
        "404": { description: Not found }
    delete:
      operationId: deleteClientEvent
      tags: [clients]
      summary: Delete a client event
      parameters:
        - { name: id, in: path, required: true, schema: { type: integer } }
        - { name: eventId, in: path, required: true, schema: { type: integer } }
      responses:
        "204": { description: Deleted }
        "404": { description: Not found }
```

- [ ] **Step 6: Regenerate**

Run: `pnpm --filter @workspace/api-spec run codegen`
Expected: PASS.

- [ ] **Step 7: Update the clients route to map + persist the new fields**

In `artifacts/api-server/src/routes/clients.ts`:

1. Extend imports:

```ts
import { db, clientsTable, buyingHousesTable, paymentTermsTable } from "@workspace/db";
```

2. Replace `mapRow` with one that returns all new fields:

```ts
async function mapRow(r: typeof clientsTable.$inferSelect) {
  let buyingHouseName: string | null = null;
  if (r.buyingHouseId != null) {
    const [bh] = await db.select({ name: buyingHousesTable.name }).from(buyingHousesTable).where(eq(buyingHousesTable.id, r.buyingHouseId));
    buyingHouseName = bh?.name ?? null;
  }
  let paymentTermName: string | null = null;
  if (r.paymentTermsId != null) {
    const [pt] = await db.select({ name: paymentTermsTable.name }).from(paymentTermsTable).where(eq(paymentTermsTable.id, r.paymentTermsId));
    paymentTermName = pt?.name ?? null;
  }
  return {
    id: r.id,
    name: r.name,
    buyingHouseId: r.buyingHouseId ?? null,
    buyingHouseName,
    address: r.address, pocName: r.pocName, pocNumber: r.pocNumber, pocEmail: r.pocEmail,
    companyEmail: r.companyEmail, companyNumber: r.companyNumber,
    bankName: r.bankName, bankAccountNumber: r.bankAccountNumber, bankAddress: r.bankAddress,
    swiftCode: r.swiftCode, iban: r.iban,
    salesTaxNumber: r.salesTaxNumber, ntnNumber: r.ntnNumber,
    salesTaxPct: r.salesTaxPct != null ? Number(r.salesTaxPct) : null,
    withholdingTaxPct: r.withholdingTaxPct != null ? Number(r.withholdingTaxPct) : null,
    paymentTermsId: r.paymentTermsId ?? null,
    paymentTermName,
    createdAt: r.createdAt.toISOString(),
  };
}
```

3. Replace the `patch` handler's `updates` builder to handle all editable fields:

```ts
  const d = parsed.data;
  const updates: Record<string, unknown> = {};
  const textKeys = ["name","buyingHouseId","address","pocName","pocNumber","pocEmail","companyEmail","companyNumber","bankName","bankAccountNumber","bankAddress","swiftCode","iban","salesTaxNumber","ntnNumber","paymentTermsId"] as const;
  for (const k of textKeys) if ((d as Record<string, unknown>)[k] !== undefined) updates[k] = (d as Record<string, unknown>)[k];
  if (d.salesTaxPct !== undefined) updates.salesTaxPct = d.salesTaxPct != null ? String(d.salesTaxPct) : null;
  if (d.withholdingTaxPct !== undefined) updates.withholdingTaxPct = d.withholdingTaxPct != null ? String(d.withholdingTaxPct) : null;
```

(The `post` handler is unchanged — create still only takes name + buyingHouseId from `ClientInput`.)

- [ ] **Step 8: Create the client-events route**

Create `artifacts/api-server/src/routes/client-events.ts`:

```ts
import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, clientEventsTable, costModelsTable } from "@workspace/db";
import {
  ListClientEventsParams,
  ListClientEventsResponse,
  CreateClientEventParams,
  CreateClientEventBody,
  CreateClientEventResponse,
  UpdateClientEventParams,
  UpdateClientEventBody,
  UpdateClientEventResponse,
  DeleteClientEventParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function mapEvent(r: typeof clientEventsTable.$inferSelect) {
  let costModelName: string | null = null;
  if (r.costModelId != null) {
    const [cm] = await db.select({ name: costModelsTable.name }).from(costModelsTable).where(eq(costModelsTable.id, r.costModelId));
    costModelName = cm?.name ?? null;
  }
  return {
    id: r.id,
    clientId: r.clientId,
    name: r.name,
    costModelId: r.costModelId ?? null,
    costModelName,
    billableRate: Number(r.billableRate),
    createdAt: r.createdAt.toISOString(),
  };
}

router.get("/clients/:id/events", async (req, res): Promise<void> => {
  const params = ListClientEventsParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const rows = await db.select().from(clientEventsTable)
    .where(eq(clientEventsTable.clientId, params.data.id))
    .orderBy(clientEventsTable.createdAt);
  res.json(ListClientEventsResponse.parse(await Promise.all(rows.map(mapEvent))));
});

router.post("/clients/:id/events", async (req, res): Promise<void> => {
  const params = CreateClientEventParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = CreateClientEventBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [row] = await db.insert(clientEventsTable).values({
    clientId: params.data.id,
    name: parsed.data.name,
    costModelId: parsed.data.costModelId ?? null,
    billableRate: String(parsed.data.billableRate),
  }).returning();
  res.status(201).json(CreateClientEventResponse.parse(await mapEvent(row)));
});

router.patch("/clients/:id/events/:eventId", async (req, res): Promise<void> => {
  const params = UpdateClientEventParams.safeParse({
    id: parseInt(req.params.id as string, 10),
    eventId: parseInt(req.params.eventId as string, 10),
  });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateClientEventBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const updates: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.costModelId !== undefined) updates.costModelId = parsed.data.costModelId;
  if (parsed.data.billableRate !== undefined) updates.billableRate = String(parsed.data.billableRate);
  const [row] = await db.update(clientEventsTable).set(updates)
    .where(and(eq(clientEventsTable.id, params.data.eventId), eq(clientEventsTable.clientId, params.data.id)))
    .returning();
  if (!row) { res.status(404).json({ error: "Event not found" }); return; }
  res.json(UpdateClientEventResponse.parse(await mapEvent(row)));
});

router.delete("/clients/:id/events/:eventId", async (req, res): Promise<void> => {
  const params = DeleteClientEventParams.safeParse({
    id: parseInt(req.params.id as string, 10),
    eventId: parseInt(req.params.eventId as string, 10),
  });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [row] = await db.delete(clientEventsTable)
    .where(and(eq(clientEventsTable.id, params.data.eventId), eq(clientEventsTable.clientId, params.data.id)))
    .returning();
  if (!row) { res.status(404).json({ error: "Event not found" }); return; }
  res.sendStatus(204);
});

export default router;
```

- [ ] **Step 9: Register the client-events router**

In `artifacts/api-server/src/routes/index.ts` add `import clientEventsRouter from "./client-events";` and `router.use(clientEventsRouter);` (after `router.use(clientsRouter);`).

- [ ] **Step 10: Verify typecheck**

Run: `pnpm run typecheck`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add lib/db/src/schema/clients.ts lib/db/src/schema/client-events.ts lib/db/src/schema/index.ts lib/api-spec/openapi.yaml lib/api-zod lib/api-client-react artifacts/api-server/src/routes/clients.ts artifacts/api-server/src/routes/client-events.ts artifacts/api-server/src/routes/index.ts
git commit -m "feat(client): KYC + taxes + payment terms + events (db, api)"
```

---

## Phase 4 — Buying House: add KYC, drop tax rates (schema, openapi, route)

**Files:**
- Modify: `lib/db/src/schema/buying-houses.ts`
- Modify: `lib/api-spec/openapi.yaml`
- Modify: `artifacts/api-server/src/routes/buying-houses.ts`

- [ ] **Step 1: Update the buying_houses table**

Replace `lib/db/src/schema/buying-houses.ts` with:

```ts
import { pgTable, text, serial, timestamp, numeric } from "drizzle-orm/pg-core";
import { kycColumns } from "./kyc-columns";

export const buyingHousesTable = pgTable("buying_houses", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  ...kycColumns,
  bulkDiscountPct: numeric("bulk_discount_pct", { precision: 6, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BuyingHouse = typeof buyingHousesTable.$inferSelect;
```

- [ ] **Step 2: Update BuyingHouse schemas in openapi.yaml**

Replace `BuyingHouse` and `BuyingHouseInput` (lines ~1114–1151) with:

```yaml
    BuyingHouse:
      type: object
      required: [id, name, clientCount, netMarginPkr, createdAt]
      properties:
        id: { type: integer }
        name: { type: string }
        clientCount: { type: integer }
        netMarginPkr: { type: number }
        bulkDiscountPct: { type: ["number", "null"] }
        address: { type: ["string", "null"] }
        pocName: { type: ["string", "null"] }
        pocNumber: { type: ["string", "null"] }
        pocEmail: { type: ["string", "null"] }
        companyEmail: { type: ["string", "null"] }
        companyNumber: { type: ["string", "null"] }
        bankName: { type: ["string", "null"] }
        bankAccountNumber: { type: ["string", "null"] }
        bankAddress: { type: ["string", "null"] }
        swiftCode: { type: ["string", "null"] }
        iban: { type: ["string", "null"] }
        salesTaxNumber: { type: ["string", "null"] }
        ntnNumber: { type: ["string", "null"] }
        createdAt: { type: string }

    BuyingHouseInput:
      type: object
      required: [name]
      properties:
        name: { type: string, minLength: 1 }
        bulkDiscountPct: { type: ["number", "null"] }
        address: { type: ["string", "null"] }
        pocName: { type: ["string", "null"] }
        pocNumber: { type: ["string", "null"] }
        pocEmail: { type: ["string", "null"] }
        companyEmail: { type: ["string", "null"] }
        companyNumber: { type: ["string", "null"] }
        bankName: { type: ["string", "null"] }
        bankAccountNumber: { type: ["string", "null"] }
        bankAddress: { type: ["string", "null"] }
        swiftCode: { type: ["string", "null"] }
        iban: { type: ["string", "null"] }
        salesTaxNumber: { type: ["string", "null"] }
        ntnNumber: { type: ["string", "null"] }
```

> Note: this BuyingHouseInput now serves both create and update. Confirm the `/buying-houses/{id}` PATCH operation references `BuyingHouseInput` (or add a `BuyingHouseUpdate` mirror if it references a distinct update schema — check the path block at lines ~672–733 and keep it consistent).

- [ ] **Step 3: Regenerate**

Run: `pnpm --filter @workspace/api-spec run codegen`
Expected: PASS.

- [ ] **Step 4: Update the buying-houses route**

Read `artifacts/api-server/src/routes/buying-houses.ts` first. Then:
- In the row→response mapper, remove `salesTaxPct`, `withholdingTaxPct`, `remittanceTaxPct`; add the 13 KYC fields (passthrough, e.g. `address: r.address, ...`) and keep `bulkDiscountPct` (parse with `r.bulkDiscountPct != null ? Number(r.bulkDiscountPct) : null`).
- In create/update handlers, drop the three removed tax-rate fields; persist KYC fields (passthrough strings) and `bulkDiscountPct` (`String(...)` when not null).
- Any analytics/computeRow code in this route that read the removed BH tax rates must pass `0` instead (e.g. `salesTaxPct: 0, remittanceTaxPct: 0, withholdingTaxPct: 0` in `computeRow` calls).

- [ ] **Step 5: Verify typecheck**

Run: `pnpm run typecheck`
Expected: PASS. (If the buying-house analytics route or `BuyingHouseAnalytics` consumers break on the removed fields, fix by passing `0` for those `computeRow` inputs.)

- [ ] **Step 6: Commit**

```bash
git add lib/db/src/schema/buying-houses.ts lib/api-spec/openapi.yaml lib/api-zod lib/api-client-react artifacts/api-server/src/routes/buying-houses.ts
git commit -m "feat(buying-house): add KYC, drop sales/withholding/remittance tax rates"
```

---

## Phase 5 — Partner config: drop legacy cost models, add payment-terms FK + partner_clients + payouts (schema, openapi, routes)

> This phase still uses the name "platform" in DB/API (rename happens in Phase 6). It changes the platform's relationships and repoints billing.

**Files:**
- Modify: `lib/db/src/schema/platforms.ts`
- Delete: `lib/db/src/schema/platform-cost-models.ts`
- Modify: `lib/db/src/schema/billing-records.ts`
- Create: `lib/db/src/schema/partner-clients.ts`
- Create: `lib/db/src/schema/partner-event-payouts.ts`
- Modify: `lib/db/src/schema/index.ts`
- Modify: `lib/api-spec/openapi.yaml`
- Delete: `artifacts/api-server/src/routes/platform-cost-models.ts`
- Modify: `artifacts/api-server/src/routes/platforms.ts`, `billing-records.ts`, `billing.ts`, `index.ts`
- Create: `artifacts/api-server/src/routes/partner-config.ts`

- [ ] **Step 1: Update platforms table (payment terms FK, drop bulk discount)**

Replace `lib/db/src/schema/platforms.ts` with (still named `platforms` until Phase 6):

```ts
import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { kycColumns } from "./kyc-columns";
import { paymentTermsTable } from "./payment-terms";

export const platformsTable = pgTable("platforms", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  ...kycColumns,
  paymentTermsId: integer("payment_terms_id")
    .references(() => paymentTermsTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type Platform = typeof platformsTable.$inferSelect;
```

- [ ] **Step 2: Repoint billing_records.costModelId to the global cost_models table; delete platform-cost-models schema**

In `lib/db/src/schema/billing-records.ts`:
- Replace the import `import { platformCostModelsTable } from "./platform-cost-models";` with `import { costModelsTable } from "./cost-models";`.
- Change the `costModelId` FK reference from `platformCostModelsTable.id` to `costModelsTable.id`.

Then delete `lib/db/src/schema/platform-cost-models.ts` and remove its `export * from "./platform-cost-models";` line from `lib/db/src/schema/index.ts`.

- [ ] **Step 3: Create partner_clients + partner_event_payouts tables**

Create `lib/db/src/schema/partner-clients.ts`:

```ts
import { pgTable, serial, integer, timestamp, unique } from "drizzle-orm/pg-core";
import { platformsTable } from "./platforms";
import { clientsTable } from "./clients";

export const partnerClientsTable = pgTable("partner_clients", {
  id: serial("id").primaryKey(),
  partnerId: integer("partner_id").notNull().references(() => platformsTable.id, { onDelete: "cascade" }),
  clientId: integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ uniqPartnerClient: unique().on(t.partnerId, t.clientId) }));

export type PartnerClient = typeof partnerClientsTable.$inferSelect;
```

Create `lib/db/src/schema/partner-event-payouts.ts`:

```ts
import { pgTable, serial, integer, numeric, timestamp, unique } from "drizzle-orm/pg-core";
import { platformsTable } from "./platforms";
import { clientEventsTable } from "./client-events";

export const partnerEventPayoutsTable = pgTable("partner_event_payouts", {
  id: serial("id").primaryKey(),
  partnerId: integer("partner_id").notNull().references(() => platformsTable.id, { onDelete: "cascade" }),
  clientEventId: integer("client_event_id").notNull().references(() => clientEventsTable.id, { onDelete: "cascade" }),
  payoutRate: numeric("payout_rate", { precision: 12, scale: 4 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ uniqPartnerEvent: unique().on(t.partnerId, t.clientEventId) }));

export type PartnerEventPayout = typeof partnerEventPayoutsTable.$inferSelect;
```

Add to `lib/db/src/schema/index.ts`:

```ts
export * from "./partner-clients";
export * from "./partner-event-payouts";
```

- [ ] **Step 4: Update Platform/billing schemas in openapi.yaml; remove PlatformCostModel; add partner-config schemas**

In `lib/api-spec/openapi.yaml`:
- `Platform`: remove `bulkDiscountPct`, `costModels`, and the legacy `paymentTerms` (text) property; add `paymentTermsId: { type: ["integer","null"] }` and `paymentTermName: { type: ["string","null"] }`. (Keep all KYC props.)
- `PlatformInput`: reduce to name-only — leave `PlatformInput` as `{ name }` (the create dialog is name-only). Remove `bulkDiscountPct`/`paymentTerms` if present.
- `PlatformUpdate`: remove `bulkDiscountPct` and the legacy `paymentTerms` (text) property; add `paymentTermsId: { type: ["integer","null"] }`. (KYC props already present.)
- Delete `PlatformCostModel`, `PlatformCostModelInput`, `PlatformCostModelUpdate` schemas and the `/platforms/{id}/cost-models` + `/platforms/{id}/cost-models/{cmId}` paths.
- `BillingRecord`: `costModelPayoutRate` and `costModelMarginPct` stay as `["number","null"]` (now always null). No structural change required beyond Phase 6's `platformId`→`partnerId` rename.
- Add these schemas:

```yaml
    PartnerClientEvent:
      type: object
      required: [clientEventId, eventName, billableRate]
      properties:
        clientEventId: { type: integer }
        eventName: { type: string }
        costModelName: { type: ["string", "null"] }
        billableRate: { type: number }
        payoutRate: { type: ["number", "null"] }

    PartnerClient:
      type: object
      required: [clientId, clientName, events]
      properties:
        clientId: { type: integer }
        clientName: { type: string }
        buyingHouseId: { type: ["integer", "null"] }
        buyingHouseName: { type: ["string", "null"] }
        events:
          type: array
          items: { $ref: "#/components/schemas/PartnerClientEvent" }

    LinkPartnerClientInput:
      type: object
      required: [clientId]
      properties:
        clientId: { type: integer }

    PartnerPayoutInput:
      type: object
      required: [clientEventId, payoutRate]
      properties:
        clientEventId: { type: integer }
        payoutRate: { type: number }
```

- Add these paths (still under `/platforms/{id}` namespace; renamed in Phase 6):

```yaml
  /platforms/{id}/clients:
    get:
      operationId: listPartnerClients
      tags: [platforms]
      summary: List clients served by a partner, with events + payouts
      parameters:
        - { name: id, in: path, required: true, schema: { type: integer } }
      responses:
        "200":
          description: Partner clients
          content:
            application/json:
              schema:
                type: array
                items: { $ref: "#/components/schemas/PartnerClient" }
    post:
      operationId: linkPartnerClient
      tags: [platforms]
      summary: Add a client to a partner
      parameters:
        - { name: id, in: path, required: true, schema: { type: integer } }
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/LinkPartnerClientInput" }
      responses:
        "201": { description: Linked }
        "400": { description: Validation error }

  /platforms/{id}/clients/{clientId}:
    delete:
      operationId: unlinkPartnerClient
      tags: [platforms]
      summary: Remove a client from a partner (also clears its payouts)
      parameters:
        - { name: id, in: path, required: true, schema: { type: integer } }
        - { name: clientId, in: path, required: true, schema: { type: integer } }
      responses:
        "204": { description: Removed }
        "404": { description: Not found }

  /platforms/{id}/payouts:
    put:
      operationId: upsertPartnerPayout
      tags: [platforms]
      summary: Set the payout rate for one of a partner's client events
      parameters:
        - { name: id, in: path, required: true, schema: { type: integer } }
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/PartnerPayoutInput" }
      responses:
        "200": { description: Saved }
        "400": { description: Validation error }
```

- [ ] **Step 5: Regenerate**

Run: `pnpm --filter @workspace/api-spec run codegen`
Expected: PASS.

- [ ] **Step 6: Delete platform-cost-models route; update platforms route**

- Delete `artifacts/api-server/src/routes/platform-cost-models.ts`.
- In `artifacts/api-server/src/routes/index.ts`, remove the `platformCostModelsRouter` import + `router.use(platformCostModelsRouter);`.
- In `artifacts/api-server/src/routes/platforms.ts`:
  - Remove the `platformCostModelsTable` import and the `costModels` query + field in `mapRow`. Add `paymentTermsTable` import and resolve `paymentTermName` (mirror the client route's pattern). Remove `bulkDiscountPct` handling; add `paymentTermsId` to the patch updates (passthrough integer/null) and KYC passthrough fields.

- [ ] **Step 7: Repoint billing routes off platform_cost_models**

In `artifacts/api-server/src/routes/billing-records.ts` and `artifacts/api-server/src/routes/billing.ts`:
- Replace `platformCostModelsTable` import with `costModelsTable`.
- In `billing-records.ts` `mapRecord`: fetch the name from `costModelsTable`; set `costModelPayoutRate: null` and `costModelMarginPct: null` (global cost models have no rates).
- In `billing.ts`: change the `leftJoin(platformCostModelsTable, ...)` to `leftJoin(costModelsTable, eq(billingRecordsTable.costModelId, costModelsTable.id))`; select `costModelName: costModelsTable.name`; drop `costModelPayoutRate`/`costModelMarginPct` selects and set both to `null` in the mapped object.

- [ ] **Step 8: Create the partner-config route**

Create `artifacts/api-server/src/routes/partner-config.ts`:

```ts
import { Router, type IRouter } from "express";
import { and, eq, inArray } from "drizzle-orm";
import {
  db, partnerClientsTable, partnerEventPayoutsTable,
  clientsTable, clientEventsTable, buyingHousesTable, costModelsTable,
} from "@workspace/db";
import {
  ListPartnerClientsParams,
  ListPartnerClientsResponse,
  LinkPartnerClientParams,
  LinkPartnerClientBody,
  UnlinkPartnerClientParams,
  UpsertPartnerPayoutParams,
  UpsertPartnerPayoutBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/platforms/:id/clients", async (req, res): Promise<void> => {
  const params = ListPartnerClientsParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const partnerId = params.data.id;

  const links = await db.select().from(partnerClientsTable)
    .where(eq(partnerClientsTable.partnerId, partnerId))
    .orderBy(partnerClientsTable.createdAt);
  if (links.length === 0) { res.json(ListPartnerClientsResponse.parse([])); return; }

  const payouts = await db.select().from(partnerEventPayoutsTable)
    .where(eq(partnerEventPayoutsTable.partnerId, partnerId));
  const payoutByEvent = new Map(payouts.map(p => [p.clientEventId, Number(p.payoutRate)]));

  const out = [];
  for (const link of links) {
    const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, link.clientId));
    if (!client) continue;
    let buyingHouseName: string | null = null;
    if (client.buyingHouseId != null) {
      const [bh] = await db.select({ name: buyingHousesTable.name }).from(buyingHousesTable).where(eq(buyingHousesTable.id, client.buyingHouseId));
      buyingHouseName = bh?.name ?? null;
    }
    const events = await db.select().from(clientEventsTable)
      .where(eq(clientEventsTable.clientId, client.id)).orderBy(clientEventsTable.createdAt);
    const cmIds = events.map(e => e.costModelId).filter((x): x is number => x != null);
    const cms = cmIds.length ? await db.select().from(costModelsTable).where(inArray(costModelsTable.id, cmIds)) : [];
    const cmName = new Map(cms.map(c => [c.id, c.name]));
    out.push({
      clientId: client.id,
      clientName: client.name,
      buyingHouseId: client.buyingHouseId ?? null,
      buyingHouseName,
      events: events.map(e => ({
        clientEventId: e.id,
        eventName: e.name,
        costModelName: e.costModelId != null ? (cmName.get(e.costModelId) ?? null) : null,
        billableRate: Number(e.billableRate),
        payoutRate: payoutByEvent.has(e.id) ? payoutByEvent.get(e.id)! : null,
      })),
    });
  }
  res.json(ListPartnerClientsResponse.parse(out));
});

router.post("/platforms/:id/clients", async (req, res): Promise<void> => {
  const params = LinkPartnerClientParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = LinkPartnerClientBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  await db.insert(partnerClientsTable)
    .values({ partnerId: params.data.id, clientId: parsed.data.clientId })
    .onConflictDoNothing();
  res.sendStatus(201);
});

router.delete("/platforms/:id/clients/:clientId", async (req, res): Promise<void> => {
  const params = UnlinkPartnerClientParams.safeParse({
    id: parseInt(req.params.id as string, 10),
    clientId: parseInt(req.params.clientId as string, 10),
  });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const partnerId = params.data.id;
  const clientId = params.data.clientId;

  // Remove payouts for this partner's events belonging to the client, then the link.
  const events = await db.select({ id: clientEventsTable.id }).from(clientEventsTable).where(eq(clientEventsTable.clientId, clientId));
  const eventIds = events.map(e => e.id);
  if (eventIds.length) {
    await db.delete(partnerEventPayoutsTable).where(and(
      eq(partnerEventPayoutsTable.partnerId, partnerId),
      inArray(partnerEventPayoutsTable.clientEventId, eventIds),
    ));
  }
  const [row] = await db.delete(partnerClientsTable).where(and(
    eq(partnerClientsTable.partnerId, partnerId),
    eq(partnerClientsTable.clientId, clientId),
  )).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.sendStatus(204);
});

router.put("/platforms/:id/payouts", async (req, res): Promise<void> => {
  const params = UpsertPartnerPayoutParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpsertPartnerPayoutBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  await db.insert(partnerEventPayoutsTable).values({
    partnerId: params.data.id,
    clientEventId: parsed.data.clientEventId,
    payoutRate: String(parsed.data.payoutRate),
  }).onConflictDoUpdate({
    target: [partnerEventPayoutsTable.partnerId, partnerEventPayoutsTable.clientEventId],
    set: { payoutRate: String(parsed.data.payoutRate) },
  });
  res.sendStatus(200);
});

export default router;
```

- [ ] **Step 9: Register the partner-config router**

In `artifacts/api-server/src/routes/index.ts` add `import partnerConfigRouter from "./partner-config";` and `router.use(partnerConfigRouter);` (after `router.use(platformsRouter);`).

- [ ] **Step 10: Verify typecheck**

Run: `pnpm run typecheck`
Expected: PASS. Fix any remaining references to `platformCostModelsTable` (search the api-server for it — there should be none left).

- [ ] **Step 11: Commit**

```bash
git add lib/db lib/api-spec/openapi.yaml lib/api-zod lib/api-client-react artifacts/api-server/src/routes
git commit -m "feat(partner): payment-terms FK, partner_clients + payouts, drop per-partner cost models, repoint billing to global cost models"
```

---

## Phase 6 — Full rename: Platforms → Partners (DB, API, generated, server, permissions)

> Mechanical rename using the identifier map at the top. Do NOT change behavior. Work file-by-file, then regenerate, then typecheck.

**Files (DB/spec/server):** `lib/db/src/schema/platforms.ts` → `partners.ts`, `lib/db/src/schema/{campaigns,billing-records,partner-clients,partner-event-payouts,index}.ts`, `lib/api-spec/openapi.yaml`, all `artifacts/api-server/src/routes/*` referencing platform, `artifacts/api-server/src/lib/seed.ts`-adjacent permission strings.

- [ ] **Step 1: Rename the DB table file + symbol**

- Rename file `lib/db/src/schema/platforms.ts` → `lib/db/src/schema/partners.ts`.
- Inside: `platformsTable` → `partnersTable`; pgTable name `"platforms"` → `"partners"`; type `Platform` → `Partner`.
- Update `lib/db/src/schema/index.ts`: `export * from "./platforms";` → `export * from "./partners";`.
- Update importers: `campaigns.ts` (`platformsTable`→`partnersTable`, column `platform_id`→`partner_id`, prop `platformId`→`partnerId`), `billing-records.ts` (`platformId`/`platform_id`→`partnerId`/`partner_id`, `platformBulkDiscountPct`/`platform_bulk_discount_pct`→`partnerBulkDiscountPct`/`partner_bulk_discount_pct`, import path `./platforms`→`./partners`), `partner-clients.ts` + `partner-event-payouts.ts` (import `./platforms`→`./partners`, `platformsTable`→`partnersTable`).

- [ ] **Step 2: Rename in openapi.yaml**

In `lib/api-spec/openapi.yaml`, apply the rename map:
- Paths `/platforms` → `/partners`, `/platforms/{id}…` → `/partners/{id}…` (including the `clients`/`payouts`/`billing-records` sub-paths added earlier).
- operationIds: `listPlatforms`→`listPartners`, `getPlatform`→`getPartner`, `createPlatform`→`createPartner`, `updatePlatform`→`updatePartner`, `deletePlatform`→`deletePartner`. (Leave `listPartnerClients`/`linkPartnerClient`/`unlinkPartnerClient`/`upsertPartnerPayout`/`listBillingRecords` as-is.)
- Schemas: `Platform`→`Partner`, `PlatformInput`→`PartnerInput`, `PlatformUpdate`→`PartnerUpdate`, `PlatformAnalytics`→`PartnerAnalytics`. Update all `$ref`s.
- Property renames across schemas: `platformId`→`partnerId`, `platformName`→`partnerName`, `platformBulkDiscountPct`→`partnerBulkDiscountPct` (in `BillingRecord`, `BillingRecordInput`, `Campaign`, `BuyingHouseBillingRecord`, analytics params, etc.).
- Analytics path `/analytics/by-platform` → `/analytics/by-partner` and its `operationId`/`getAnalyticsByPlatformParams` accordingly; query param `platformId`→`partnerId`.
- tags `platforms` → `partners`.

- [ ] **Step 3: Regenerate**

Run: `pnpm --filter @workspace/api-spec run codegen`
Expected: PASS. Generated hooks become `useListPartners`, `useGetPartner`, etc.; zod becomes `Partner`, `CreatePartnerBody`, etc.

- [ ] **Step 4: Rename across api-server routes**

- Rename file `artifacts/api-server/src/routes/platforms.ts` → `partners.ts`; inside, rename router var, route paths `/platforms`→`/partners`, zod imports `*Platform*`→`*Partner*`, table `platformsTable`→`partnersTable`.
- In `index.ts`: import path/name `platformsRouter`→`partnersRouter` from `./partners`.
- Update every other route that references platform identifiers (`billing.ts`, `billing-records.ts`, `analytics.ts`, `partner-config.ts`, `transactions.ts` if present): apply the rename map. Note `billing-records.ts` route paths move `/platforms/{id}/billing-records`→`/partners/{id}/billing-records`; `partner-config.ts` paths move `/platforms/{id}/…`→`/partners/{id}/…`.
- `computeRow.ts` (api-server lib): rename the `platformBulkDiscountPct` input field → `partnerBulkDiscountPct` (and update all callers).

- [ ] **Step 5: Verify typecheck (libs + server)**

Run: `pnpm run typecheck`
Expected: PASS for `lib/*` and `artifacts/api-server`. (The adops UI is renamed in Phase 7 and may still fail here — if so, note which adops files reference old names and proceed to Phase 7. Prefer to run Phases 6 + 7 back-to-back before declaring green.)

- [ ] **Step 6: Commit**

```bash
git add lib artifacts/api-server
git commit -m "refactor: rename Platforms -> Partners across db, api spec, generated client, server"
```

---

## Phase 7 — UI: Partners rename + KYC/onboarding screens

**Files:** `artifacts/adops/src/App.tsx`, `components/layout/Sidebar.tsx`, `pages/Platforms.tsx`→`Partners.tsx`, `pages/PlatformDetail.tsx`→`PartnerDetail.tsx`, `pages/PlatformDetail/*`→`pages/PartnerDetail/*`, `pages/Clients.tsx`, `pages/ClientDetail.tsx`, `pages/BuyingHouses.tsx`, `pages/BuyingHouseDetail.tsx`, `pages/Billings.tsx`, `pages/Transactions.tsx`, `pages/Dashboard.tsx`, `pages/Analytics.tsx`, `lib/auth.ts`, `lib/computeRow.ts`. Create: `components/KycFields.tsx`.

- [ ] **Step 1: Permissions rename**

In `artifacts/adops/src/lib/auth.ts`, in `ALL_PERMISSIONS`, change `"View Platforms"`→`"View Partners"` and `"Edit Platforms"`→`"Edit Partners"`.

- [ ] **Step 2: Routes + nav rename**

- `App.tsx`: imports `PlatformsPage`/`PlatformDetailPage` → `PartnersPage`/`PartnerDetailPage` from `@/pages/Partners` / `@/pages/PartnerDetail`; routes `/platforms`→`/partners`, `/platforms/:id`→`/partners/:id`; permission strings `View Platforms`→`View Partners`.
- `Sidebar.tsx`: in `topNavItems`, change `{ href: "/platforms", label: "Platforms", icon: Monitor, permission: "View Platforms" }` → `{ href: "/partners", label: "Partners", icon: Monitor, permission: "View Partners" }`.

- [ ] **Step 3: Create the shared KYC form component**

Create `artifacts/adops/src/components/KycFields.tsx`:

```tsx
import { Input } from "@/components/ui/input";

export type KycState = {
  address: string; pocName: string; pocNumber: string; pocEmail: string;
  companyEmail: string; companyNumber: string;
  bankName: string; bankAccountNumber: string; bankAddress: string; swiftCode: string; iban: string;
  salesTaxNumber: string; ntnNumber: string;
};

export const EMPTY_KYC: KycState = {
  address: "", pocName: "", pocNumber: "", pocEmail: "",
  companyEmail: "", companyNumber: "",
  bankName: "", bankAccountNumber: "", bankAddress: "", swiftCode: "", iban: "",
  salesTaxNumber: "", ntnNumber: "",
};

const s = (v: string | null | undefined) => v ?? "";

export function kycFromRecord(r: Partial<Record<keyof KycState, string | null>>): KycState {
  return {
    address: s(r.address), pocName: s(r.pocName), pocNumber: s(r.pocNumber), pocEmail: s(r.pocEmail),
    companyEmail: s(r.companyEmail), companyNumber: s(r.companyNumber),
    bankName: s(r.bankName), bankAccountNumber: s(r.bankAccountNumber), bankAddress: s(r.bankAddress),
    swiftCode: s(r.swiftCode), iban: s(r.iban),
    salesTaxNumber: s(r.salesTaxNumber), ntnNumber: s(r.ntnNumber),
  };
}

/** Convert KYC state to a nullable-string payload for PATCH (empty -> null). */
export function kycToPayload(k: KycState): Record<keyof KycState, string | null> {
  const o = {} as Record<keyof KycState, string | null>;
  (Object.keys(k) as (keyof KycState)[]).forEach((key) => {
    const t = k[key].trim();
    o[key] = t === "" ? null : t;
  });
  return o;
}

const phoneFilter = (v: string) => v.replace(/[^+\d\s()\-]/g, "");

function Field({ label, value, onChange, disabled, type = "text", filterFn }: {
  label: string; value: string; onChange: (v: string) => void; disabled: boolean;
  type?: string; filterFn?: (v: string) => string;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Input type={type} value={value} disabled={disabled}
        onChange={(e) => onChange(filterFn ? filterFn(e.target.value) : e.target.value)} />
    </label>
  );
}

export function KycFields({ value, onChange, disabled }: {
  value: KycState; onChange: (next: KycState) => void; disabled: boolean;
}) {
  const set = (key: keyof KycState) => (v: string) => onChange({ ...value, [key]: v });
  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-card p-5">
        <h3 className="mb-4 text-sm font-semibold text-foreground">Contact</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Address" value={value.address} onChange={set("address")} disabled={disabled} />
          <Field label="Company Email" type="email" value={value.companyEmail} onChange={set("companyEmail")} disabled={disabled} />
          <Field label="Company Number" type="tel" value={value.companyNumber} onChange={set("companyNumber")} disabled={disabled} filterFn={phoneFilter} />
          <Field label="POC Name" value={value.pocName} onChange={set("pocName")} disabled={disabled} />
          <Field label="POC Number" type="tel" value={value.pocNumber} onChange={set("pocNumber")} disabled={disabled} filterFn={phoneFilter} />
          <Field label="POC Email" type="email" value={value.pocEmail} onChange={set("pocEmail")} disabled={disabled} />
        </div>
      </div>
      <div className="rounded-lg border border-border bg-card p-5">
        <h3 className="mb-4 text-sm font-semibold text-foreground">Banking & Legal</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Bank Name" value={value.bankName} onChange={set("bankName")} disabled={disabled} />
          <Field label="Account Number" value={value.bankAccountNumber} onChange={set("bankAccountNumber")} disabled={disabled} />
          <Field label="Bank Address" value={value.bankAddress} onChange={set("bankAddress")} disabled={disabled} />
          <Field label="SWIFT" value={value.swiftCode} onChange={set("swiftCode")} disabled={disabled} />
          <Field label="IBAN" value={value.iban} onChange={set("iban")} disabled={disabled} />
          <Field label="Sales Tax Number" value={value.salesTaxNumber} onChange={set("salesTaxNumber")} disabled={disabled} />
          <Field label="NTN Number" value={value.ntnNumber} onChange={set("ntnNumber")} disabled={disabled} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Rename the Partners list + detail pages (mechanical)**

- Rename `pages/Platforms.tsx` → `pages/Partners.tsx`: component `PlatformsPage`→`PartnersPage`; hooks `useListPlatforms`/`useCreatePlatform`/`useUpdatePlatform`/`useDeletePlatform`/`getListPlatformsQueryKey` → `*Partners*`/`*Partner*`; permission `Edit Platforms`→`Edit Partners`; links `/platforms`→`/partners`; visible text "Platform(s)"→"Partner(s)". The create dialog should be **name-only** (drop any extra fields).
- Rename `pages/PlatformDetail.tsx` → `pages/PartnerDetail.tsx` and folder `pages/PlatformDetail/` → `pages/PartnerDetail/`. Update imports to `./PartnerDetail/...`, `useGetPlatform`→`useGetPartner`, link `/platforms`→`/partners`, text.

- [ ] **Step 5: Partner Details tab — KYC + payment terms, drop cost models**

Rewrite `pages/PartnerDetail/DetailsTab.tsx` to use the shared `KycFields`, a payment-terms dropdown (from `useListPaymentTerms`), and a Save that PATCHes the partner. Remove all cost-model state/UI/mutations. Reference implementation:

```tsx
import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { type Partner, useUpdatePartner, useListPaymentTerms, getGetPartnerQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { hasPermission } from "@/lib/auth";
import { KycFields, kycFromRecord, kycToPayload, type KycState } from "@/components/KycFields";

export default function PartnerDetailsTab({ partner }: { partner: Partner }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const canEdit = hasPermission("Edit Partners");
  const { data: paymentTerms } = useListPaymentTerms();
  const updatePartner = useUpdatePartner();

  const [kyc, setKyc] = useState<KycState>(() => kycFromRecord(partner));
  const [paymentTermsId, setPaymentTermsId] = useState<string>(partner.paymentTermsId != null ? String(partner.paymentTermsId) : "none");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setKyc(kycFromRecord(partner));
    setPaymentTermsId(partner.paymentTermsId != null ? String(partner.paymentTermsId) : "none");
  }, [partner]);

  async function handleSave() {
    setSaving(true);
    try {
      await updatePartner.mutateAsync({ id: partner.id, data: {
        ...kycToPayload(kyc),
        paymentTermsId: paymentTermsId === "none" ? null : parseInt(paymentTermsId, 10),
      }});
      await qc.invalidateQueries({ queryKey: getGetPartnerQueryKey(partner.id) });
      toast({ title: "Changes saved" });
    } catch { toast({ title: "Failed to save changes", variant: "destructive" }); }
    finally { setSaving(false); }
  }

  return (
    <div className="space-y-6">
      <KycFields value={kyc} onChange={setKyc} disabled={!canEdit} />
      <div className="rounded-lg border border-border bg-card p-5 max-w-xs space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">Payment Terms</span>
        <Select value={paymentTermsId} onValueChange={setPaymentTermsId} disabled={!canEdit}>
          <SelectTrigger><SelectValue placeholder="Select payment terms" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None</SelectItem>
            {(paymentTerms ?? []).map(pt => <SelectItem key={pt.id} value={String(pt.id)}>{pt.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {canEdit && <div className="flex justify-end"><Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save Changes"}</Button></div>}
    </div>
  );
}
```

- [ ] **Step 6: Partner Clients tab (new) — select client, fetch events, set payout rates**

Create `pages/PartnerDetail/ClientsTab.tsx`:

```tsx
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListPartnerClients, useLinkPartnerClient, useUnlinkPartnerClient, useUpsertPartnerPayout,
  useListClients, getListPartnerClientsQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { hasPermission } from "@/lib/auth";

export default function PartnerClientsTab({ partnerId }: { partnerId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const canEdit = hasPermission("Edit Partners");
  const invalidate = () => qc.invalidateQueries({ queryKey: getListPartnerClientsQueryKey(partnerId) });

  const { data: partnerClients } = useListPartnerClients(partnerId);
  const { data: allClients } = useListClients();
  const link = useLinkPartnerClient({ mutation: { onSuccess: () => { invalidate(); toast({ title: "Client added" }); } } });
  const unlink = useUnlinkPartnerClient({ mutation: { onSuccess: () => { invalidate(); toast({ title: "Client removed" }); } } });
  const upsert = useUpsertPartnerPayout({ mutation: { onSuccess: () => toast({ title: "Payout saved" }) } });

  const [selectClient, setSelectClient] = useState("");
  const linkedIds = new Set((partnerClients ?? []).map(pc => pc.clientId));
  const available = (allClients ?? []).filter(c => !linkedIds.has(c.id));

  return (
    <div className="space-y-6">
      {canEdit && (
        <div className="flex gap-2 max-w-md">
          <Select value={selectClient} onValueChange={setSelectClient}>
            <SelectTrigger><SelectValue placeholder="Select a client to add" /></SelectTrigger>
            <SelectContent>
              {available.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button disabled={!selectClient} onClick={() => { link.mutate({ id: partnerId, data: { clientId: parseInt(selectClient, 10) } }); setSelectClient(""); }}>Add</Button>
        </div>
      )}

      {(partnerClients ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">No clients configured for this partner yet.</p>
      ) : (partnerClients ?? []).map(pc => (
        <div key={pc.clientId} className="rounded-lg border border-border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-foreground">{pc.clientName}</h3>
              <p className="text-xs text-muted-foreground">Buying House: {pc.buyingHouseName ?? "—"}</p>
            </div>
            {canEdit && (
              <Button variant="ghost" size="icon" onClick={() => unlink.mutate({ id: partnerId, clientId: pc.clientId })} aria-label="Remove client">
                <Trash2 className="h-4 w-4 text-red-500" />
              </Button>
            )}
          </div>
          {pc.events.length === 0 ? (
            <p className="text-xs text-muted-foreground">This client has no events yet. Add events on the client's page.</p>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-2 py-2 text-left text-[10px] font-medium text-muted-foreground">Event</th>
                  <th className="px-2 py-2 text-left text-[10px] font-medium text-muted-foreground">Cost Model</th>
                  <th className="px-2 py-2 text-left text-[10px] font-medium text-muted-foreground">Billable ($)</th>
                  <th className="px-2 py-2 text-left text-[10px] font-medium text-muted-foreground">Payout ($)</th>
                </tr>
              </thead>
              <tbody>
                {pc.events.map(ev => (
                  <PayoutRow key={ev.clientEventId} partnerId={partnerId} ev={ev} canEdit={canEdit}
                    onSave={(rate) => upsert.mutate({ id: partnerId, data: { clientEventId: ev.clientEventId, payoutRate: rate } })} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </div>
  );
}

function PayoutRow({ ev, canEdit, onSave }: {
  partnerId: number;
  ev: { clientEventId: number; eventName: string; costModelName: string | null; billableRate: number; payoutRate: number | null };
  canEdit: boolean;
  onSave: (rate: number) => void;
}) {
  const [val, setVal] = useState(ev.payoutRate != null ? String(ev.payoutRate) : "");
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-2 py-2 text-xs font-medium">{ev.eventName}</td>
      <td className="px-2 py-2 text-xs text-muted-foreground">{ev.costModelName ?? "—"}</td>
      <td className="px-2 py-2 text-xs">{ev.billableRate}</td>
      <td className="px-2 py-2">
        <Input type="number" className="w-28 h-8" value={val} disabled={!canEdit}
          onChange={(e) => setVal(e.target.value)}
          onBlur={() => { const n = Number(val); if (canEdit && val.trim() !== "" && !Number.isNaN(n)) onSave(n); }} />
      </td>
    </tr>
  );
}
```

- [ ] **Step 7: Wire the Partner detail tabs**

In `pages/PartnerDetail.tsx`, set tabs to Details / Clients / Data / Analytics:

```tsx
<TabsList className="mb-4">
  <TabsTrigger value="details">Details</TabsTrigger>
  <TabsTrigger value="clients">Clients</TabsTrigger>
  <TabsTrigger value="data">Data</TabsTrigger>
  <TabsTrigger value="analytics">Analytics</TabsTrigger>
</TabsList>
<TabsContent value="details"><PartnerDetailsTab partner={partner} /></TabsContent>
<TabsContent value="clients"><PartnerClientsTab partnerId={id} /></TabsContent>
<TabsContent value="data"><PartnerDataTab partnerId={id} partner={partner} /></TabsContent>
<TabsContent value="analytics"><PartnerAnalyticsTab partnerId={id} partner={partner} /></TabsContent>
```

Rename `DataTab.tsx`/`AnalyticsTab.tsx` props/hooks per the rename map (read them first). In `DataTab.tsx`, the billing create form's cost-model dropdown must source from `useListCostModels()` (global names) and stop prefilling payout/margin from the selected cost model (those fields are entered manually); the `costModelId` it sends is the global cost model id.

- [ ] **Step 8: Client detail — KYC + Taxes & Terms + Events tabs**

Rewrite `pages/ClientDetail.tsx` to a tabbed layout (Details / Events / Data), reusing `KycFields`. Keep the existing billing-records "Data" table as the Data tab (it already passes `0` defaults to `computeRow` — update `r.platformId`→`r.partnerId`, `useListPlatforms`→`useListPartners`, and the "Platform" column header → "Partner").

Add a **Details tab** with: `KycFields`, a Sales Tax % input, a Withholding Tax % input, and a Payment Terms dropdown (`useListPaymentTerms`), saved via `useUpdateClient` (PATCH). Add an **Events tab** that lists/creates/updates/deletes events via `useListClientEvents`/`useCreateClientEvent`/`useUpdateClientEvent`/`useDeleteClientEvent`, each row = name input + cost-model dropdown (`useListCostModels`) + billable rate input. Follow the `PartnerClientsTab` add/list/delete idiom and the `DetailsTab` save idiom.

- [ ] **Step 9: Buying House detail — KYC + Bulk Discount; simplify create dialog**

- `pages/BuyingHouses.tsx`: reduce the create/edit `BHDialog` to **name-only** (remove the sales/withholding/remittance/bulk-discount inputs from the dialog and from `bhSchema`/`BHRow`). Keep `r.platformId`→`r.partnerId` rename only where present.
- `pages/BuyingHouseDetail.tsx`: add a Details section/tab with `KycFields` + a Bulk Discount % input, saved via `useUpdateBuyingHouse`. Apply rename map to platform references (`useListPlatforms`→`useListPartners`, `r.platformId`→`r.partnerId`, "Platform" header→"Partner").

- [ ] **Step 10: Rename platform references in remaining pages**

Apply the rename map to `pages/Billings.tsx`, `pages/Transactions.tsx`, `pages/Dashboard.tsx`, `pages/Analytics.tsx`, and `lib/computeRow.ts` (input field `platformBulkDiscountPct`→`partnerBulkDiscountPct`). Read each file, replace `useListPlatforms`→`useListPartners`, `useGetPlatform`→`useGetPartner`, `platformId`→`partnerId`, `platformName`→`partnerName`, analytics hook `useGetAnalyticsByPlatform`→`useGetAnalyticsByPartner`, and visible "Platform" labels → "Partner".

- [ ] **Step 11: Verify typecheck (whole repo)**

Run: `pnpm run typecheck`
Expected: PASS across libs + all artifacts. Resolve any leftover `platform`/`Platform` identifier references the compiler flags.

- [ ] **Step 12: Commit**

```bash
git add artifacts/adops
git commit -m "feat(ui): Partners rename + shared KYC, client events/taxes/terms, BH KYC+bulk discount, partner client payouts"
```

---

## Phase 8 — Permissions/seed + smoke verification

**Files:** `artifacts/api-server/src/lib/seed.ts`

- [ ] **Step 1: Rename permissions + optionally seed catalogs**

In `artifacts/api-server/src/lib/seed.ts`, in every `DEFAULT_ROLES[].permissions` array, replace `"View Platforms"`→`"View Partners"` and `"Edit Platforms"`→`"Edit Partners"`. (Optional: insert a couple of sample `cost_models` / `payment_terms` rows in `seedDefaults()` if none exist, following the existing role-seed idempotency pattern.)

- [ ] **Step 2: Verify typecheck**

Run: `pnpm run typecheck`
Expected: PASS.

- [ ] **Step 3: Push schema + smoke test (requires DATABASE_URL)**

Run: `pnpm --filter @workspace/db run push-force`
Then start the app and verify manually:
- Settings → Cost Models / Payment Terms: add + delete work.
- Buying House: create (name only) → detail page saves KYC + bulk discount.
- Client: create (name + buying house) → detail saves KYC, sales/withholding tax, payment terms; Events tab adds events with cost model + billable rate.
- Partner: create (name) → detail saves KYC + payment terms; Clients tab adds a client, shows its buying house + events, saves payout rates.
- Nav shows "Partners"; `/partners` routes work; Billings/Transactions/Dashboard/Analytics load (profit figures may be `0`/placeholder per the calc deferral).

- [ ] **Step 4: Commit**

```bash
git add artifacts/api-server/src/lib/seed.ts
git commit -m "chore: rename platform permissions to partner; seed catalogs"
```

---

## Self-review notes (coverage vs. spec)

- Rename Platforms→Partners (full): Phase 6 (db/api/server) + Phase 7 (UI) + Phase 8 (permissions). ✅
- Shared KYC for Client/Buying House/Partner: `kycColumns` (Phase 1), schema (Phases 3/4/5), `KycFields` component (Phase 7). ✅
- Global Cost Models + Payment Terms catalogs in Settings: Phases 1–2. ✅
- Client events (name + cost model + billable rate): Phase 3 (api) + Phase 7 Step 8 (UI). ✅
- Client sales/withholding tax + payment terms: Phase 3 + Phase 7 Step 8. ✅
- Buying House KYC + bulk-discount only (tax rates removed): Phase 4 + Phase 7 Step 9. ✅
- Partner KYC + payment terms, cost-model section removed, Clients/payouts section: Phase 5 + Phase 7 Steps 5–7. ✅
- Two-table partner↔client↔payout model + unlink clears payouts: Phase 5 (schema + `partner-config.ts`). ✅
- Calc deferral / keep compiling: billing repointed to global cost_models with null payout/margin (Phase 5 Step 7); `computeRow` callers pass `0` for removed inputs (Phases 4/7). ✅
- Destructive migration + reseed: `push-force` (Phase 8 Step 3); seed permission rename (Phase 8 Step 1). ✅
