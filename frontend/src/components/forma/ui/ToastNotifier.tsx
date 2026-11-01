// ─── Forma UI – Toast Notifier ───────────────────────────────────────────────
// Self-contained toast notification system.
// Receives ToastEvent[] from useIntelligence, auto-dismisses after 4s.
// Renders a fixed stack in the bottom-right corner.

import React, { useState, useEffect, useRef } from "react";
import type { ToastEvent } from "../intelligence/useIntelligence";
import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from "lucide-react";

interface ActiveToast extends ToastEvent {
  readonly expiresAt: number;
}

interface Props {
  toasts: ReadonlyArray<ToastEvent>;
}

const ICON: Record<ToastEvent["type"], React.ReactNode> = {
  success: <CheckCircle2 className="w-4 h-4 text-brand-emerald shrink-0" />,
  error: <AlertCircle className="w-4 h-4 text-brand-rose shrink-0" />,
  info: <Info className="w-4 h-4 text-brand-cyan shrink-0" />,
  warning: <AlertTriangle className="w-4 h-4 text-brand-amber shrink-0" />,
};

const BORDER: Record<ToastEvent["type"], string> = {
  success: "border-brand-emerald/30",
  error: "border-brand-rose/30",
  info: "border-brand-cyan/30",
  warning: "border-brand-amber/30",
};

const TOAST_TTL = 4000; // ms

export const ToastNotifier: React.FC<Props> = ({ toasts }) => {
  const [active, setActive] = useState<ActiveToast[]>([]);
  const seenIds = useRef<Set<string>>(new Set());

  // Ingest new toasts
  useEffect(() => {
    const now = Date.now();
    const incoming = toasts.filter((t) => !seenIds.current.has(t.id));
    if (incoming.length === 0) return;
    incoming.forEach((t) => seenIds.current.add(t.id));
    setActive((prev) => [
      ...incoming.map((t) => ({ ...t, expiresAt: now + TOAST_TTL })),
      ...prev,
    ].slice(0, 5)); // max 5 visible
  }, [toasts]);

  // Auto-dismiss expired toasts every second
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setActive((prev) => prev.filter((t) => t.expiresAt > now));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const dismiss = (id: string) =>
    setActive((prev) => prev.filter((t) => t.id !== id));

  if (active.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-label="Notifications"
      className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none"
    >
      {active.map((toast) => (
        <div
          key={toast.id}
          className={[
            "flex items-start gap-3 px-4 py-3 rounded-xl",
            "bg-bg-card border shadow-lg shadow-black/40",
            "text-xs font-mono text-slate-200 pointer-events-auto",
            "animate-fade-in",
            BORDER[toast.type],
          ].join(" ")}
        >
          {ICON[toast.type]}
          <span className="flex-1 leading-relaxed">{toast.message}</span>
          <button
            onClick={() => dismiss(toast.id)}
            className="text-slate-500 hover:text-white transition-colors mt-0.5"
            aria-label="Dismiss notification"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
};
