"use client";

import { useUpdatePaymentStatus, getListPaymentsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const COLORS: Record<string, string> = {
  pending: "text-yellow-700 dark:text-yellow-400",
  received: "text-emerald-700 dark:text-emerald-400",
};

export function PaymentStatusSelect({ paymentId, status }: { paymentId: number; status: string }) {
  const qc = useQueryClient();
  const mut = useUpdatePaymentStatus({ mutation: {
    onSuccess: () => qc.invalidateQueries({ queryKey: getListPaymentsQueryKey() }),
  }});
  return (
    <Select value={status} onValueChange={v => mut.mutate({ id: paymentId, data: { status: v as "pending" | "received" } })}>
      <SelectTrigger className={cn("h-7 w-28 text-xs capitalize", COLORS[status])}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="pending">Pending</SelectItem>
        <SelectItem value="received">Received</SelectItem>
      </SelectContent>
    </Select>
  );
}
