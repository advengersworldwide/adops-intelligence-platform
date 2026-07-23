"use client";

import { useMemo, useState } from "react";
import { ArrowUpDown, ArrowUp, ArrowDown, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type SortDir = "asc" | "desc";
export interface SortState {
  key: string;
  dir: SortDir;
}

type SortValue = string | number | null | undefined;
type Accessor<T> = (row: T) => SortValue;

export interface FilterDef<T> {
  key: string;
  label: string;
  options: { value: string; label: string }[];
  predicate: (row: T, value: string) => boolean;
}

const ALL = "__all__";

function compareVals(a: SortValue, b: SortValue): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

/**
 * Client-side search + filter + sort for an already-loaded row list.
 * Callers supply accessors describing how to search/sort/filter their rows.
 */
export function useTableControls<T>(opts: {
  rows: T[] | undefined;
  searchAccessor: (row: T) => (string | number | null | undefined)[];
  sortAccessors: Record<string, Accessor<T>>;
  filters?: FilterDef<T>[];
  initialSort?: SortState;
}) {
  const { rows, searchAccessor, sortAccessors, filters, initialSort } = opts;
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortState | null>(initialSort ?? null);
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});

  const result = useMemo(() => {
    let out = rows ?? [];
    const q = search.trim().toLowerCase();
    if (q) {
      out = out.filter(r => searchAccessor(r).some(f => (f ?? "").toString().toLowerCase().includes(q)));
    }
    for (const f of filters ?? []) {
      const v = filterValues[f.key];
      if (v && v !== ALL) out = out.filter(r => f.predicate(r, v));
    }
    if (sort) {
      const acc = sortAccessors[sort.key];
      if (acc) out = [...out].sort((a, b) => compareVals(acc(a), acc(b)) * (sort.dir === "asc" ? 1 : -1));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, search, sort, filterValues]);

  const toggleSort = (key: string) =>
    setSort(s => (s?.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  const setFilter = (key: string, value: string) => setFilterValues(v => ({ ...v, [key]: value }));

  return { search, setSearch, sort, toggleSort, filterValues, setFilter, rows: result };
}

export function TableSearch({ value, onChange, placeholder = "Search…" }: {
  value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div className="relative w-full max-w-xs">
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="h-9 pl-9 text-sm" />
    </div>
  );
}

export function TableFilter({ label, value, options, onChange }: {
  label: string; value: string | undefined; options: { value: string; label: string }[]; onChange: (v: string) => void;
}) {
  return (
    <Select value={value ?? ALL} onValueChange={onChange}>
      <SelectTrigger className="h-9 w-auto min-w-[130px] text-xs"><SelectValue placeholder={label} /></SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{label}: All</SelectItem>
        {options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/** A sortable <th>. Drop-in replacement for a header cell; clicking cycles asc/desc. */
export function SortableTh({ label, sortKey, sort, onSort, className }: {
  label: string; sortKey: string; sort: SortState | null; onSort: (key: string) => void; className?: string;
}) {
  const active = sort?.key === sortKey;
  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th className={cn("px-3 py-2 text-left text-[10px] font-medium text-muted-foreground whitespace-nowrap", className)}>
      <button type="button" onClick={() => onSort(sortKey)} className="inline-flex items-center gap-1 hover:text-foreground">
        {label}
        <Icon className={cn("h-3 w-3", active ? "text-foreground" : "opacity-40")} />
      </button>
    </th>
  );
}

/** Build a distinct, sorted option list from row values (for filter dropdowns). */
export function distinctOptions<T>(rows: T[] | undefined, accessor: (r: T) => string | null | undefined): { value: string; label: string }[] {
  const set = new Set<string>();
  for (const r of rows ?? []) {
    const v = accessor(r);
    if (v) set.add(v);
  }
  return [...set].sort((a, b) => a.localeCompare(b)).map(v => ({ value: v, label: v }));
}
