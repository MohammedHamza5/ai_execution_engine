// ─── Forma Canvas – Error Boundary ───────────────────────────────────────────
// Isolates runtime exceptions in visual graph or telemetry rendering.
// Provides a clean fallback state with reset and retry controls.

import React, { Component, type ReactNode } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class FormaErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error("[FormaErrorBoundary] Caught error:", error, errorInfo);
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="p-6 rounded-xl bg-bg-card border border-brand-rose/40 text-center space-y-4">
          <div className="inline-flex p-3 rounded-full bg-brand-rose/10 text-brand-rose">
            <AlertCircle className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">
              {this.props.fallbackTitle ?? "Graph Visualization Encountered an Issue"}
            </h3>
            <p className="text-xs text-slate-400 font-mono mt-1 max-w-md mx-auto">
              {this.state.error?.message ?? "An unexpected layout rendering exception occurred."}
            </p>
          </div>
          <button
            onClick={this.handleReset}
            className="px-4 py-2 rounded-lg bg-bg-dark border border-border-dark text-xs font-mono text-slate-300 hover:text-white hover:border-brand-cyan transition-colors inline-flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Reload Graph
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
