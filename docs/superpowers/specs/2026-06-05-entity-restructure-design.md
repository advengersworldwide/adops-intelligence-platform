# Entity Restructure — Design Spec (Sub-project 1)
**Date:** 2026-06-05
**Status:** Approved

---

## Overview

Restructure the entity hierarchy to reflect the actual business model:

**Service flow:** Client → Buying House → Reseller (us) → Platform  
**Invoicing flow:** Platform → Reseller → Buying House → Client

**What changes:**
- `buying_houses` becomes a first-class entity (Starcom, Mindshare, etc.)
- `billing_records.client_id` → `buying_house_id` (the buying house is who we invoice)
- `clients` loses its free-text `buying_house` field, gains a `buying_house_id` FK
- Campaigns removed from the UI sidebar (DB table kept, no data loss)
- New Buying Houses module in sidebar with analytics
- New Client detail page (read-only)

---

## 1. Data Model

### 1.1 New `buying_houses` table

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `name` | text NOT NULL | e.g. "Starcom", "GroupM" |
| `created_at` | timestamptz | defaultNow() |

### 1.2 `clients` table changes

**Remove:** `buying_house` (text)  
**Add:** `buying_house_id` (integer, nullable, FK → buying_houses ON DELETE SET NULL)

Remaining columns: `id`, `name`, `buying_house_id`, `pricing_model`, `margin_value`, `created_at`, `updated_at`

### 1.3 `billing_records` table changes

**Rename:** `client_id` → `buying_house_id` (FK → buying_houses, NOT NULL)

All other columns unchanged.

### 1.4 `campaigns` table

No changes to the DB. Table and data preserved. Removed from UI sidebar only.

### 1.5 Migration strategy

Existing data in `billing_records.client_id` pointed to client records that were being used as billing entities. These become buying houses:

1. Create `buying_houses` table
2. For each distinct client currently referenced in `billing_records`, insert a row into `buying_houses` using that client's name
3. Add `buying_house_id` column to `billing_records`; populate it from the client→buying_house mapping
4. Drop `billing_records.client_id`
5. Add `buying_house_id` (nullable) to `clients`; drop `clients.buying_house` text

---

## 2. API

### 2.1 New — Buying Houses

| Method | Path | Description |
|---|---|---|
| GET | `/buying-houses` | List all buying houses |
| POST | `/buying-houses` | Create `{ name }` |
| GET | `/buying-houses/:id` | Get one buying house |
| PATCH | `/buying-houses/:id` | Update name |
| DELETE | `/buying-houses/:id` | Delete |

**`BuyingHouse` response shape:**
```
{ id, name, createdAt }
```

**`BuyingHouseInput`:** `{ name: string (minLength 1) }`

### 2.2 Updated — Clients

**Remove from all shapes:** `buyingHouse` (text)  
**Add to response:** `buyingHouseId: number | null`, `buyingHouseName: string | null` (joined)  
**Add to create/update body:** `buyingHouseId: number | null`

### 2.3 Updated — Billing Records

**Rename in all shapes:** `clientId` → `buyingHouseId`, `clientName` → `buyingHouseName`

The `BillingRecord` response now returns `buyingHouseId` and `buyingHouseName` in place of `clientId` and `clientName`.

`BillingRecordInput` now requires `buyingHouseId` (integer) instead of `clientId`.

### 2.4 Removed — Campaigns

Campaign endpoints removed from OpenAPI spec and API routes. DB table untouched.

### 2.5 Updated — Analytics

`GET /analytics/by-client` — continues to work (clients still exist)  
Any query that joined via campaigns → updated to not join campaigns

---

## 3. Frontend

### 3.1 Sidebar

**Add:** Buying Houses (between Clients and Platforms)  
**Remove:** Campaigns link

### 3.2 Buying Houses page (`/buying-houses`)

**List table columns:** Name | Client Count | Total Net Margin (PKR) | Actions (edit/delete)

- Client Count: count of clients with `buying_house_id = this.id`
- Net Margin: aggregated from `billing_records` where `buying_house_id = this.id`
- Add/Edit dialog: single field — Name
- Click name → `/buying-houses/:id`

### 3.3 Buying House detail page (`/buying-houses/:id`) — read-only

**Header:** Back → buying house name

**4 KPI cards:** Total Receivable (PKR) | Total Payable (PKR) | Net Margin (PKR) | Margin %

**Monthly trend chart:** Area chart — net margin over time

**Client breakdown table:** Client Name | Total Receivable (PKR) | Net Margin (PKR)

All data sourced from `billing_records` filtered by `buying_house_id`.

### 3.4 Clients page (`/clients`) — updated

**Create/Edit dialog:**
- Remove free-text buying house field
- Add dropdown: "Buying House" (optional, shows all buying houses)
- Other fields unchanged (name, pricing model, margin value)

**List table:** Name | Buying House | Pricing Model | Margin Value | Actions  
Name is a clickable link → `/clients/:id`

### 3.5 Client detail page (`/clients/:id`) — new, read-only

**Header:** Back → client name + buying house badge (pill showing buying house name)

**Single page, no tabs:**

Section 1 — Info (display only, not editable here):
- Name, Buying House, Pricing Model, Margin Value

Section 2 — Billing History:
- Simple table: Period | Platform | Actual Pins | Net Margin (PKR)
- Sourced from `billing_records` where `buying_house_id = client.buying_house_id`, joined to platforms
- Since billing records link to buying houses (not individual clients), this shows the full activity of the buying house this client belongs to. This is intentional — a client is scoped to one buying house, and all billing for that buying house flows through here.

### 3.6 Platforms Transactions tab — updated

- "Billing Entity" column header → "Buying House"
- Data source: `buyingHouseName` (unchanged field in the record, just renamed)

---

## 4. Permissions

No new permission keys needed. Existing `"Edit Clients"` gates client creation/editing. A new `"Edit Buying Houses"` permission key will be added — existing roles (System Admin, Operator) get it; Viewer does not.

---

## 5. Out of Scope (this spec)

- Cost Management module (Sub-project 2)
- Buying House or Client analytics beyond what's listed above
- Re-using existing campaign data
