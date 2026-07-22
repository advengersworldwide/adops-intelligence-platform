"use client";

import { PERMISSIONS, type Permission, type PermissionDef } from "@/lib/rbac/catalog";

export interface PermissionGroup {
  group: string;
  items: PermissionDef[];
}

export function groupPermissions(): PermissionGroup[] {
  const map = new Map<string, PermissionDef[]>();
  for (const p of PERMISSIONS) {
    if (!map.has(p.group)) map.set(p.group, []);
    map.get(p.group)!.push(p);
  }
  return [...map.entries()].map(([group, items]) => ({ group, items }));
}

const KIND_BADGE: Record<PermissionDef["kind"], string> = {
  action: "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  tab: "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
  field: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  workflow: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
};

export function RolePermissionEditor({
  selected,
  onToggle,
  onToggleGroup,
}: {
  selected: string[];
  onToggle: (key: Permission) => void;
  onToggleGroup: (keys: Permission[], allOn: boolean) => void;
}) {
  const groups = groupPermissions();
  const set = new Set(selected);
  return (
    <div className="space-y-4 max-h-[28rem] overflow-y-auto pr-1">
      {groups.map((g) => {
        const keys = g.items.map((i) => i.key as Permission);
        const allOn = keys.every((k) => set.has(k));
        return (
          <div key={g.group} className="rounded-xl border border-border p-3">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{g.group}</h4>
              <button
                type="button"
                className="text-[11px] font-medium text-violet-600 hover:underline"
                onClick={() => onToggleGroup(keys, !allOn)}
              >
                {allOn ? "Clear all" : "Select all"}
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {g.items.map((p) => (
                <label key={p.key} className="flex items-center gap-2 text-xs cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={set.has(p.key)}
                    onChange={() => onToggle(p.key as Permission)}
                    className="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                  />
                  <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase ${KIND_BADGE[p.kind]}`}>
                    {p.kind}
                  </span>
                  <span className="text-foreground">{p.label}</span>
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
