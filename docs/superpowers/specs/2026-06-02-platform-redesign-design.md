# Platform Redesign — Design Spec
**Date:** 2026-06-02
**Status:** Approved

---

## Overview

Redesign the Platforms module to support rich vendor profile data, multi-cost-model configuration, and a full platform detail view with billing records and analytics. The existing global Transactions page is untouched.

---

## 1. Data Model

### 1.1 `platforms` table — changes

**Remove columns:**
- `cost_model`
- `currency`

**Add columns (all nullable):**

| Column | Type | Notes |
|---|---|---|
| `address` | text | |
| `poc_name` | text | Point of contact name |
| `poc_number` | text | |
| `poc_email` | text | |
| `company_email` | text | |
| `company_number` | text | |
| `bank_name` | text | |
| `bank_account_number` | text | |
| `bank_address` | text | |
| `swift_code` | text | |
| `iban` | text | |
| `sales_tax_number` | text | |
| `ntn_number` | text | |
| `payment_terms` | text | One of: `net_30`, `net_60`, `net_90`, `net_120`, `net_150` |
| `sales_tax_pct` | numeric | e.g. `15.0` — configurable per platform |
| `remittance_tax_pct` | numeric | e.g. `10.0` — configurable per platform |

### 1.2 New `platform_cost_models` table

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `platform_id` | integer FK → platforms | CASCADE DELETE |
| `name` | text NOT NULL | e.g. "CPM", "CPC", "CPA" |
| `margin_pct` | numeric NOT NULL | e.g. `20.0` |
| `created_at` | timestamp | |

One platform can have many cost models. Each cost model has an independent margin %.

### 1.3 New `billing_records` table

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `platform_id` | integer FK → platforms | CASCADE DELETE |
| `client_id` | integer FK → clients | Billing entity |
| `period` | text NOT NULL | Format: `"YYYY-MM"` e.g. `"2024-12"` |
| `appsflyer_pins` | integer NOT NULL | Raw pin count from Appsflyer |
| `fraud_pins` | integer NOT NULL | Fraud/invalid pins |
| `payout_rate` | numeric NOT NULL | USD per pin |
| `cost_model_id` | integer FK → platform_cost_models | Which cost model's margin % applies to this record |
| `created_at` | timestamp | |

All financial columns are **computed at display time** — nothing else is stored:

| Computed Column | Formula |
|---|---|
| Actual Pins | `appsflyer_pins - fraud_pins` |
| Net Amount (USD) | `actual_pins × payout_rate` |
| Forex Rate | From Settings (USD→PKR) |
| Net Amount (PKR) | `net_amount_usd × forex_rate` |
| Gross Amount (PKR) | `net_amount_pkr / (1 - margin_pct/100)` using platform's applicable cost model margin |
| Sales Tax | `gross_amount_pkr × (platform.sales_tax_pct / 100)` |
| Total Amount (PKR) | `gross_amount_pkr + sales_tax` |
| Receivable (PKR) | Exact formula to be confirmed during implementation — observed from data to be distinct from both Gross Amount and Total Amount. Likely a client-agreed net figure. |
| Net Payable (USD) | `net_amount_usd × (1 - margin_pct/100)` |
| Remittance Tax | `net_payable_usd × (platform.remittance_tax_pct / 100)` |
| Total Payable (USD) | `net_payable_usd + remittance_tax` |
| Forex Rate 2 | From Settings (same rate, used for payable conversion) |
| Total Payable (PKR) | `total_payable_usd × forex_rate` |
| Net Margin (PKR) | `receivable_pkr - total_payable_pkr` |

---

## 2. API Changes

### Platforms

- `GET /platforms` — returns list (removes `costModel`, `currency` from response; adds all new fields)
- `POST /platforms` — accepts create payload (see Section 3)
- `GET /platforms/:id` — returns full platform detail including cost models array
- `PATCH /platforms/:id` — accepts all platform fields
- `DELETE /platforms/:id` — unchanged

### Platform Cost Models

- `POST /platforms/:id/cost-models` — create cost model `{ name, margin_pct }`
- `PATCH /platforms/:id/cost-models/:cmId` — update cost model
- `DELETE /platforms/:id/cost-models/:cmId` — delete cost model

### Billing Records

- `GET /platforms/:id/billing-records` — list billing records for platform; supports `?period=2024-12&clientId=X` filters
- `POST /platforms/:id/billing-records` — create record `{ client_id, period, appsflyer_pins, fraud_pins, payout_rate }`
- `DELETE /platforms/:id/billing-records/:recordId` — delete record

---

## 3. Frontend

### 3.1 Platforms List Page (`/platforms`)

**Changes from current:**
- Remove "Cost Model" and "Currency" columns
- Platform name becomes a clickable link → navigates to `/platforms/:id`
- Analytics columns (Revenue, Cost, Profit, Margin %) remain — will eventually be sourced from `billing_records` aggregates; for now keep existing `useGetAnalyticsByPlatform` hook
- Create / Edit / Delete actions unchanged

### 3.2 Create Platform Dialog

Shown when clicking "Add Platform". Collects only the minimum needed to identify the platform — all financial/banking details are filled from within the detail page.

**Fields:**

| Field | Validation |
|---|---|
| Name | Required |
| Address | Optional |
| POC Name | Optional |
| POC Number | Optional |
| POC Email | Optional, email format |
| Company Email | Optional, email format |
| Company Number | Optional |
| Payment Terms | Optional dropdown: Net 30 / Net 60 / Net 90 / Net 120 / Net 150 |

### 3.3 Platform Detail Page (`/platforms/:id`)

**Route:** `/platforms/:id`

**Header:**
- `← Back` link to `/platforms`
- Platform name (h1)
- Last updated timestamp

**Three tabs: Details | Transactions | Analytics**

---

#### Details Tab

Five sections rendered as labeled cards. All fields inline-editable. Single "Save Changes" button at bottom — PATCH to `/platforms/:id` + cost model CRUDs as needed.

**Section 1 — General**
Name, Address, Company Email, Company Number

**Section 2 — Point of Contact**
POC Name, POC Number, POC Email

**Section 3 — Financial & Legal**
Bank Name, Account Number, Bank Address, SWIFT Code, IBAN, Sales Tax Number, NTN Number, Sales Tax % (numeric), Remittance Tax % (numeric)

**Section 4 — Payment Terms**
Dropdown (Net 30 / 60 / 90 / 120 / 150)

**Section 5 — Cost Models**
Dynamic list. Each row:
```
[ Cost Model Name (text) ]  [ Margin % (number) ]  [ × delete ]
```
"+ Add Cost Model" button appends a new empty row. Rows are saved/deleted via their own API calls on Save.

---

#### Transactions Tab (Billing Records)

**Filters bar:**
- Period picker (month + year)
- Client dropdown (all clients)
- Export CSV button

**Table columns:**

| # | Column | Source |
|---|---|---|
| 1 | S# | row index |
| 2 | Billing Entity | client name |
| 3 | Appsflyer Pins | stored |
| 4 | Fraud Pins | stored |
| 5 | Actual Pins | computed |
| 6 | Payout Rate | stored |
| 7 | Net Amount (USD) | computed |
| 8 | Forex Rate | from Settings |
| 9 | Net Amount (PKR) | computed |
| 10 | Gross Amount (PKR) | computed |
| 11 | Sales Tax (X%) | computed — X = platform.sales_tax_pct |
| 12 | Total Amount (PKR) | computed |
| 13 | Receivable (PKR) | computed |
| 14 | Net Payable (USD) | computed |
| 15 | Remittance Tax (X%) | computed — X = platform.remittance_tax_pct |
| 16 | Total Payable (USD) | computed |
| 17 | Forex Rate | from Settings |
| 18 | Total Payable (PKR) | computed |
| 19 | Net Margin (PKR) | computed |

**Totals row** pinned at bottom — sums all numeric columns.

**Add Record** button opens a small dialog with raw inputs only:
- Billing Entity (client dropdown, required)
- Period (month/year picker, required)
- Cost Model (dropdown of this platform's cost models, required — determines margin %)
- Appsflyer Pins (integer, required)
- Fraud Pins (integer, required)
- Payout Rate (numeric, required)

---

#### Analytics Tab

**KPI cards (4):**
- Total Receivable (PKR)
- Total Payable (PKR)
- Net Margin (PKR)
- Margin %

**Charts:**
- Monthly net margin trend — area chart (X = month, Y = net margin PKR)
- Per-client net margin breakdown — horizontal bar chart (one bar per billing entity)

Date range filter applies to both KPI cards and charts.

---

## 4. Permissions

No new permission keys needed. Existing `"Edit Platforms"` gates:
- Creating / editing / deleting platforms
- Adding / editing / deleting cost models
- Adding / deleting billing records

`"View Platforms"` gates read-only access to detail page, transactions, and analytics.

---

## 5. Out of Scope (this spec)

- Cost management module (future)
- Migrating existing analytics aggregates to use `billing_records` as source
- Bulk CSV upload for billing records (can be added later)
