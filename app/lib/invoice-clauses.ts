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
