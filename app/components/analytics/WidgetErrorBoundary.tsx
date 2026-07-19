"use client";
import { Component, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

interface Props { children: ReactNode; title?: string }
interface State { hasError: boolean }

export class WidgetErrorBoundary extends Component<Props, State> {
  constructor(props: Props) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError(): State { return { hasError: true }; }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full min-h-32 flex-col items-center justify-center gap-2 rounded-2xl border border-border bg-card p-5 text-center">
          <AlertTriangle className="h-5 w-5 text-amber-500" />
          <p className="text-xs text-muted-foreground">
            {this.props.title ? `"${this.props.title}" failed to load` : "This widget failed to load"}
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
