"use client";

import {
  useUpdatePartnerPaymentStatus,
  getListPartnerPaymentsQueryKey,
  getListPartnerBillsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const COLORS: Record<string, string> = {
  pending: "text-yellow-700 dark:text-yellow-400",
  settled: "text-emerald-700 dark:text-emerald-400",
};

export function PartnerPaymentStatusSelect({ paymentId, status }: { paymentId: number; status: string }) {
  const qc = useQueryClient();
  const mut = useUpdatePartnerPaymentStatus({ mutation: {
    onSuccess: () => {
      // settling advances the bill's paid/progress/aging, so refresh both lists
      qc.invalidateQueries({ queryKey: getListPartnerPaymentsQueryKey() });
      qc.invalidateQueries({ queryKey: getListPartnerBillsQueryKey() });
    },
  }});
  return (
    <Select value={status} onValueChange={v => mut.mutate({ id: paymentId, data: { status: v as "pending" | "settled" } })}>
      <SelectTrigger className={cn("h-7 w-28 text-xs capitalize", COLORS[status])}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="pending">Pending</SelectItem>
        <SelectItem value="settled">Settled</SelectItem>
      </SelectContent>
    </Select>
  );
}
