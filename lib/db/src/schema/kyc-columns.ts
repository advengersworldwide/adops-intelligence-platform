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
