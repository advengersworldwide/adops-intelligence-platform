"use client";

import { useState } from "react";
import { AlertTriangle, Flame, Link2, Lock, ExternalLink } from "lucide-react";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader,
  AlertDialogTitle, AlertDialogDescription,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { Impact, ImpactNode, NullifyGroup } from "@/lib/dependencies/types";

// ---------------------------------------------------------------------------
// Pure decision logic. Exported and unit-tested directly, per this repo's
// convention (see app/components/rbac/GatedTabs.test.tsx). The JSX below is a
// thin renderer over these — keep behaviour here, not inline in the markup.
// ---------------------------------------------------------------------------

export function isEmptyImpact(impact: Impact | null): boolean {
  if (!impact) return true;
  return impact.blockers.length === 0 && impact.cascades.length === 0 && impact.nullifies.length === 0;
}

/** Financial records (bills, payments) require the user to type the target's name. */
export function needsTypedConfirmation(impact: Impact): boolean {
  return impact.totals.touchesFinancial;
}

/** Whether the final destructive action may proceed. */
export function canConfirm(impact: Impact, typed: string): boolean {
  if (!impact.canDeleteAll) return false;
  if (!needsTypedConfirmation(impact)) return true;
  return typed.trim() === impact.target.label;
}

/** Primary button text: a plain delete when nothing blocks, otherwise the blast radius. */
export function primaryActionLabel(impact: Impact): string {
  if (impact.blockers.length === 0) return `Delete ${impact.target.singular}`;
  return `Delete All — ${impact.totals.deletes} records`;
}

/** "3 Billing Records will lose their client" — derived from the FK column name. */
export function nullifySentence(group: NullifyGroup): string {
  const field = group.column.replace(/_id$/, "").replace(/_/g, " ");
  return `${group.count} ${group.label} will lose their ${field}`;
}

export type DeleteImpactDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  impact: Impact | null;
  isLoading: boolean;
  isDeleting: boolean;
  onDeleteNode: (node: { table: string; id: number | string; deleteEndpoint: string | null }) => Promise<void>;
  onDeleteAll: () => Promise<void>;
  onDeleteTarget: () => Promise<void>;
};

function NodeRow({ node, depth, pendingKey, setPendingKey, onDeleteNode, isDeleting }: {
  node: ImpactNode; depth: number;
  pendingKey: string | null; setPendingKey: (k: string | null) => void;
  onDeleteNode: DeleteImpactDialogProps["onDeleteNode"]; isDeleting: boolean;
}) {
  const key = `${node.table}:${node.id}`;
  const isPending = pendingKey === key;
  return (
    <>
      <div
        className="flex items-center gap-2 py-1.5 text-sm"
        style={{ paddingLeft: `${depth * 16}px` }}
      >
        <span className="text-muted-foreground text-xs shrink-0">{node.singular}</span>
        <span className="font-medium truncate">{node.label}</span>
        {node.href && (
          <a href={node.href} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground shrink-0">
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
        <div className="ml-auto shrink-0">
          {!node.canDelete ? (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Lock className="h-3 w-3" /> needs {node.requiredPermission}
            </span>
          ) : isPending ? (
            <span className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Delete this {node.singular}?</span>
              <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setPendingKey(null)}>Cancel</Button>
              <Button
                size="sm" variant="destructive" className="h-6 text-xs" disabled={isDeleting}
                onClick={async () => { await onDeleteNode(node); setPendingKey(null); }}
              >Delete</Button>
            </span>
          ) : node.deleteEndpoint ? (
            <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setPendingKey(key)}>Delete</Button>
          ) : null}
        </div>
      </div>
      {node.children.map(c => (
        <NodeRow
          key={`${c.table}:${c.id}`} node={c} depth={depth + 1}
          pendingKey={pendingKey} setPendingKey={setPendingKey}
          onDeleteNode={onDeleteNode} isDeleting={isDeleting}
        />
      ))}
    </>
  );
}

export function DeleteImpactDialog({
  open, onOpenChange, impact, isLoading, isDeleting,
  onDeleteNode, onDeleteAll, onDeleteTarget,
}: DeleteImpactDialogProps) {
  const [screen, setScreen] = useState<"review" | "confirm">("review");
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [typed, setTyped] = useState("");

  const hasBlockers = (impact?.blockers.length ?? 0) > 0;
  const needsTyped = impact ? needsTypedConfirmation(impact) : false;
  const confirmOk = impact ? canConfirm(impact, typed) : false;

  return (
    <AlertDialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { setScreen("review"); setTyped(""); setPendingKey(null); } }}>
      <AlertDialogContent className="max-w-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete {impact?.target.singular ?? "item"} — {impact?.target.label ?? ""}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {screen === "review"
              ? impact && isEmptyImpact(impact)
                ? `This only deletes ${impact.target.singular.toLowerCase()} "${impact.target.label}" and cannot be undone.`
                : "Review everything this will affect before continuing."
              : `This permanently deletes ${impact?.totals.deletes ?? 0} records. This cannot be undone.`}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Checking dependencies…</p>
        ) : !impact ? null : screen === "review" ? (
          isEmptyImpact(impact) && !impact.blockedReason ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nothing else references this record — it&apos;s safe to delete.
            </p>
          ) : (
            <div className="max-h-[50vh] space-y-5 overflow-y-auto">
              {hasBlockers && (
                <section>
                  <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <AlertTriangle className="h-3.5 w-3.5" /> Must be deleted first
                  </h3>
                  {impact.blockers.map(n => (
                    <NodeRow
                      key={`${n.table}:${n.id}`} node={n} depth={0}
                      pendingKey={pendingKey} setPendingKey={setPendingKey}
                      onDeleteNode={onDeleteNode} isDeleting={isDeleting}
                    />
                  ))}
                </section>
              )}

              {impact.cascades.length > 0 && (
                <section>
                  <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <Flame className="h-3.5 w-3.5" /> Will also be permanently deleted
                  </h3>
                  <ul className="space-y-1 text-sm">
                    {impact.cascades.map(c => (
                      <li key={c.table} className="flex items-center gap-2">
                        <span className="font-medium">{c.count}</span>
                        <span>{c.label}</span>
                        {!c.canDelete && (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Lock className="h-3 w-3" /> needs {c.requiredPermission}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {impact.nullifies.length > 0 && (
                <section>
                  <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <Link2 className="h-3.5 w-3.5" /> Will be unlinked, not deleted
                  </h3>
                  <ul className="space-y-1 text-sm">
                    {impact.nullifies.map(n => (
                      <li key={`${n.table}.${n.column}`}>{nullifySentence(n)}</li>
                    ))}
                  </ul>
                </section>
              )}

              {impact.blockedReason && (
                <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">{impact.blockedReason}</p>
              )}
            </div>
          )
        ) : (
          <div className="space-y-3">
            <ul className="space-y-1 text-sm">
              {impact.cascades.map(c => <li key={c.table}>{c.count} {c.label}</li>)}
              {impact.blockers.length > 0 && <li>{impact.blockers.length} direct dependents (and their children)</li>}
              <li>1 {impact.target.singular} — {impact.target.label}</li>
            </ul>
            {needsTyped && (
              <label className="block space-y-1 text-sm">
                <span className="text-muted-foreground">
                  This includes financial records. Type <strong>{impact.target.label}</strong> to confirm.
                </span>
                <input
                  className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                  value={typed} onChange={e => setTyped(e.target.value)}
                />
              </label>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          {screen === "confirm" && (
            <Button variant="ghost" size="sm" onClick={() => setScreen("review")}>Back</Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          {screen === "review" ? (
            <Button
              variant="destructive" size="sm"
              disabled={!impact?.canDeleteAll || isDeleting || isLoading}
              onClick={() => setScreen("confirm")}
            >
              {impact ? primaryActionLabel(impact) : "Delete"}
            </Button>
          ) : (
            <Button
              variant="destructive" size="sm" disabled={!confirmOk || isDeleting || isLoading}
              onClick={async () => { await (hasBlockers ? onDeleteAll() : onDeleteTarget()); }}
            >
              {isDeleting ? "Deleting…" : "Delete Everything"}
            </Button>
          )}
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
