"use client";

import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

export type AiInsightSentiment = "positive" | "negative" | "neutral";

export interface AiInsight {
  title: string;
  detail: string;
  sentiment: AiInsightSentiment;
}

export interface AiInsightStripProps {
  insights: AiInsight[];
  loading?: boolean;
  hideHeader?: boolean;
}

const DOT_CLASSES: Record<AiInsightSentiment, string> = {
  positive: "bg-emerald-500",
  negative: "bg-red-500",
  neutral: "bg-muted-foreground",
};

export function AiInsightStrip({ insights, loading, hideHeader = false }: AiInsightStripProps) {
  if (!loading && insights.length === 0) return null;

  return (
    <div>
      {!hideHeader && (
        <div className="mb-3 flex items-center gap-1.5">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">What changed</h3>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {loading
          ? Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                <Skeleton className="h-3 w-3 rounded-full" />
                <Skeleton className="mt-2 h-4 w-3/4" />
                <Skeleton className="mt-2 h-3 w-full" />
              </div>
            ))
          : insights.map((insight, i) => (
              <div key={i} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                <span className={cn("inline-block h-2.5 w-2.5 rounded-full", DOT_CLASSES[insight.sentiment])} />
                <p className="mt-2 text-sm font-bold text-foreground">{insight.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">{insight.detail}</p>
              </div>
            ))}
      </div>
    </div>
  );
}
