# Partners Rename + Onboarding Restructure — Design

**Date:** 2026-06-18
**Status:** Approved (design); pending implementation plan
**Scope:** Configuration & onboarding data model + screens for Clients, Buying Houses, and Partners (renamed from Platforms). Profit/analytics calculations are explicitly out of scope this phase.

## Context — current state

Monorepo flow (each layer is the source of truth for the next):

`lib/db/src/schema/*` (Drizzle) → `lib/api-spec/openapi.yaml` (API contract) → orval generates `lib/api-zod` (zod + TS types) and `lib/api-client-react` (React Query hooks) → `artifacts/api-server/src/routes/*` (Express) → `artifacts/adops/src/pages/*` (React).

Today:
- **Platform** has the full KYC field set (contact + banking + tax-identity), `paymentTerms` (free text), `bulkDiscountPct`, and per-platform **cost models** (`platform_cost_models`: `name`, `payoutRate`, `marginPct`).
- **Client** is minimal: `name` + `buyingHouseId`.
- **Buying House** has tax rates (`salesTaxPct`, `withholdingTaxPct`, `remittanceTaxPct`) + `bulkDiscountPct`; no KYC.
- **Campaign** references `clientId` + `platformId`. **Transaction** belongs to a campaign.
- Profit math lives in `artifacts/api-server/src/lib/computeRow.ts` (mirrored in `artifacts/adops/src/lib/computeRow.ts`) and consumes `payoutRate`, `marginPct`, buying-house tax rates, bulk discounts, forex.
- Per-entity CRUD follows a consistent pattern: list page + create/edit **Dialog** (react-hook-form + zod) + **Detail** page (e.g. `PlatformDetail` with tabs). Settings tabs (Roles, Users) are DB-backed via API; currency/notification prefs are localStorage.
- `seed.ts` only seeds roles + the default admin — there is **no entity sample data** to preserve.

## Decisions (locked with user)

1. **Calc scope:** Config/onboarding only. Do **not** rewire `computeRow`/analytics to the new rates this phase.
2. **Rename depth:** Full rename Platforms → Partners (DB, API, generated code, UI, permissions).
3. **KYC:** All three entities (Client, Buying House, Partner) use Platform's exact KYC field set. Tax **rates** and bulk discount appear **only** where specified below — not as part of shared KYC.
4. **Data:** Destructive migration + reseed is acceptable (dev; no production data).

## Shared KYC field set

Applied identically to `clients`, `buying_houses`, and `partners`:

- Contact: `address`, `pocName`, `pocNumber`, `pocEmail`, `companyEmail`, `companyNumber`
- Banking: `bankName`, `bankAccountNumber`, `bankAddress`, `swiftCode`, `iban`
- Tax identity: `salesTaxNumber`, `ntnNumber`

All KYC fields are nullable text (matching current Platform definition).

## Data model

### New global catalogs (Settings-managed, DB-backed)

- **`cost_models`** — `{ id, name, createdAt }`. Names only. Replaces the old per-platform cost model concept (payout rate + margin % are gone from the catalog).
- **`payment_terms`** — `{ id, name, createdAt }`. Names only; same pattern as cost models.

### Buying House (`buying_houses`)

- **Add:** full KYC set.
- **Keep:** `bulkDiscountPct`.
- **Remove:** `salesTaxPct`, `withholdingTaxPct`, `remittanceTaxPct`.

### Client (`clients`)

- **Keep:** `name`, `buyingHouseId`.
- **Add:** full KYC set; `salesTaxPct`, `withholdingTaxPct` (numeric rates); `paymentTermsId` (FK → `payment_terms`, `onDelete: set null`).
- **New child — `client_events`:** `{ id, clientId (FK clients, cascade), name (text), costModelId (FK cost_models, set null), billableRate (numeric, $), createdAt }`. Multiple events per client.

### Partner (`partners`, renamed from `platforms`)

- **Keep:** full KYC set.
- **Change:** `paymentTerms` (free text) → `paymentTermsId` (FK → `payment_terms`, set null).
- **Remove:** `bulkDiscountPct`; the `platform_cost_models` table is dropped entirely.
- **New relationships:**
  - **`partner_clients`** — `{ id, partnerId (FK partners, cascade), clientId (FK clients, cascade), createdAt }`, unique `(partnerId, clientId)`. Represents "this partner serves this client." Allows adding a client before any events/rates exist. The buying house is shown by following `client.buyingHouseId`.
  - **`partner_event_payouts`** — `{ id, partnerId (FK partners, cascade), clientEventId (FK client_events, cascade), payoutRate (numeric, $), createdAt }`, unique `(partnerId, clientEventId)`. The payout rate per event for this partner.

### Renames flowing through

- `campaigns.platformId` → `campaigns.partnerId` (FK → `partners`).
- `billing_records.platformId` → `partnerId` (rename only; logic unchanged).

## Catalog deletion behavior

- Deleting a `cost_model` referenced by a `client_event`: FK `onDelete: set null` (event keeps its name + billable rate; cost model becomes unset). UI surfaces unset cost models for re-selection.
- Deleting a `payment_term` referenced by a client/partner: FK `onDelete: set null`.
- Unlinking a client from a partner (`DELETE /partners/{id}/clients/{clientId}`): the handler also deletes that partner's `partner_event_payouts` rows for the client's events (they are not auto-removed by FK, since payouts reference `clientEventId`, not the `partner_clients` link).
- Deleting a `client_event`: cascades to its `partner_event_payouts` rows (FK `onDelete: cascade`).

## API changes (`openapi.yaml` + routes, then regenerate orval)

- **Rename:** `/platforms*` → `/partners*`; `Platform`/`PlatformInput`/`PlatformUpdate` → `Partner*`.
- **Remove:** `/platforms/{id}/cost-models*` paths and `PlatformCostModel*` schemas.
- **Add global catalogs:** `/cost-models` (list/create/delete) and `/payment-terms` (list/create/delete).
- **Add client events:** `/clients/{id}/events` (list/create), `/clients/{id}/events/{eventId}` (update/delete).
- **Add partner config:**
  - `/partners/{id}/clients` (list served clients with their events + current payouts; link a client), `/partners/{id}/clients/{clientId}` (unlink).
  - `/partners/{id}/payouts` (upsert payout for a `clientEventId`).
- **Extend schemas:** `Client`/`ClientInput`/`ClientUpdate` gain KYC + `salesTaxPct` + `withholdingTaxPct` + `paymentTermsId`; `BuyingHouse*` gain KYC and drop the three tax-rate fields; `Partner*` gain `paymentTermsId` and drop `bulkDiscountPct` + `costModels`.
- Express route handlers updated to match (file renames `platforms.ts` → `partners.ts`, drop `platform-cost-models.ts`, new `cost-models.ts`, `payment-terms.ts`, `client-events.ts`, partner-client/payout handlers).

## UI changes (`artifacts/adops/src`)

Keep the existing **minimal create-dialog → rich Detail page** pattern.

- **Settings:** two new tabs — **Cost Models** and **Payment Terms** — each an add/list/delete list like the Roles tab (DB-backed via the new hooks).
- **Client:** create dialog stays name + buying house. Detail page sections/tabs:
  - **KYC** (the shared field set)
  - **Events** — table of event name + cost-model dropdown (from catalog) + billable rate ($); add/edit/delete rows.
  - **Taxes & Terms** — `salesTaxPct`, `withholdingTaxPct`, payment-terms dropdown (from catalog).
- **Buying House:** create dialog = name only (remove the current tax-rate inputs). Detail page: **KYC** + **Bulk Discount**.
- **Partner** (renamed pages: `Platforms.tsx` → `Partners.tsx`, `PlatformDetail/*` → `PartnerDetail/*`): create dialog = name. Detail page: **KYC**, **Payment Terms** (dropdown), **Clients** — select a client (dropdown) → buying house auto-displayed (from `client.buyingHouseId`) → that client's events listed each with a payout-rate ($) input. Remove the cost-models tab.
- **Routing/nav:** `/platforms` → `/partners`; sidebar/topbar labels "Platforms" → "Partners".

## Permissions

- `View Platforms` / `Edit Platforms` → `View Partners` / `Edit Partners` in `ALL_PERMISSIONS` (`lib/auth`), `DEFAULT_ROLES` (`seed.ts`), and route guards (`App.tsx`).
- Cost Models and Payment Terms management is gated under the existing `Manage Settings` permission.

## Calculation deferral & compilation strategy (out of scope, but must compile)

Removing Buying House tax rates and the partner cost-model payout/margin removes inputs that `computeRow`/analytics/billing currently consume. This phase does **not** build the new event-billable-vs-payout profit logic. To keep the app compiling and running:

- At call sites that previously read removed inputs (buying-house `salesTaxPct`/`withholdingTaxPct`/`remittanceTaxPct`, partner cost-model `payoutRate`/`marginPct`), feed **neutral defaults (0)**.
- `computeRow`'s signature can remain unchanged; callers pass 0 for the now-absent inputs.
- **Consequence:** profit/margin figures across Transactions/Billings/Dashboard/Analytics may read as 0/placeholder until the later calc phase wires in the new model. This is the accepted deferral.

## Migration & seed

- Destructive Drizzle migration: rename `platforms` → `partners` and cascade column renames; alter `buying_houses` (add KYC, drop tax rates); alter `clients` (add KYC + tax rates + `paymentTermsId`); convert partner `paymentTerms` → `paymentTermsId`; create `cost_models`, `payment_terms`, `client_events`, `partner_clients`, `partner_event_payouts`; drop `platform_cost_models`.
- `seed.ts`: update permission names; optionally add small sample data (a couple of cost models / payment terms) — no existing data to preserve.

## Out of scope

- New profit/margin computation from event billable rate vs per-event payout rate (later phase).
- Reworking Transactions/Billings/Payments/Cost/Analytics beyond the mechanical rename and neutral-default wiring.
- Remittance tax disappears from configuration entirely; not reintroduced elsewhere this phase.

## Implementation order (high level — detailed plan via writing-plans)

1. DB schema + migration (new tables, KYC additions, field removals, partners rename).
2. `openapi.yaml` updates + orval regen (`lib/api-zod`, `lib/api-client-react`).
3. Express routes (rename + new catalog/event/payout handlers; neutral-default wiring for removed calc inputs).
4. Settings catalogs UI (Cost Models, Payment Terms).
5. Client onboarding (KYC, Events, Taxes & Terms).
6. Buying House onboarding (KYC + Bulk Discount).
7. Partner onboarding (KYC, Payment Terms, Clients/payouts) + Platforms→Partners UI rename.
8. Permissions rename + seed update; verify build/typecheck.
