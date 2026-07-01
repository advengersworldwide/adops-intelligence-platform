# Client/Partner-scoped PO Codes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate purchase-order codes as `PREFIX-MMYY-NNNN`, where `PREFIX` is a mandatory 4–8 char code on the client (for Client POs) or partner (for Partner POs), `MMYY` is the creation month+year, and `NNNN` is a global monthly-resetting sequence.

**Architecture:** A pure `formatPoCode(prefix, date, seq)` + `derivePrefix(name)` helper drives both code generation and the form auto-suggest. A mandatory `code_prefix` column is added to `clients` and `partners` (backfilled for existing rows). The CPO/PPO POST routes look up the entity prefix, count that document type's rows in the current month, and format the code.

**Tech Stack:** Next.js 15 App Router (route handlers, `runtime = "nodejs"`), Drizzle ORM + Postgres (Supabase), drizzle-kit push, OpenAPI + orval/zod codegen, react-hook-form + zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-28-po-code-format-design.md`

**Conventions:**
- Worktree root: `E:\Futurama Projects\adops-intelligence-platform\.worktrees\feature\purchase-orders`. All paths below are relative to it.
- Run web tests: `cd app && pnpm test <filter>`.
- Regenerate API types: `cd lib/api-spec && pnpm codegen`.
- DB push / scripts need `DATABASE_URL` in env (value is in `app/.env`):
  `postgresql://postgres.btvxavdscifcvincwzlo:Advengers786.@aws-1-ap-south-1.pooler.supabase.com:6543/postgres`

---

### Task 1: `formatPoCode` refactor + `derivePrefix` helper

**Files:**
- Modify: `app/lib/po-codes.ts`
- Test: `app/lib/po-codes.test.ts`

- [ ] **Step 1: Rewrite the test file**

Replace the entire contents of `app/lib/po-codes.test.ts` with:

```ts
import { describe, it, expect } from "vitest";
import { formatPoCode, derivePrefix } from "./po-codes";

describe("formatPoCode", () => {
  it("formats PREFIX-MMYY-NNNN with zero-padded month and sequence", () => {
    expect(formatPoCode("EPAY", new Date(2026, 0, 15), 1)).toBe("EPAY-0126-0001");
    expect(formatPoCode("JAZZ", new Date(2026, 0, 15), 2)).toBe("JAZZ-0126-0002");
  });
  it("uses 2-digit month for later months", () => {
    expect(formatPoCode("SAND", new Date(2026, 11, 1), 7)).toBe("SAND-1226-0007");
  });
  it("uses the 2-digit year and rolls over", () => {
    expect(formatPoCode("SAND", new Date(2027, 5, 1), 1)).toBe("SAND-0627-0001");
  });
  it("does not truncate sequences beyond 4 digits", () => {
    expect(formatPoCode("EPAY", new Date(2026, 0, 1), 12345)).toBe("EPAY-0126-12345");
  });
});

describe("derivePrefix", () => {
  it("takes the first 4 alphanumeric letters, uppercased", () => {
    expect(derivePrefix("Easypaisa")).toBe("EASY");
    expect(derivePrefix("JazzCash")).toBe("JAZZ");
  });
  it("strips spaces and punctuation before taking 4 chars", () => {
    expect(derivePrefix("U Micro Finance")).toBe("UMIC");
  });
  it("right-pads short names with X to reach 4 chars", () => {
    expect(derivePrefix("Al")).toBe("ALXX");
    expect(derivePrefix("")).toBe("XXXX");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd app && pnpm test po-codes`
Expected: FAIL — `derivePrefix` is not exported and `formatPoCode` signature mismatch.

- [ ] **Step 3: Rewrite `po-codes.ts`**

Replace the entire contents of `app/lib/po-codes.ts` with:

```ts
/** Build a purchase-order code: `PREFIX-MMYY-NNNN` (sequence zero-padded to >= 4). */
export function formatPoCode(prefix: string, date: Date, seq: number): string {
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yy = String(date.getFullYear() % 100).padStart(2, "0");
  return `${prefix}-${mm}${yy}-${String(seq).padStart(4, "0")}`;
}

/** Suggested 4-char prefix from a name: first 4 alphanumerics, uppercased, X-padded. */
export function derivePrefix(name: string): string {
  const alnum = name.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return alnum.slice(0, 4).padEnd(4, "X");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd app && pnpm test po-codes`
Expected: PASS (2 describe blocks, 7 tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/po-codes.ts app/lib/po-codes.test.ts
git commit -m "refactor: PREFIX-MMYY-NNNN po code format + derivePrefix helper"
```

---

### Task 2: Add `code_prefix` columns + backfill existing rows

**Files:**
- Modify: `lib/db/src/schema/clients.ts`
- Modify: `lib/db/src/schema/partners.ts`
- Create: `lib/db/scripts/backfill-code-prefix.mjs`

Note: `drizzle-kit push` cannot add a `NOT NULL` column to tables that already have rows without a default. So: add nullable → backfill → make `NOT NULL`.

- [ ] **Step 1: Add the column as nullable in both schemas**

In `lib/db/src/schema/clients.ts`, add `codePrefix` immediately after the `name` column:

```ts
  name: text("name").notNull(),
  codePrefix: text("code_prefix"),
```

In `lib/db/src/schema/partners.ts`, add it immediately after the `name` column:

```ts
  name: text("name").notNull(),
  codePrefix: text("code_prefix"),
```

- [ ] **Step 2: Push the nullable column**

Run: `cd lib/db && DATABASE_URL="postgresql://postgres.btvxavdscifcvincwzlo:Advengers786.@aws-1-ap-south-1.pooler.supabase.com:6543/postgres" pnpm push`
Expected: `[✓] Changes applied`.

- [ ] **Step 3: Write the backfill script**

Create `lib/db/scripts/backfill-code-prefix.mjs`:

```js
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

const client = new pg.Client({ connectionString: url });
await client.connect();

// Mirror derivePrefix(): first 4 alphanumerics, uppercased, right-padded with X.
const expr = `rpad(upper(left(regexp_replace(name, '[^a-zA-Z0-9]', '', 'g'), 4)), 4, 'X')`;
for (const table of ["clients", "partners"]) {
  const res = await client.query(
    `UPDATE ${table} SET code_prefix = ${expr} WHERE code_prefix IS NULL OR code_prefix = ''`,
  );
  console.log(`${table}: backfilled ${res.rowCount} row(s)`);
}

await client.end();
console.log("backfill done");
```

- [ ] **Step 4: Run the backfill**

Run: `cd lib/db && DATABASE_URL="postgresql://postgres.btvxavdscifcvincwzlo:Advengers786.@aws-1-ap-south-1.pooler.supabase.com:6543/postgres" node scripts/backfill-code-prefix.mjs`
Expected: prints `clients: backfilled N row(s)`, `partners: backfilled N row(s)`, `backfill done`.

- [ ] **Step 5: Make the column NOT NULL in both schemas**

In `lib/db/src/schema/clients.ts` change the column to:

```ts
  codePrefix: text("code_prefix").notNull(),
```

In `lib/db/src/schema/partners.ts` change the column to:

```ts
  codePrefix: text("code_prefix").notNull(),
```

- [ ] **Step 6: Push the NOT NULL constraint**

Run: `cd lib/db && DATABASE_URL="postgresql://postgres.btvxavdscifcvincwzlo:Advengers786.@aws-1-ap-south-1.pooler.supabase.com:6543/postgres" pnpm push`
Expected: `[✓] Changes applied` (all rows already populated, so the NOT NULL alter succeeds).

- [ ] **Step 7: Commit**

```bash
git add lib/db/src/schema/clients.ts lib/db/src/schema/partners.ts lib/db/scripts/backfill-code-prefix.mjs
git commit -m "feat(db): mandatory code_prefix on clients and partners + backfill"
```

---

### Task 3: Add `codePrefix` to OpenAPI schemas + regenerate types

**Files:**
- Modify: `lib/api-spec/openapi.yaml`

- [ ] **Step 1: Add `codePrefix` to the `Client` schema**

In `lib/api-spec/openapi.yaml`, in the `Client:` schema, add `codePrefix` to `required` and to `properties`:

```yaml
    Client:
      type: object
      required: [id, name, codePrefix, createdAt]
      properties:
        id: { type: integer }
        name: { type: string }
        codePrefix: { type: string }
```

(Leave the remaining `Client` properties unchanged below `name`.)

- [ ] **Step 2: Add `codePrefix` to `ClientInput` (required, validated)**

Replace the `ClientInput` schema with:

```yaml
    ClientInput:
      type: object
      required: [name, codePrefix]
      properties:
        name: { type: string, minLength: 1 }
        codePrefix: { type: string, minLength: 4, maxLength: 8, pattern: "^[A-Z0-9]{4,8}$" }
        buyingHouseId: { type: ["integer", "null"] }
```

- [ ] **Step 3: Add `codePrefix` to `ClientUpdate`**

In the `ClientUpdate` schema `properties`, add after `name`:

```yaml
        codePrefix: { type: string, minLength: 4, maxLength: 8, pattern: "^[A-Z0-9]{4,8}$" }
```

- [ ] **Step 4: Add `codePrefix` to the `Partner` schema**

In the `Partner:` schema, add `codePrefix` to `required` and `properties`:

```yaml
    Partner:
      type: object
      required: [id, name, codePrefix, createdAt]
      properties:
        id:
          type: integer
        name:
          type: string
        codePrefix:
          type: string
```

- [ ] **Step 5: Add `codePrefix` to `PartnerInput` and `PartnerUpdate`**

In `PartnerInput`, add `codePrefix` to `required` and `properties`:

```yaml
    PartnerInput:
      type: object
      required: [name, codePrefix]
      properties:
        name:
          type: string
          minLength: 1
        codePrefix:
          type: string
          minLength: 4
          maxLength: 8
          pattern: "^[A-Z0-9]{4,8}$"
```

In `PartnerUpdate` `properties`, add after `name`:

```yaml
        codePrefix:
          type: string
          minLength: 4
          maxLength: 8
          pattern: "^[A-Z0-9]{4,8}$"
```

- [ ] **Step 6: Regenerate the client + zod types**

Run: `cd lib/api-spec && pnpm codegen`
Expected: `🎉 api-client-react ...`, `🎉 zod ...`, then `tsc --build` with no errors.

- [ ] **Step 7: Verify `codePrefix` is in the generated types**

Run: `grep -n "codePrefix" lib/api-client-react/src/generated/api.schemas.ts`
Expected: `codePrefix` appears in `Client`, `ClientInput`, `ClientUpdate`, `Partner`, `PartnerInput`, `PartnerUpdate`.

- [ ] **Step 8: Commit**

```bash
git add lib/api-spec/openapi.yaml lib/api-client-react/src/generated lib/api-zod/src/generated
git commit -m "feat(api): codePrefix on client and partner schemas"
```

---

### Task 4: Persist and return `codePrefix` in client & partner routes

**Files:**
- Modify: `app/app/api/clients/route.ts`
- Modify: `app/app/api/clients/[id]/route.ts`
- Modify: `app/app/api/partners/route.ts`
- Modify: `app/app/api/partners/[id]/route.ts`

- [ ] **Step 1: Client list/create route — return + persist prefix**

In `app/app/api/clients/route.ts`, in `mapRow`'s returned object, add `codePrefix` right after `name`:

```ts
    id: r.id, name: r.name, codePrefix: r.codePrefix, buyingHouseId: r.buyingHouseId ?? null, buyingHouseName,
```

In the same file's `POST`, add `codePrefix` to the insert:

```ts
  const [row] = await db.insert(clientsTable).values({
    name: parsed.data.name,
    codePrefix: parsed.data.codePrefix,
    buyingHouseId: parsed.data.buyingHouseId ?? null,
  }).returning();
```

- [ ] **Step 2: Client [id] route — return + accept prefix**

In `app/app/api/clients/[id]/route.ts`, in `mapRow`'s returned object add `codePrefix` after `name` (same line as Step 1). Then add `"codePrefix"` to the `textKeys` tuple used by PATCH:

```ts
  const textKeys = ["name","codePrefix","buyingHouseId","address","pocName","pocNumber","pocEmail","companyEmail","companyNumber","bankName","bankAccountNumber","bankAddress","swiftCode","iban","salesTaxNumber","ntnNumber","paymentTermsId"] as const;
```

- [ ] **Step 3: Partner list/create route — return prefix**

In `app/app/api/partners/route.ts`, in `mapRow`'s returned object add `codePrefix` after `name`:

```ts
    id: r.id, name: r.name, codePrefix: r.codePrefix, address: r.address, pocName: r.pocName, pocNumber: r.pocNumber, pocEmail: r.pocEmail,
```

(The `POST` already does `db.insert(partnersTable).values(parsed.data)`, so `codePrefix` is persisted automatically.)

- [ ] **Step 4: Partner [id] route — return prefix**

In `app/app/api/partners/[id]/route.ts`, in `mapRow`'s returned object add `codePrefix` after `name` (same line as Step 3). PATCH already does `.set(parsed.data)`, so no further change.

- [ ] **Step 5: Typecheck**

Run: `cd app && pnpm exec tsc -p tsconfig.json --noEmit`
Expected: no output (clean).

- [ ] **Step 6: Commit**

```bash
git add app/app/api/clients app/app/api/partners
git commit -m "feat(api): persist and return codePrefix on clients and partners"
```

---

### Task 5: Generate PO codes from the entity prefix + monthly sequence

**Files:**
- Modify: `app/app/api/client-purchase-orders/route.ts`
- Modify: `app/app/api/partner-purchase-orders/route.ts`
- Test: `app/app/api/client-purchase-orders/route.test.ts`

- [ ] **Step 1: Update the CPO route test mocks + assertion**

In `app/app/api/client-purchase-orders/route.test.ts`, replace the "creates with a generated CPO code and 201" test body so the mocked `select` chain provides the monthly count, the client prefix lookup, then `mapCpoRow`'s client + user lookups, in order:

```ts
  it("creates with a generated CPO code and 201", async () => {
    selectChain
      .mockResolvedValueOnce([{ value: 0 }])                       // nextCpoCode monthly count -> seq 1
      .mockResolvedValueOnce([{ codePrefix: "JAZZ" }])             // nextCpoCode client prefix lookup
      .mockResolvedValueOnce([{ name: "JazzCash", buyingHouseId: null }]) // mapCpoRow client
      .mockResolvedValueOnce([{ name: "Tester" }]);                // mapCpoRow user
    insertReturning.mockResolvedValueOnce([{
      id: 1, code: "JAZZ-0126-0001", clientId: 1, attachmentUrl: "http://x/f.pdf",
      attachmentName: "f.pdf", attachments: [{ url: "http://x/f.pdf", name: "f.pdf" }],
      createdById: 7, createdAt: new Date("2026-01-24T00:00:00Z"),
    }]);
    const res = await post({
      clientId: 1,
      attachments: [{ url: "http://x/f.pdf", name: "f.pdf" }],
    });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.code).toBe("JAZZ-0126-0001");
    expect(json.clientName).toBe("JazzCash");
  });
```

Also ensure the mock's `clientsTable` is available (it already is in the `vi.mock("@workspace/db", ...)` block).

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd app && pnpm test client-purchase-orders`
Expected: FAIL — current `nextCpoCode` counts by year and does not look up a prefix, so the mock ordering / generated code will not line up.

- [ ] **Step 3: Rewrite `nextCpoCode` and its call site**

In `app/app/api/client-purchase-orders/route.ts`:

Replace the import of `formatPoCode`:

```ts
import { formatPoCode } from "@/lib/po-codes";
```

Replace the whole `nextCpoCode` function with a version that counts the current month and looks up the client's prefix:

```ts
async function nextCpoCode(clientId: number): Promise<string> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const [{ value }] = await db.select({ value: count() }).from(clientPurchaseOrdersTable)
    .where(and(gte(clientPurchaseOrdersTable.createdAt, monthStart), lt(clientPurchaseOrdersTable.createdAt, monthEnd)));
  const [client] = await db.select({ codePrefix: clientsTable.codePrefix })
    .from(clientsTable).where(eq(clientsTable.id, clientId));
  const prefix = client?.codePrefix?.trim();
  if (!prefix) throw new Error("Set a PO code prefix for this client first");
  return formatPoCode(prefix, now, Number(value) + 1);
}
```

In the `POST` handler, replace the code-generation call so it passes the clientId and returns a 400 on a missing prefix:

```ts
  const user = await getSession();
  let code: string;
  try { code = await nextCpoCode(parsed.data.clientId); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 400 }); }
  const attachments = parsed.data.attachments.map((a) => ({ url: a.url, name: a.name ?? null }));
  const [first] = attachments;
  const [row] = await db.insert(clientPurchaseOrdersTable).values({
    code,
    clientId: parsed.data.clientId,
    attachmentUrl: first.url,
    attachmentName: first.name,
    attachments,
    createdById: user?.sub ?? null,
  }).returning();
```

Confirm `clientsTable`, `count`, `and`, `gte`, `lt`, `eq` are imported at the top of the file (they already are: `eq, and, gte, lt, count` from `drizzle-orm` and `clientsTable` from `@workspace/db`).

- [ ] **Step 4: Run the CPO test to verify it passes**

Run: `cd app && pnpm test client-purchase-orders`
Expected: PASS (3 tests).

- [ ] **Step 5: Rewrite `nextPpoCode` and its call site**

In `app/app/api/partner-purchase-orders/route.ts`:

Replace the `formatPoCode` import:

```ts
import { formatPoCode } from "@/lib/po-codes";
```

Replace the whole `nextPpoCode` function:

```ts
async function nextPpoCode(partnerId: number): Promise<string> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const [{ value }] = await db.select({ value: count() }).from(partnerPurchaseOrdersTable)
    .where(and(gte(partnerPurchaseOrdersTable.createdAt, monthStart), lt(partnerPurchaseOrdersTable.createdAt, monthEnd)));
  const [partner] = await db.select({ codePrefix: partnersTable.codePrefix })
    .from(partnersTable).where(eq(partnersTable.id, partnerId));
  const prefix = partner?.codePrefix?.trim();
  if (!prefix) throw new Error("Set a PO code prefix for this partner first");
  return formatPoCode(prefix, now, Number(value) + 1);
}
```

In the `POST` handler, replace the insert of the PPO code with a guarded call:

```ts
  const { partnerId, clientPurchaseOrderId, startDate, endDate, items, notes } = parsed.data;
  const user = await getSession();
  const total = totalBudget(items.map(i => ({ cacRate: i.cacRate, eventCount: i.eventCount })));

  let code: string;
  try { code = await nextPpoCode(partnerId); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 400 }); }

  const [ppo] = await db.insert(partnerPurchaseOrdersTable).values({
    code, partnerId, clientPurchaseOrderId, startDate, endDate,
    totalBudget: String(total), notes: notes ?? null, createdById: user?.sub ?? null,
  }).returning();
```

Confirm `partnersTable`, `count`, `and`, `gte`, `lt`, `eq` are imported (they already are in this file).

- [ ] **Step 6: Run the PPO test + typecheck**

Run: `cd app && pnpm test partner-purchase-orders && pnpm exec tsc -p tsconfig.json --noEmit`
Expected: PPO test PASS (1 test), typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add app/app/api/client-purchase-orders app/app/api/partner-purchase-orders
git commit -m "feat: generate PO codes from client/partner prefix + monthly sequence"
```

---

### Task 6: Client form — required `codePrefix` field with auto-suggest

**Files:**
- Modify: `app/app/(dashboard)/clients/page.tsx`

- [ ] **Step 1: Add `codePrefix` to the form schema + type**

In `app/app/(dashboard)/clients/page.tsx`, update `clientSchema`:

```ts
const clientSchema = z.object({
  name: z.string().min(1, "Name is required"),
  codePrefix: z.string().regex(/^[A-Z0-9]{4,8}$/, "4–8 uppercase letters/numbers"),
  buyingHouseId: z.number().nullable().optional(),
});
type ClientForm = z.infer<typeof clientSchema>;
```

- [ ] **Step 2: Import `derivePrefix` and update default/edit values**

Add to the imports near the top of the file:

```ts
import { derivePrefix } from "@/lib/po-codes";
```

Update the edit `defaultValues` passed to `<ClientDialog>` (the object currently `{ name, buyingHouseId }`) to include the prefix:

```ts
        defaultValues={editClient ? {
          name: editClient.name,
          codePrefix: editClient.codePrefix,
          buyingHouseId: editClient.buyingHouseId ?? null,
        } : undefined}
```

Add `codePrefix: string;` to the `ClientRow` interface:

```ts
interface ClientRow {
  id: number; name: string; codePrefix: string;
  buyingHouseId: number | null; buyingHouseName: string | null;
  createdAt: string;
}
```

- [ ] **Step 3: Update `ClientDialog` default values (create resets)**

In `ClientDialog`, both the `useForm` default and the `form.reset` in the effect currently use `{ name: "", buyingHouseId: null }`. Replace both occurrences with:

```ts
{ name: "", codePrefix: "", buyingHouseId: null }
```

- [ ] **Step 4: Add the field + auto-suggest to `ClientDialog`**

Inside `ClientDialog`, after `const form = useForm(...)`, add an auto-suggest that fills the prefix from the name while the user has not typed one:

```ts
  const nameValue = form.watch("name");
  useEffect(() => {
    if (!form.getValues("codePrefix") && nameValue) {
      form.setValue("codePrefix", derivePrefix(nameValue), { shouldValidate: true });
    }
  }, [nameValue, form]);
```

Then add the field JSX immediately after the `name` `FormField` (before the `buyingHouseId` field):

```tsx
            <FormField control={form.control} name="codePrefix" render={({ field }) => (
              <FormItem>
                <FormLabel>PO Code Prefix</FormLabel>
                <FormControl>
                  <Input placeholder="e.g. EPAY" maxLength={8}
                    {...field}
                    onChange={e => field.onChange(e.target.value.toUpperCase())}
                    data-testid="client-prefix-input" />
                </FormControl>
                <p className="text-xs text-muted-foreground">4–8 letters/numbers. Used to generate purchase-order codes (e.g. EPAY-0126-0001).</p>
                <FormMessage />
              </FormItem>
            )} />
```

- [ ] **Step 5: Typecheck**

Run: `cd app && pnpm exec tsc -p tsconfig.json --noEmit`
Expected: no output (clean).

- [ ] **Step 6: Commit**

```bash
git add "app/app/(dashboard)/clients/page.tsx"
git commit -m "feat(ui): required PO code prefix on the client form"
```

---

### Task 7: Partner form — required `codePrefix` field with auto-suggest

**Files:**
- Modify: `app/app/(dashboard)/partners/page.tsx`
- Modify: `app/app/(dashboard)/partners/[id]/DetailsTab.tsx`

- [ ] **Step 1: Read the partner create form to confirm field names**

Run: `sed -n '24,40p;164,215p' "app/app/(dashboard)/partners/page.tsx"`
Note the exact `createSchema` shape, the `CreateForm` type name, the `useForm` default object, and the `form.reset` object so the next steps match them.

- [ ] **Step 2: Add `codePrefix` to the partner create schema + defaults**

In `app/app/(dashboard)/partners/page.tsx`, add to `createSchema` (after `name`):

```ts
  codePrefix: z.string().regex(/^[A-Z0-9]{4,8}$/, "4–8 uppercase letters/numbers"),
```

Add `codePrefix: ""` to BOTH the `useForm` `defaultValues` object and the `form.reset({...})` object in the `CreatePlatformDialog` open effect (the objects that start with `{ name: "", address: "", ... }`).

Add the import near the top of the file:

```ts
import { derivePrefix } from "@/lib/po-codes";
```

- [ ] **Step 3: Add auto-suggest + field to the partner create dialog**

Inside `CreatePlatformDialog`, after `const form = useForm(...)`, add:

```ts
  const nameValue = form.watch("name");
  useEffect(() => {
    if (!form.getValues("codePrefix") && nameValue) {
      form.setValue("codePrefix", derivePrefix(nameValue), { shouldValidate: true });
    }
  }, [nameValue, form]);
```

Add the field JSX immediately after the `name` `FormField`:

```tsx
            <FormField control={form.control} name="codePrefix" render={({ field }) => (
              <FormItem>
                <FormLabel>PO Code Prefix</FormLabel>
                <FormControl>
                  <Input placeholder="e.g. SAND" maxLength={8}
                    {...field}
                    onChange={e => field.onChange(e.target.value.toUpperCase())}
                    data-testid="partner-prefix-input" />
                </FormControl>
                <p className="text-xs text-muted-foreground">4–8 letters/numbers. Used to generate partner PO codes (e.g. SAND-0126-0001).</p>
                <FormMessage />
              </FormItem>
            )} />
```

- [ ] **Step 4: Add `codePrefix` to the partner edit form (DetailsTab)**

`app/app/(dashboard)/partners/[id]/DetailsTab.tsx` does NOT use react-hook-form — it holds edit state in local `useState` (`kyc`, `paymentTermsId`) seeded from the `partner` prop and sends them in `handleSave`. Add `codePrefix` the same way.

Add an `Input` import at the top:

```ts
import { Input } from "@/components/ui/input";
```

Add local state next to `paymentTermsId`:

```ts
  const [codePrefix, setCodePrefix] = useState<string>(partner.codePrefix);
```

Keep it in sync inside the existing `useEffect(..., [partner])`:

```ts
  useEffect(() => {
    setKyc(kycFromRecord(partner));
    setPaymentTermsId(partner.paymentTermsId != null ? String(partner.paymentTermsId) : "none");
    setCodePrefix(partner.codePrefix);
  }, [partner]);
```

Guard + include it in `handleSave` (validate before the mutation, include in the payload):

```ts
  async function handleSave() {
    if (!/^[A-Z0-9]{4,8}$/.test(codePrefix)) {
      toast({ title: "PO code prefix must be 4–8 uppercase letters/numbers", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await updatePartner.mutateAsync({ id: partner.id, data: {
        ...kycToPayload(kyc),
        codePrefix,
        paymentTermsId: paymentTermsId === "none" ? null : parseInt(paymentTermsId, 10),
      }});
      await qc.invalidateQueries({ queryKey: getGetPartnerQueryKey(partner.id) });
      toast({ title: "Changes saved" });
    } catch { toast({ title: "Failed to save changes", variant: "destructive" }); }
    finally { setSaving(false); }
  }
```

Render a prefix input just before the Payment Terms box (uppercasing on change):

```tsx
      <div className="rounded-lg border border-border bg-card p-5 max-w-xs space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">PO Code Prefix</span>
        <Input value={codePrefix} disabled={!canEdit} maxLength={8}
          onChange={e => setCodePrefix(e.target.value.toUpperCase())}
          data-testid="partner-edit-prefix-input" />
        <p className="text-xs text-muted-foreground">4–8 letters/numbers. e.g. SAND-0126-0001</p>
      </div>
```

- [ ] **Step 5: Typecheck**

Run: `cd app && pnpm exec tsc -p tsconfig.json --noEmit`
Expected: no output (clean).

- [ ] **Step 6: Commit**

```bash
git add "app/app/(dashboard)/partners/page.tsx" "app/app/(dashboard)/partners/[id]/DetailsTab.tsx"
git commit -m "feat(ui): required PO code prefix on the partner forms"
```

---

### Task 8: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole web test suite**

Run: `cd app && pnpm test`
Expected: all test files pass (po-codes: 7, client-purchase-orders: 3, partner-purchase-orders: 1, plus the pre-existing suites).

- [ ] **Step 2: Typecheck the whole app**

Run: `cd app && pnpm exec tsc -p tsconfig.json --noEmit`
Expected: no output (clean).

- [ ] **Step 3: Manual smoke (dev server)**

Start: `pnpm --filter @workspace/web dev` (from the worktree root), then:
1. Clients → Add Client: confirm the "PO Code Prefix" field auto-fills from the name, is uppercased, and rejects fewer than 4 chars.
2. Create a Client PO for that client → open the invoice → confirm the code reads `PREFIX-MMYY-NNNN` (e.g. `EPAY-0626-0001`).
3. Create a Client PO for a second client → confirm the sequence increments globally (`...-0002`, not reset to 0001).
4. Partners → confirm the prefix field on create/edit, then create a Partner PO → confirm the code uses the partner's prefix.

- [ ] **Step 4: Final commit (if any smoke fixes were needed)**

```bash
git add -A
git commit -m "chore: verify client/partner-scoped PO codes"
```

---

## Notes for the implementer

- **Order matters:** Tasks 3–5 briefly leave the app unable to create clients/partners via the API until Tasks 6–7 add the form field. That is expected on this feature branch; the feature is only complete after Task 7.
- **Existing PO codes are not migrated** — old `CPO-2026-xxxx` / `PPO-2026-xxxx` codes remain valid; only new POs use the new format.
- **Monthly count includes pre-existing rows**, so the first new code in a month may not be `0001` if POs already exist that month. This is intended (keeps sequence unique + chronological).
- **`derivePrefix` (TS) and the SQL backfill must stay in sync** — both take the first 4 alphanumerics, uppercase, and right-pad with `X`.
