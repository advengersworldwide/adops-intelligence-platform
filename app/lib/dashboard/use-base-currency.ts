"use client";

import { useGetTaxSettings } from "@workspace/api-client-react";

/**
 * Single source of truth for the app's base display currency.
 * Backed by the DB (tax_settings.baseCurrency); defaults to PKR until loaded.
 * Rates + partner amounts stay USD regardless — this only governs analytics/dashboard aggregates.
 */
export function useBaseCurrency(): string {
  const { data } = useGetTaxSettings();
  return data?.baseCurrency ?? "PKR";
}
