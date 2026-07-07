import { redirect } from "next/navigation";

// The legacy bills UI has been superseded by the PO/event-based billing model.
// Bare /billings now lands on the new Billing Summary page.
export default function BillingsIndexPage() {
  redirect("/billings/summary");
}
