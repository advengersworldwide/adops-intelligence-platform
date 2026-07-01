# PO Code Format — Client/Partner-scoped Codes

**Status:** Approved (design)
**Date:** 2026-06-28
**Author:** Bilal Zaidi (with Claude)

## Goal

Replace the generic purchase-order codes (`CPO-2026-0001`, `PPO-2026-0001`) with
codes scoped to the client or partner, so a code carries a human-readable prefix,
the month/year it was issued, and a running number:

```
PREFIX-MMYY-NNNN
```

- Client PO for Easypaisa in Jan 2026 → `EPAY-0126-0001`
- Client PO for JazzCash in Jan 2026 → `JAZZ-0126-0002`
- Partner PO to partner "Sandbox" in Jan 2026 → `SAND-0126-0001`

## Decisions (locked)

1. **Prefix source** — a **mandatory** `codePrefix` field on each client and each
   partner. Client POs use the client's prefix; Partner POs use the **partner's own**
   prefix (so the two document types never collide on a code).
2. **Prefix rules** — uppercase alphanumeric, **4–8 characters**, required.
3. **Date segment** — `MMYY` (2-digit month + 2-digit year) taken from the PO's
   creation date. `0126` = January 2026.
4. **Sequence** — a **global, monthly-resetting** running number, zero-padded to 4
   digits. Shared across all clients/partners (hence Easypaisa=0001, JazzCash=0002).
   Client POs and Partner POs keep **separate** counters.

## Format

```
<PREFIX>-<MM><YY>-<NNNN>
```

- `PREFIX` — the client's or partner's `codePrefix` (4–8 uppercase alphanumeric).
- `MM` — 2-digit month of creation (`01`–`12`).
- `YY` — 2-digit year of creation (`26` for 2026).
- `NNNN` — sequence, zero-padded to at least 4 digits; grows beyond 4 if needed.

## Data model

Add a `code_prefix` column to both tables:

- `clients.code_prefix` — `text NOT NULL`
- `partners.code_prefix` — `text NOT NULL`

### Migration / backfill

`NOT NULL` requires existing rows to be populated. Migration runs in this order:

1. Add `code_prefix` as **nullable**.
2. Backfill every existing row with a derived prefix:
   - Take the name, strip non-alphanumerics, uppercase it.
   - Use the first 4 characters. If fewer than 4 characters remain, right-pad with
     `X` to reach 4 (e.g. a name "Al" → `ALXX`). Edge case only; real names are longer.
3. Alter the column to `NOT NULL`.

Existing purchase orders keep their old `CPO-2026-xxxx` / `PPO-2026-xxxx` codes.
They are not migrated — codes are opaque identifiers, and the `code` unique
constraint still holds because old and new formats never collide.

## Prefix resolution & validation

- **Validation** (API input + form): `^[A-Z0-9]{4,8}$`. Forms uppercase input as the
  user types and enforce min 4 before submit.
- **Default suggestion** (create/edit forms): the derived 4-char value (first 4
  alphanumerics of the name, uppercased, `X`-padded) pre-fills the field but is fully
  editable. The user confirms or overrides it (e.g. `EASY` → `EPAY`).
- **No runtime fallback.** Because the prefix is mandatory and backfilled, it is
  always present. As a defensive guard, PO creation rejects with a clear error
  ("Set a PO code prefix for this client/partner first") if the prefix is somehow
  empty, rather than emitting a malformed code.

## Sequence generation

Global, monthly-resetting, per document type. Implemented with the existing
count-based pattern (no dedicated counter table — YAGNI, and it matches the current
`nextCpoCode`/`nextPpoCode` implementation):

- `next CPO sequence` = (count of `client_purchase_orders` rows with `created_at` in
  the current calendar month) + 1.
- `next PPO sequence` = (count of `partner_purchase_orders` rows with `created_at` in
  the current calendar month) + 1.

Notes / accepted trade-offs:

- **Pre-existing rows count.** If a month already has POs (including old-format ones),
  the first new code that month continues the count (could start at e.g. `0003`).
  This keeps sequence numbers unique within the month and chronological.
- **Race condition.** Two POs created in the same instant could compute the same
  sequence; the `code` unique constraint would reject the second insert. This is the
  same race the current code already has and is acceptable at present scale.

## `formatPoCode` refactor

Current:

```ts
export function formatPoCode(prefix: "CPO" | "PPO", year: number, seq: number): string {
  return `${prefix}-${year}-${String(seq).padStart(4, "0")}`;
}
```

New:

```ts
export function formatPoCode(prefix: string, date: Date, seq: number): string {
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yy = String(date.getFullYear() % 100).padStart(2, "0");
  return `${prefix}-${mm}${yy}-${String(seq).padStart(4, "0")}`;
}
```

- `nextCpoCode(clientId)` looks up the client's `codePrefix`, computes the monthly
  sequence, and returns `formatPoCode(prefix, new Date(), seq)`.
- `nextPpoCode(partnerId)` does the same with the partner's `codePrefix`.
- A small helper `derivePrefix(name: string): string` produces the 4-char default
  used by the backfill and the form auto-suggest, so the rule lives in one place.

## API & codegen

Add `codePrefix` to the OpenAPI schemas and regenerate the client + zod types:

- `Client`, `ClientInput`, `ClientUpdate`
- `Partner`, `PartnerInput`, `PartnerUpdate`
- Input/Update: `codePrefix` required, `minLength: 4`, `maxLength: 8`,
  `pattern: '^[A-Z0-9]{4,8}$'`.

Client and partner create/update route handlers persist `codePrefix`.

## UI

- **Client create dialog** (`clients/page.tsx`) and **client edit form**
  (`clients/[id]/page.tsx`): add a required "PO code prefix" field with the derived
  auto-suggest.
- **Partner create dialog** (`partners/page.tsx`) and **partner edit form**
  (`partners/[id]/DetailsTab.tsx`): same field.
- Uppercase-on-type, min-4 validation with an inline message.

## Testing

- `po-codes.test.ts` — rewrite for the new signature/format:
  - `formatPoCode("EPAY", new Date(2026, 0, 15), 1)` → `EPAY-0126-0001`.
  - month/year padding, year rollover (`2027` → `27`), sequence > 4 digits.
  - `derivePrefix("Easypaisa")` → `EASY`; short-name padding → `ALXX`.
- CPO/PPO route tests — update the mocked `select` chains so the prefix lookup and
  monthly count resolve; assert the generated code shape.

## Out of scope

- Migrating existing PO codes to the new format.
- A dedicated atomic sequence table (revisit only if code collisions appear at scale).
- Changing where PO codes are displayed (tables/invoice already render `code`).
