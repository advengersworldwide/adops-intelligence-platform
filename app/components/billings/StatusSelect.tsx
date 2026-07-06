"use client";

import { useUpdateBillingStatus, getListBillingsQueryKey } from "@workspace/api-client-react";
import type { BillingStatusInputStatus } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const COLORS: Record<string, string> = {
  pending: "text-yellow-700 dark:text-yellow-400",
  approved: "text-emerald-700 dark:text-emerald-400",
  dispute: "text-red-700 dark:text-red-400",
};

export function StatusSelect({ billingId, status }: { billingId: number; status: string }) {
  const qc = useQueryClient();
  const mut = useUpdateBillingStatus({ mutation: {
    onSuccess: () => qc.invalidateQueries({ queryKey: getListBillingsQueryKey() }),
  }});
  return (
    <Select
      value={status}
      onValueChange={v => mut.mutate({ id: billingId, data: { status: v as BillingStatusInputStatus } })}
    >
      <SelectTrigger className={cn("h-7 w-28 text-xs capitalize", COLORS[status])}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="pending">Pending</SelectItem>
        <SelectItem value="approved">Approved</SelectItem>
        <SelectItem value="dispute">Dispute</SelectItem>
      </SelectContent>
    </Select>
  );
}
