"use client";

import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import type { Impact } from "@/lib/dependencies/types";

type Options = {
  table: string;
  onDeleted?: () => void;
  invalidateKeys?: readonly unknown[][];
};

export function useDeleteWithDependencies({ table, onDeleted, invalidateKeys = [] }: Options) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [targetId, setTargetId] = useState<number | string | null>(null);
  const [impact, setImpact] = useState<Impact | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const invalidateAll = useCallback(async () => {
    await Promise.all(invalidateKeys.map(k => qc.invalidateQueries({ queryKey: k })));
  }, [qc, invalidateKeys]);

  // `onError` lets callers distinguish "nothing to show, close the dialog" (the
  // default — used for the initial `start()` fetch) from "something already
  // succeeded, just couldn't refresh the view" (used by post-delete re-resolves,
  // which must never present a successful delete as a failure).
  const fetchImpact = useCallback(async (
    id: number | string,
    opts?: { onError?: (message: string) => void },
  ): Promise<boolean> => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/dependencies?table=${encodeURIComponent(table)}&id=${id}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Failed to check dependencies");
      setImpact(body as Impact);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to check dependencies";
      if (opts?.onError) {
        opts.onError(message);
      } else {
        toast({ title: message, variant: "destructive" });
        setOpen(false);
      }
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [table]);

  const start = useCallback((id: number | string) => {
    setTargetId(id);
    setImpact(null);
    setOpen(true);
    void fetchImpact(id);
  }, [fetchImpact]);

  const finish = useCallback(async (label: string) => {
    setOpen(false);
    await invalidateAll();
    toast({ title: label });
    onDeleted?.();
  }, [invalidateAll, onDeleted]);

  const onDeleteNode = useCallback(async (node: { table: string; id: number | string; deleteEndpoint: string | null }) => {
    if (!node.deleteEndpoint) {
      toast({ title: "This record can't be deleted on its own — use Delete All.", variant: "destructive" });
      return;
    }
    setIsDeleting(true);
    try {
      const res = await fetch(node.deleteEndpoint, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to delete");
      }
      // The delete already succeeded at this point — a refresh failure below must
      // never read as a failed delete. Keep the dialog open with the prior (now
      // stale) tree and say so explicitly, instead of the default close+error.
      if (targetId != null) {
        await fetchImpact(targetId, {
          onError: () => {
            toast({ title: "Deleted — the view couldn't refresh. Reopen to see the latest." });
          },
        });
      }
      await invalidateAll();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Failed to delete", variant: "destructive" });
    } finally {
      setIsDeleting(false);
    }
  }, [targetId, fetchImpact, invalidateAll]);

  const runBulk = useCallback(async () => {
    if (!impact || targetId == null) return;
    setIsDeleting(true);
    try {
      const res = await fetch("/api/dependencies/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ table, id: targetId, fingerprint: impact.fingerprint }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409 && body.impact) {
        setImpact(body.impact as Impact);
        toast({ title: body.error ?? "This changed while you were reviewing it.", variant: "destructive" });
        return;
      }
      if (res.status === 403) {
        // Same class of race as 409 — permissions were revoked after the initial
        // GET. The route returns `missingPermissions` when the impact-level check
        // fails, but not from its earlier "no permission on the target at all"
        // check, so both shapes have to be handled here.
        const missing: string[] = Array.isArray(body.missingPermissions) ? body.missingPermissions : [];
        const message = missing.length > 0
          ? `${body.error ?? "Forbidden"} — missing permission: ${missing.join(", ")}`
          : (body.error ?? "You don't have permission to complete this delete.");
        // Re-resolve so canDeleteAll / locked-row indicators reflect reality. If the
        // re-resolve itself 403s (target-level permission revoked too), stay silent
        // there — the message below already covers it; don't double-toast.
        await fetchImpact(targetId, { onError: () => {} });
        toast({ title: message, variant: "destructive" });
        return;
      }
      if (!res.ok) throw new Error(body.error ?? "Failed to delete");
      await finish(`${impact.target.singular} deleted`);
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Failed to delete", variant: "destructive" });
    } finally {
      setIsDeleting(false);
    }
  }, [impact, targetId, table, fetchImpact, finish]);

  return {
    start,
    impact,
    dialogProps: {
      open,
      onOpenChange: setOpen,
      impact,
      isLoading,
      isDeleting,
      onDeleteNode,
      onDeleteAll: runBulk,
      onDeleteTarget: runBulk,
    },
  };
}
