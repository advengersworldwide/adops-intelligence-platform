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

  const fetchImpact = useCallback(async (id: number | string) => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/dependencies?table=${encodeURIComponent(table)}&id=${id}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to check dependencies");
      setImpact(body as Impact);
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Failed to check dependencies", variant: "destructive" });
      setOpen(false);
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
      if (targetId != null) await fetchImpact(targetId);   // re-resolve; tree shrinks
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
      if (!res.ok) throw new Error(body.error ?? "Failed to delete");
      await finish(`${impact.target.singular} deleted`);
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Failed to delete", variant: "destructive" });
    } finally {
      setIsDeleting(false);
    }
  }, [impact, targetId, table, finish]);

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
