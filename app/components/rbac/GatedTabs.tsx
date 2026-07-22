"use client";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useCan } from "@/lib/auth/user-context";
import { visibleTabs, type TabNode } from "@/lib/rbac/tabs";

export function pickDefaultTab(nodes: TabNode[]): string | null {
  const first = nodes[0];
  if (!first) return null;
  if (first.children && first.children.length > 0) return pickDefaultTab(first.children);
  return first.id;
}

/**
 * Renders a Radix Tabs whose triggers/content are filtered by permission.
 * `content` maps a leaf tab id -> node to render. Nested trees render as
 * an inner GatedTabs.
 */
export function GatedTabs({
  nodes,
  content,
  className,
}: {
  nodes: TabNode[];
  content: Record<string, React.ReactNode>;
  className?: string;
}) {
  const can = useCan();
  const visible = visibleTabs(nodes, can);
  const def = pickDefaultTab(visible);

  if (!def) {
    return (
      <p className="px-5 py-8 text-center text-sm text-muted-foreground">
        No accessible sections.
      </p>
    );
  }

  const topDefault = visible[0].id;

  return (
    <Tabs defaultValue={topDefault} className={className}>
      <TabsList>
        {visible.map((t) => (
          <TabsTrigger key={t.id} value={t.id} data-testid={`tab-${t.id}`}>
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {visible.map((t) => (
        <TabsContent key={t.id} value={t.id} className="mt-4">
          {t.children && t.children.length > 0 ? (
            <GatedTabs nodes={t.children} content={content} />
          ) : (
            content[t.id] ?? null
          )}
        </TabsContent>
      ))}
    </Tabs>
  );
}
