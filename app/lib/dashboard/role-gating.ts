import type { WidgetDef } from "./types";

export function visibleWidgetIds(
  ids: string[],
  registry: Record<string, WidgetDef>,
  has: (permission: string) => boolean,
): string[] {
  return ids.filter((id) => {
    const def = registry[id];
    if (!def) return false;
    return def.permission === null || has(def.permission);
  });
}