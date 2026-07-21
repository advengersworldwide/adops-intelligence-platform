"use client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { computePreset, type DashRange } from "@/lib/dashboard/range-context";

export function DashboardDateRange({ value, onChange }: { value: string; onChange: (key: string, range: DashRange) => void }) {
  return (
    <Select value={value} onValueChange={(k) => onChange(k, computePreset(k))}>
      <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="mtd">Month to date</SelectItem>
        <SelectItem value="last30">Last 30 days</SelectItem>
        <SelectItem value="qtd">Quarter to date</SelectItem>
        <SelectItem value="ytd">Year to date</SelectItem>
      </SelectContent>
    </Select>
  );
}
