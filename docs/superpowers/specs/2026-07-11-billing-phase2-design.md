# Billing Phase 2 — Design

**Date:** 2026-07-11
**Status:** Approved (design); pending implementation plan
**Builds on:** `docs/superpowers/specs/2026-07-05-billing-summary-detail-design.md` (Phase 1, merged to `main`).
**Scope:** Invoice redesign + Summary/modal polish + attachment fix; a payment **status** lifecycle with **terms‑based aging**; and a new **partner‑side subsystem** (partner bills + partner payments) mirroring the client side, with Client/Partner tabs on both Billing and Payments.

## Context — current state (Phase 1, on `main`)

Monorepo flow: `lib/db/src/schema/*` (Drizzle) → `lib/api-spec/openapi.yaml` → orval codegen (`lib/api-zod`, `lib/api-client-react`) → `app/app/api/*` route handlers → `app/app/(dashboard)/*` pages.

Relevant existing pieces:
- **`billings`** (+ `billing_lines`, `billing_event_items`): client billings; `mapBilling` returns computed `totalInvoice`, `netReceivable`, `netMargin`, `amountPaid`, `invoiceCode` (`INV-…`), `invoiceGeneratedAt`, `paymentTerms`, `clientPurchaseOrderId`, `lines[]`. Math in `app/lib/compute-billing.ts`.
- **`payments`** (+ `payment_billings`): client receipts settling billings. Fields incl. `mode`, `totalAmount`, `notes`, `chequeImageUrl`, `receiptUrl`, `paymentDate`. `amountPaid` on a billing = Σ allocations.
- **`payment_terms`**: `{ id, name }` — no duration.
- **`client_purchase_orders`** (`CPO-…`), **`partner_purchase_orders`** (`PPO-…`, `totalBudget` in USD), **`partner_purchase_order_items`**.
- **`clients`** (`paymentTermsId`, `codePrefix`, `buyingHouseId`→agency), **`partners`** (`paymentTermsId`, `codePrefix`, full KYC).
- Pages: `billings/summary`, `billings/detail`, `billings/[id]/invoice`, `payments`. Invoice doc `components/billings/BillingInvoice.tsx`; PDF via `lib/po-pdf.ts` (`downloadInvoicePdf`, native print). Partner invoice `components/purchase-orders/PartnerInvoice.tsx` holds a hardcoded `clauses()` list.
- Codes via `formatPoCode(prefix, date, seq)` = `{prefix}-MMYY-NNNN`; Phase‑1 prepends typed tokens (`CPO-`/`PPO-`/`INV-`).

## Decisions (locked with user)

1. **Navigation:** both **Billing** and **Payments** become **Client | Partner** tabbed areas (symmetric).
2. **Payment status:** payments gain `status` (`pending` → `received` for client, `pending` → `paid` for partner). Paid totals, progress bars, and aging count **only** settled (received/paid) payments. New payments default `pending`; status changed via a dropdown (like billing `StatusSelect`).
3. **Payment terms + days:** `payment_terms` gains `days` (int). Net 30 = 30.
4. **Aging (both sides):** shared rule — from a start date + term days vs today: **green** while elapsed ≤ ½ term, **yellow** once past half, **red** once overdue; **settled** shows neutral. Client billing aging start = `invoiceGeneratedAt` (client terms); partner bill aging start = `dateReceived` (partner terms).
5. **Invoice totals:** collapse to **Total of Events (USD) → Forex → Net Amount (PKR)** *(the grossed‑up value)* **→ Sales Tax @ X% → Total Invoice Amount**. No "Net Total"/"Gross" rows.
6. **Invoice content:** show the client's **Payment Terms** + the **partner‑style clauses** (extracted to a shared module, reused by both invoices).
7. **Invoice table:** group **partner once + agency once** (rowspan), one row per event.
8. **Summary polish:** remove **Net Margin** from the Create Billing modal; show **partner name(s)** in the Summary collapsed row (all, if multiple) + keep the expand breakdown.
9. **Partner bills:** a bill received from a partner. Fields: system **`code`** (`PBILL-{partnerPrefix}-MMYY-NNNN`) **+** the partner's own **`partnerInvoiceNumber`** (text); `partnerId`, `clientId` (context), optional `partnerPurchaseOrderId` (for amount prefill), **USD `amount`** (prefilled from the PO budget, editable), `attachmentUrl/Name`, `dateReceived`, `notes`. Aging from `dateReceived` per partner terms.
10. **Partner payments:** a disbursement to a partner. Tagged to **one partner bill** (`partnerBillId`) and the **funding client payment** (`sourceClientPaymentId`, must be `received`). USD `amount`, `mode`, `status` (`pending`→`paid`), `attachmentUrl`, `paymentDate`, `notes`. A partner bill supports partial payment (progress = Σ paid partner payments / bill amount).
11. **Currency:** partner bills + partner payments are **USD only** (single amount field; no currency/forex fields). Client side stays PKR as in Phase 1.

## Data model changes

- **`payment_terms` +** `days` integer (nullable; null = no aging).
- **`payments` +** `status` text not null default `'pending'`. Migration backfills existing rows to `'received'` (they were real receipts).
- **New `partner_bills`:** `{ id, code text unique, partnerInvoiceNumber text, partnerId FK→partners restrict, clientId FK→clients set null, partnerPurchaseOrderId FK→partner_purchase_orders set null, amount numeric(14,2), attachmentUrl text, attachmentName text, dateReceived date, notes text, createdById FK→users set null, createdAt, updatedAt }`.
- **New `partner_payments`:** `{ id, partnerId FK→partners restrict, partnerBillId FK→partner_bills cascade, sourceClientPaymentId FK→payments set null, amount numeric(14,2), mode text, status text not null default 'pending', attachmentUrl text, paymentDate date, notes text, createdById FK→users set null, createdAt }`.
- Code generation: `PBILL-` prefix via the same `formatPoCode` + prepend pattern (sequence per partner per year).

## Aging model (shared util)

`app/lib/aging.ts` → `computeAging({ start: Date|null, termDays: number|null, now: Date, settled: boolean }): { daysLeft: number|null, color: "green"|"yellow"|"red"|"neutral", overdue: boolean }`.
- `settled` or missing `start`/`termDays` → `neutral` (no clock).
- `elapsed = now − start` (days). `daysLeft = termDays − elapsed`.
- `elapsed ≤ termDays/2` → green; `termDays/2 < elapsed ≤ termDays` → yellow; `elapsed > termDays` → red (`overdue`).
- Pure + unit‑tested (green/yellow/red/overdue/settled/no‑terms cases).

Consumers: Billing Summary (client billing, start `invoiceGeneratedAt`, client term days, settled = fully paid by received payments); Partner Billing (partner bill, start `dateReceived`, partner term days, settled = fully paid by paid partner payments). A billing with no generated invoice, or a bill with no term, shows neutral.

## Phase 2A — Invoice & Summary polish + attachment fix (no schema)

**Invoice (`components/billings/BillingInvoice.tsx`):**
- Totals block → Total of Events (USD) → Forex → **Net Amount (PKR)** (= `grossTotalPkr`) → Sales Tax @ `salesTaxPct`% → Total Invoice Amount. Remove the net‑total and gross rows.
- Add a **Payment Terms** line (already have `paymentTerms`) and a **Clauses** block. Extract PartnerInvoice's clause list to `app/lib/invoice-clauses.ts` (`invoiceClauses(paymentTerm?)`) and use it in both `PartnerInvoice` and `BillingInvoice` (DRY; PartnerInvoice behavior unchanged).
- **Table grouping:** iterate lines; render partner name + agency with `rowSpan = line.items.length`, then one `<tr>` per event (event, rate, count, line total). Clean, no repetition.

**Summary/modal:**
- `components/billings/CreateBillingDialog.tsx`: remove the "Net Margin" figure from the preview footer (keep Total Invoice).
- `app/(dashboard)/billings/summary/page.tsx`: in the collapsed group row, render partner name(s) — `b.lines.map(l => l.partnerName).join(", ")` (dedup) — as a column/inline. Expand unchanged.

**Attachment fix:** reproduce first (the save/return path is correct — POST persists `chequeImageUrl`/`receiptUrl`, `mapPayment` returns them). Most likely the **upload endpoint** (`/api/uploads/payment-attachment`) fails when Supabase storage isn't configured (bucket/keys), so `receiptUrl` never gets set. Verify env/bucket; surface upload errors clearly; confirm a successful upload → visible link in the row and edit dialog. If the cause is purely env/config, document the required `SUPABASE_*` + bucket setup rather than changing code.

## Phase 2B — Payment status + terms/days + client aging

- **Schema:** `payment_terms.days`; `payments.status` (+ backfill). OpenAPI + codegen for the new fields; `PaymentTermInput`/`PaymentTerm` gain `days`; `PaymentDetail`/`PaymentInput` gain `status`.
- **Payment terms UI** (wherever terms are managed — settings/terms screen): add a **days** input.
- **Payment status:** create‑payment defaults `pending`; a `StatusSelect`‑style control on the client Payments list toggles `pending`↔`received`. `billingNetReceivable`/`amountPaid` and the Summary progress now count **only `received`** client payments (filter allocations by their payment's status). Over‑allocation validation counts **all** allocations (pending + received) so two payments can't jointly over‑promise a billing, while progress/paid/aging reflect only received.
- **Client aging on Summary:** add an **aging indicator** (colored pill / days‑left) per billing using `computeAging(invoiceGeneratedAt, clientTermDays, now, settled)`. Requires `mapBilling` to also return the client's term **days** (join `payment_terms.days`).

## Phase 2C — Partner subsystem (Billing/Payments tabs)

- **Schema + API:** `partner_bills`, `partner_payments` tables; CRUD routes; `PBILL-` code gen; OpenAPI + codegen. `mapPartnerBill` returns joined `partnerName`, `clientName`, `code`, `partnerInvoiceNumber`, `amount`, `amountPaid` (Σ paid partner payments), `dateReceived`, partner **term days**, and computed aging inputs. Helper endpoints: partner's PPOs for prefill; received client payments for the funding dropdown.
- **Navigation:** restructure **Billing** into a tabs shell (**Client** = existing Summary/Detail sub‑views; **Partner** = Partner Billing) and **Payments** into tabs (**Client** = existing receipts; **Partner** = partner disbursements). Sidebar simplifies to `Billing` + `Payments` (each tabbed) rather than the separate Summary/Detail items.
- **Partner Billing page:** list (Sr | PBILL code | Partner | Client | Amount (USD) | Paid | Pending | Aging | Their Inv# | Date Received | Actions). Create dialog: Partner → Client → optional Partner PO (prefills USD amount from PO budget) → their invoice # → attachment → date received. Aging pill per row.
- **Partner Payments (Payments → Partner tab):** list (Partner | Client | Partner Bill (PBILL) | Funding client payment | Amount | Mode | Status | Date | Attachment | Actions). Create dialog: select **partner bill** (shows pending) → select **funding client payment** (received only) → amount (≤ bill pending) → mode/date/attachment → status. `StatusSelect` toggles `pending`↔`paid`; only `paid` counts toward the bill's paid/progress and stops aging.
- **Partner aging** lives on the Partner Billing list (start = `dateReceived`, partner term days), same color logic as client billing.
- Permissions: reuse/extend billing + payment permissions (e.g. `View Billings`/`Edit Billings` cover partner billing; `View Payments`/`Edit Payments` cover partner payments) — confirm during planning; add a permission only if partner data needs separate gating.

## Files (indicative)

**New:** `app/lib/aging.ts` (+ test), `app/lib/invoice-clauses.ts`; `lib/db/src/schema/{partner-bills,partner-payments}.ts`; `app/app/api/partner-bills/**`, `app/app/api/partner-payments/**`, helper routes; `app/components/billings/PartnerBillingTab.tsx`, `CreatePartnerBillDialog.tsx`, `app/components/payments/{ClientPaymentsTab,PartnerPaymentsTab,CreatePartnerPaymentDialog}.tsx`; billing/payments tab shells.
**Changed:** `payment-terms.ts`, `payments.ts` schemas; `openapi.yaml` (+ codegen); `BillingInvoice.tsx`, `PartnerInvoice.tsx` (shared clauses); `CreateBillingDialog.tsx`, `billings/summary/page.tsx`, `billings/detail/page.tsx` (aging); `payments/page.tsx` → tabbed; `app/app/api/billings/route.ts` (term days + received‑only paid), `payments/route.ts`+`[id]` (status); `Sidebar.tsx`; `app/scripts/seed.ts` (term days backfill / payment status backfill).

## Out of scope
- Automated reconciliation (auto‑matching partner payments to client receipts / mismatch alerts) — manual tagging already gives traceability; purely additive later.
- Editing the client‑events / partner‑payout catalogs — already managed on the client/partner screens.
- Multi‑currency partner bills/payments — USD only for now.

## Open considerations (non‑blocking)
- Over‑allocation basis with pending payments (validation counts all; progress counts received) — stated above; confirm in planning.
- Whether the client Billing "Client" tab keeps two sub‑views (Summary/Detail) or merges — planning detail; default keep both as sub‑tabs.
- Partner payment currency assumed USD to match PO budgets; revisit only if partners bill in PKR/mixed later.