# Billing Phase 2A — Invoice & Summary Polish + Attachment Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the client invoice (single "Net Amount" = gross value, shared clauses, partner/agency grouped with per-event rows), remove Net Margin from the Create Billing modal, show partner name(s) on the Billing Summary row, and fix payment attachments not appearing.

**Architecture:** Pure frontend + one shared util; **no DB/OpenAPI/codegen changes**. Extract PartnerInvoice's hardcoded clause list into a shared `app/lib/invoice-clauses.ts` (TDD) reused by both invoices, then apply focused edits to `BillingInvoice.tsx`, `CreateBillingDialog.tsx`, and `billings/summary/page.tsx`. The attachment issue is an investigate-then-fix task.

**Tech Stack:** Next.js 15 App Router, React 19, shadcn/ui, vitest.

**Spec:** `docs/superpowers/specs/2026-07-11-billing-phase2-design.md` (Phase 2A).

---

## File Structure

- **Create** `app/lib/invoice-clauses.ts` — shared `invoiceClauses(paymentTerm?, fallback?)` returning the standard clause list. Single responsibility: the clause text.
- **Create** `app/lib/invoice-clauses.test.ts` — unit tests for the util.
- **Modify** `app/components/purchase-orders/PartnerInvoice.tsx` — use the shared util (behavior unchanged).
- **Modify** `app/components/billings/BillingInvoice.tsx` — Net Amount totals, clauses block, partner/agency rowspan grouping.
- **Modify** `app/components/billings/CreateBillingDialog.tsx` — drop Net Margin from the preview.
- **Modify** `app/app/(dashboard)/billings/summary/page.tsx` — partner name(s) on the collapsed row.
- **Investigate/Fix** payment attachment upload/display (`app/app/(dashboard)/payments/page.tsx`, `app/app/api/uploads/payment-attachment/route.ts`, env/bucket).

Work happens in a dedicated worktree off `main` (created before Task 1).

---

## Task 1: Shared invoice clauses util (TDD)

**Files:**
- Create: `app/lib/invoice-clauses.ts`, `app/lib/invoice-clauses.test.ts`
- Modify: `app/components/purchase-orders/PartnerInvoice.tsx`

- [ ] **Step 1: Write the failing test** — `app/lib/invoice-clauses.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { invoiceClauses } from "./invoice-clauses";

describe("invoiceClauses", () => {
  it("uses the payment term when provided", () => {
    expect(invoiceClauses("Net 30")[0]).toBe("Payment terms: Net 30");
  });
  it("uses the fallback when the term is empty/null", () => {
    expect(invoiceClauses("", "as agreed with the partner")[0]).toBe("Payment terms: as agreed with the partner");
    expect(invoiceClauses(null)[0]).toBe("Payment terms: as agreed");
  });
  it("returns the standard 6 clauses ending with the signature note", () => {
    const c = invoiceClauses("Net 30");
    expect(c).toHaveLength(6);
    expect(c[c.length - 1]).toContain("system generated document");
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `cd app && pnpm vitest run lib/invoice-clauses.test.ts`
Expected: FAIL — cannot find module `./invoice-clauses`.

- [ ] **Step 3: Implement `app/lib/invoice-clauses.ts`**

```typescript
// Shared clause list for generated invoices (client billing invoice + partner PO invoice).
// `fallback` lets each caller keep its own "no terms" wording.
export function invoiceClauses(paymentTerm?: string | null, fallback = "as agreed"): string[] {
  const term = paymentTerm && paymentTerm.trim() ? paymentTerm : fallback;
  return [
    `Payment terms: ${term}`,
    "Please make sure final billing does not exceed the specified PO amount",
    "Billing will be processed based on the reporting methodology aligned",
    "All payments will be made via bank transfer to the specified bank account",
    "Please notify any discrepancies in the PO details and/or amount within 3 business days of receiving the PO",
    "This is a system generated document and does not require a physical signature",
  ];
}
```

- [ ] **Step 4: Run the test — verify it passes**

Run: `cd app && pnpm vitest run lib/invoice-clauses.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Refactor `PartnerInvoice.tsx` to use the shared util (behavior unchanged)**

READ `app/components/purchase-orders/PartnerInvoice.tsx`. It currently defines a local `const clauses = (paymentTerm) => [ ... ]` (with the fallback `"as agreed with the partner"`). Replace that local definition with an import, and update the call site to pass the same fallback so the rendered text is identical:
- Add near the top imports: `import { invoiceClauses } from "@/lib/invoice-clauses";`
- Delete the local `const clauses = (...) => [...]` block.
- At the call site, replace `clauses(<term>)` with `invoiceClauses(<term>, "as agreed with the partner")` (keep whatever `<term>` expression it already passes).

Verify the partner invoice still renders the exact same 6 clause lines.

- [ ] **Step 6: Verify + commit**

Run: `cd app && pnpm typecheck` → 0 errors. `pnpm vitest run lib/invoice-clauses.test.ts` → PASS.
```bash
git add app/lib/invoice-clauses.ts app/lib/invoice-clauses.test.ts app/components/purchase-orders/PartnerInvoice.tsx
git commit -m "feat(invoice): extract shared invoiceClauses util; PartnerInvoice reuses it"
```

---

## Task 2: BillingInvoice redesign — Net Amount, clauses, grouped table

**Files:** Modify `app/components/billings/BillingInvoice.tsx`

Current state (verified): the totals block renders `Net Total (PKR)` **and** `Gross Total (PKR)`; the line-items `<tbody>` flat-maps `lines → items` so the partner + agency repeat on every event row; a plain `Payment Terms:` line and a `This is a system generated document…` line sit below the totals.

- [ ] **Step 1: Add the import**

At the top with the other imports, add:
```typescript
import { invoiceClauses } from "@/lib/invoice-clauses";
```

- [ ] **Step 2: Collapse the totals to a single "Net Amount" (= gross value)**

Replace the totals block (the `{/* Totals */}` `<div>` containing the `TotalRow`s) with:
```tsx
        {/* Totals */}
        <div className="mt-4 ml-auto text-sm" style={{ width: "320px" }}>
          <TotalRow label="Total of Events (USD)" value={`$${money(totals.netTotalUsd)}`} />
          <TotalRow label="Forex Rate" value={String(b.forexSellingRate)} />
          <TotalRow label="Net Amount (PKR)" value={money(totals.grossTotalPkr)} />
          <TotalRow label={`Sales Tax @ ${b.salesTaxPct}%`} value={money(totals.salesTax)} />
          <TotalRow label="Total Invoice Amount" value={money(totals.totalInvoice)} bold />
        </div>
```
(The `netTotalPkr` field in the `totals` reducer is now unused — remove `netTotalPkr` from both the accumulator object and the returned object in the `b.lines.reduce(...)` at the top of the component to avoid an unused value. Leave `netTotalUsd`, `grossTotalPkr`, `salesTax`, `totalInvoice`.)

- [ ] **Step 3: Group partner + agency once per partner (rowspan), rows per event**

Replace the `<tbody>` of the line-items table with:
```tsx
          <tbody>
            {b.lines.map((line) =>
              line.items.map((it, idx) => (
                <tr key={`${line.id}-${it.id}`}>
                  {idx === 0 && (
                    <>
                      <td rowSpan={line.items.length} className="px-3 py-2" style={{ border: "1px solid #d1d5db", verticalAlign: "middle" }}>{line.partnerName}</td>
                      <td rowSpan={line.items.length} className="px-3 py-2" style={{ border: "1px solid #d1d5db", verticalAlign: "middle" }}>{b.buyingHouseName ?? "—"}</td>
                    </>
                  )}
                  <td className="px-3 py-2" style={{ border: "1px solid #d1d5db", verticalAlign: "middle" }}>{it.eventName}</td>
                  <td className="px-3 py-2" style={{ border: "1px solid #d1d5db", verticalAlign: "middle" }}>{it.billableRate}</td>
                  <td className="px-3 py-2" style={{ border: "1px solid #d1d5db", verticalAlign: "middle" }}>{it.eventCount.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right" style={{ border: "1px solid #d1d5db", verticalAlign: "middle" }}>{money(it.eventCount * it.billableRate)}</td>
                </tr>
              )),
            )}
          </tbody>
```

- [ ] **Step 4: Replace the Payment Terms + signature lines with a Clauses block**

Replace the two `<p>` lines (`Payment Terms: …` and `This is a system generated document …`) with a clauses list driven by the shared util (the util's first line already includes the payment terms, and its last line is the signature note):
```tsx
        {/* Clauses */}
        <div className="mt-6 text-xs" style={{ color: "#4b5563" }}>
          <ul style={{ listStyleType: "disc", paddingLeft: "18px", lineHeight: "1.7" }}>
            {invoiceClauses(b.paymentTerms).map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
```
Keep the `{b.notes && …}` Notes block above it as-is, and keep the footer/spacer below unchanged.

- [ ] **Step 5: Verify + commit**

Run: `cd app && pnpm typecheck` → 0 errors.
Optional visual: generate an invoice for an approved billing and confirm — one "Net Amount (PKR)" row (no Net Total / Gross rows), partner+agency appear once per partner with event rows beneath, and a bulleted clauses block that starts with "Payment terms: …" and ends with the system-generated note.
```bash
git add app/components/billings/BillingInvoice.tsx
git commit -m "feat(invoice): Net Amount = gross; grouped partner/agency rows; shared clauses"
```

---

## Task 3: Remove Net Margin from the Create Billing modal

**Files:** Modify `app/components/billings/CreateBillingDialog.tsx`

- [ ] **Step 1: Drop the Net Margin from the preview**

READ the file. Near the bottom of the dialog there is a preview summary that computes and shows both Total Invoice and Net Margin, e.g.:
```tsx
const preview = lines.reduce((acc, l) => {
  const c = computeBilling({ /* … */ });
  return { totalInvoice: acc.totalInvoice + c.totalInvoice, netMargin: acc.netMargin + c.netMargin };
}, { totalInvoice: 0, netMargin: 0 });
```
and a footer:
```tsx
<div className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2 text-xs">
  <span>Total Invoice: <b>PKR {fmt(preview.totalInvoice)}</b></span>
  <span>Net Margin: <b>PKR {fmt(preview.netMargin)}</b></span>
</div>
```
Make two changes:
- Remove the `Net Margin` `<span>` from the footer (keep the Total Invoice span). With only one item left, the `justify-between` layout still looks fine, or switch the wrapper to a plain left-aligned line — either is acceptable.
- Simplify the `preview` reducer to only accumulate `totalInvoice` (drop `netMargin` from the accumulator + returned object) so no margin is computed in the modal.

(If the actual variable/markup differs slightly, adapt — the requirement is simply: the Create Billing modal shows Total Invoice and **no** Net Margin.)

- [ ] **Step 2: Verify + commit**

Run: `cd app && pnpm typecheck` → 0 errors.
```bash
git add app/components/billings/CreateBillingDialog.tsx
git commit -m "feat(billing): hide Net Margin in the Create Billing modal"
```

---

## Task 4: Show partner name(s) on the Billing Summary row

**Files:** Modify `app/app/(dashboard)/billings/summary/page.tsx`

- [ ] **Step 1: Add a Partner(s) column to the collapsed group row**

READ the file. The Summary table header array is roughly `["", "Client", "Agency", "Month", "CPO", "Total Invoice (PKR)", "Paid (PKR)", "Pending (PKR)", "Progress", "Status", "Actions"]`, and each billing renders a `<BillingGroup>` header row (the collapsed row) plus expandable partner sub-rows.
- Insert a **"Partner(s)"** header immediately after `"Client"` in the header array.
- In the collapsed group row (`BillingGroup`), insert a matching `<td>` after the Client cell that lists the distinct partner names on the billing:
```tsx
<td className="px-3 py-2 text-xs">
  {[...new Set(b.lines.map(l => l.partnerName))].join(", ") || "—"}
</td>
```
- Update any `colSpan` on the skeleton loading row, the empty-state row, and the expandable sub-rows so the column count stays consistent (header grew by 1). Recount the sub-row cells (leading toggle cell + the spans) and bump the trailing spacer `colSpan` by 1 so each sub-row still totals the header count.

- [ ] **Step 2: Verify + commit**

Run: `cd app && pnpm typecheck` → 0 errors. Load `/billings/summary`: the collapsed row shows the partner name(s); a multi-partner billing shows all, comma-separated; expanding still shows the per-partner breakdown.
```bash
git add app/app/\(dashboard\)/billings/summary/page.tsx
git commit -m "feat(billing): show partner name(s) on the Billing Summary row"
```

---

## Task 5: Fix payment attachments not showing

**Files:** Investigate; fix the real cause (likely `app/app/api/uploads/payment-attachment/route.ts` / Supabase config, or `app/app/(dashboard)/payments/page.tsx`).

The API save/return path is already correct (POST persists `chequeImageUrl`/`receiptUrl`; `mapPayment` returns them; the table renders Cheque/Receipt links). So the attachment either never gets a URL (upload failing) or the URL isn't displayed.

- [ ] **Step 1: Reproduce and find the root cause**

With the app running, record a payment and attach a receipt, watching the network + server logs:
- READ `app/app/api/uploads/payment-attachment/route.ts`. Confirm it uploads to Supabase Storage and returns `{ url }`. Check it references the correct bucket and reads `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` (or equivalent) from env.
- In the payments dialog, `handleFileUpload` POSTs the file to `/api/uploads/payment-attachment` and sets `receiptUrl`/`chequeImageUrl` from the response. Confirm the request succeeds (200 + a URL). If it 4xx/5xx, the upload is the problem.
- Determine which of these is true and note it: (a) upload endpoint errors (missing env/bucket, wrong bucket name, RLS/permissions) → URL never set; (b) upload succeeds but the URL isn't persisted/returned → check the POST body + `mapPayment`; (c) URL is stored but the row doesn't render it → check the table cell condition.

- [ ] **Step 2: Apply the fix for the identified cause**

- If (a) env/bucket/config: ensure `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` are set in `.env` and the storage bucket exists and is public/appropriately permissioned; surface a clear error toast on upload failure (the dialog already toasts "Upload failed" — verify it fires). If the fix is purely configuration (no code bug), document the required env vars + bucket setup in the commit message / a short note, and add a defensive check in the upload route that returns a clear 500 message when env is missing.
- If (b) persistence/return: correct the POST body/`mapPayment` so the URL round-trips.
- If (c) display: fix the render condition in the payments table row and/or the edit dialog's "View" link.
- Whatever the cause, the acceptance is: after attaching a file and saving, the payment row's **Attachments** cell shows a working **Receipt** (or **Cheque**) link, and re-opening the payment shows the **View** link.

- [ ] **Step 3: Verify + commit**

Run: `cd app && pnpm typecheck` → 0 errors. Manually: create a payment with an attachment → the link appears in the list and opens the file.
```bash
git add -A
git commit -m "fix(payments): attachments now save + display when recording a payment"
```

---

## Self-Review checklist (run before handing off)

- **Spec coverage (2A):** Net Amount = gross + drop gross row (T2) · client payment terms + partner clauses on invoice (T1+T2) · partner/agency grouped once, event rows (T2) · remove Net Margin from modal (T3) · partner name(s) on Summary row (T4) · attachment fix (T5). All covered.
- **Placeholder scan:** none — each code step is complete; T5 is an investigate-then-fix task with concrete branches and a crisp acceptance criterion.
- **Type consistency:** `invoiceClauses(paymentTerm?, fallback?)` signature used identically in T1 (PartnerInvoice) and T2 (BillingInvoice); `totals.grossTotalPkr` / `totals.netTotalUsd` / `totals.salesTax` / `totals.totalInvoice` names match the existing reducer.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-11-billing-phase2a.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, two-stage review between tasks.
2. **Inline Execution** — execute tasks in this session with checkpoints.

After 2A lands I'll write the 2B plan (payment status + terms/days + client aging), then 2C (partner subsystem).