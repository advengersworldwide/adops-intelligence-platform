"use client";

import { useMemo, type ReactNode } from "react";
import { Check, ChevronDown, RotateCcw } from "lucide-react";
import {
  useListClients,
  useListPartners,
  useListBuyingHouses,
} from "@workspace/api-client-react";
import { useAnalyticsFilters, type RevenueEngine } from "@/hooks/use-analytics-filters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

/** ISO YYYY-MM-DD for a given Date, in local time. */
function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function today(): Date {
  return new Date();
}

/** Date range presets: month/quarter/year-to-date and trailing 90 days. */
const DATE_PRESETS: { label: string; range: () => { dateFrom: string; dateTo: string } }[] = [
  {
    label: "MTD",
    range: () => {
      const to = today();
      const from = new Date(to.getFullYear(), to.getMonth(), 1);
      return { dateFrom: toISODate(from), dateTo: toISODate(to) };
    },
  },
  {
    label: "QTD",
    range: () => {
      const to = today();
      const quarterStartMonth = Math.floor(to.getMonth() / 3) * 3;
      const from = new Date(to.getFullYear(), quarterStartMonth, 1);
      return { dateFrom: toISODate(from), dateTo: toISODate(to) };
    },
  },
  {
    label: "YTD",
    range: () => {
      const to = today();
      const from = new Date(to.getFullYear(), 0, 1);
      return { dateFrom: toISODate(from), dateTo: toISODate(to) };
    },
  },
  {
    label: "90d",
    range: () => {
      const to = today();
      const from = new Date(to);
      from.setDate(from.getDate() - 90);
      return { dateFrom: toISODate(from), dateTo: toISODate(to) };
    },
  },
];

const ENGINES: { value: RevenueEngine; label: string }[] = [
  { value: "media", label: "Media" },
  { value: "performance", label: "Performance" },
  { value: "combined", label: "Combined" },
];

interface MultiSelectItem {
  id: number;
  name: string;
}

interface MultiSelectProps {
  label: string;
  items: MultiSelectItem[];
  selectedIds: number[];
  onChange: (nextIds: number[]) => void;
  isLoading?: boolean;
}

/** Popover + Command multi-select: toggles an id in the selected array on click. */
function MultiSelect({ label, items, selectedIds, onChange, isLoading }: MultiSelectProps) {
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const toggle = (id: number) => {
    if (selectedSet.has(id)) {
      onChange(selectedIds.filter((existingId) => existingId !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 text-xs"
          aria-label={`Filter by ${label}`}
        >
          {label}
          {selectedIds.length > 0 && (
            <Badge variant="secondary" className="ml-0.5 px-1.5 py-0 text-[10px]">
              {selectedIds.length}
            </Badge>
          )}
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder={`Search ${label.toLowerCase()}...`} />
          <CommandList>
            <CommandEmpty>{isLoading ? "Loading..." : "No results found."}</CommandEmpty>
            <CommandGroup>
              {items.map((item) => {
                const isSelected = selectedSet.has(item.id);
                return (
                  <CommandItem
                    key={item.id}
                    value={item.name}
                    onSelect={() => toggle(item.id)}
                    className="cursor-pointer"
                  >
                    <span
                      className={cn(
                        "flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                        isSelected ? "bg-primary text-primary-foreground" : "opacity-50"
                      )}
                    >
                      {isSelected && <Check className="h-3 w-3" />}
                    </span>
                    <span className="truncate">{item.name}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function FilterSection({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-2">{children}</div>;
}

export function FilterBar() {
  const { filters, setFilters, reset } = useAnalyticsFilters();

  const { data: clients, isLoading: clientsLoading } = useListClients();
  const { data: partners, isLoading: partnersLoading } = useListPartners();
  const { data: buyingHouses, isLoading: buyingHousesLoading } = useListBuyingHouses();

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
      {/* Date range */}
      <FilterSection>
        <Input
          type="date"
          aria-label="Start date"
          value={filters.dateFrom}
          onChange={(e) => setFilters({ dateFrom: e.target.value })}
          className="w-36 text-sm"
        />
        <span className="text-xs text-muted-foreground">to</span>
        <Input
          type="date"
          aria-label="End date"
          value={filters.dateTo}
          onChange={(e) => setFilters({ dateTo: e.target.value })}
          className="w-36 text-sm"
        />
      </FilterSection>

      <FilterSection>
        {DATE_PRESETS.map((preset) => (
          <Button
            key={preset.label}
            type="button"
            variant="outline"
            size="sm"
            className="text-xs"
            onClick={() => setFilters(preset.range())}
          >
            {preset.label}
          </Button>
        ))}
      </FilterSection>

      {/* Engine toggle */}
      <div className="flex items-center rounded-md border border-border p-0.5" role="group" aria-label="Engine">
        {ENGINES.map((engine) => (
          <Button
            key={engine.value}
            type="button"
            variant={filters.engine === engine.value ? "default" : "ghost"}
            size="sm"
            className="text-xs"
            onClick={() => setFilters({ engine: engine.value })}
            aria-pressed={filters.engine === engine.value}
          >
            {engine.label}
          </Button>
        ))}
      </div>

      {/* Entity multi-selects */}
      <FilterSection>
        <MultiSelect
          label="Client"
          items={clients ?? []}
          selectedIds={filters.clientIds}
          onChange={(clientIds) => setFilters({ clientIds })}
          isLoading={clientsLoading}
        />
        <MultiSelect
          label="Partner"
          items={partners ?? []}
          selectedIds={filters.partnerIds}
          onChange={(partnerIds) => setFilters({ partnerIds })}
          isLoading={partnersLoading}
        />
        <MultiSelect
          label="Buying House"
          items={buyingHouses ?? []}
          selectedIds={filters.buyingHouseIds}
          onChange={(buyingHouseIds) => setFilters({ buyingHouseIds })}
          isLoading={buyingHousesLoading}
        />
      </FilterSection>

      {/* Compare toggle */}
      <div className="flex items-center gap-2">
        <Switch
          id="compare-toggle"
          checked={filters.compare}
          onCheckedChange={(compare) => setFilters({ compare })}
        />
        <label htmlFor="compare-toggle" className="text-xs text-muted-foreground cursor-pointer">
          Compare to previous
        </label>
      </div>

      {/* Reset */}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="ml-auto gap-1.5 text-xs text-muted-foreground"
        onClick={reset}
      >
        <RotateCcw className="h-3.5 w-3.5" />
        Reset
      </Button>
    </div>
  );
}
