import React from "react";
import type { TelemetryData } from "../types";
import { Activity, ShieldCheck, Database, Layers, CheckCircle, RefreshCcw } from "lucide-react";

interface SystemTelemetryProps {
  telemetry: TelemetryData | null;
  loading: boolean;
}

export const SystemTelemetry: React.FC<SystemTelemetryProps> = ({ telemetry, loading }) => {
  if (loading || !telemetry) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-40 rounded-xl bg-bg-card border border-border-dark animate-pulse" />
        ))}
      </div>
    );
  }

  const queueMap = new Map(telemetry.queue.map((q) => [q.status.toLowerCase(), Number(q.count)]));
  const completed = queueMap.get("completed") || 0;
  const running = queueMap.get("running") || 0;
  const pending = queueMap.get("pending") || 0;
  const failed = queueMap.get("failed") || 0;

  return (
    <div className="space-y-6">
      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-bg-card border border-border-dark rounded-xl p-5">
          <div className="flex items-center justify-between text-slate-400 text-xs font-mono">
            <span>RUNNING WORKERS</span>
            <Activity className="w-4 h-4 text-brand-cyan" />
          </div>
          <div className="text-2xl font-bold text-white font-mono mt-2">{running}</div>
          <div className="text-[11px] text-slate-500 font-mono mt-1">SKIP LOCKED Polling</div>
        </div>

        <div className="bg-bg-card border border-border-dark rounded-xl p-5">
          <div className="flex items-center justify-between text-slate-400 text-xs font-mono">
            <span>PENDING QUEUE</span>
            <Layers className="w-4 h-4 text-brand-amber" />
          </div>
          <div className="text-2xl font-bold text-white font-mono mt-2">{pending}</div>
          <div className="text-[11px] text-brand-amber font-mono mt-1">Available for claim</div>
        </div>

        <div className="bg-bg-card border border-border-dark rounded-xl p-5">
          <div className="flex items-center justify-between text-slate-400 text-xs font-mono">
            <span>COMPLETED STEPS</span>
            <CheckCircle className="w-4 h-4 text-brand-emerald" />
          </div>
          <div className="text-2xl font-bold text-brand-emerald font-mono mt-2">{completed}</div>
          <div className="text-[11px] text-slate-500 font-mono mt-1">Verified & Committed</div>
        </div>

        <div className="bg-bg-card border border-border-dark rounded-xl p-5">
          <div className="flex items-center justify-between text-slate-400 text-xs font-mono">
            <span>OUTBOX EVENTS</span>
            <Database className="w-4 h-4 text-brand-indigo" />
          </div>
          <div className="text-2xl font-bold text-white font-mono mt-2">
            {telemetry.outbox?.pendingOutbox ?? 0}
          </div>
          <div className="text-[11px] text-slate-500 font-mono mt-1">system.outbox_events</div>
        </div>
      </div>

      {/* Architecture Invariants Live Checklist */}
      <div className="bg-bg-card border border-border-dark rounded-xl p-6">
        <h3 className="text-xs uppercase font-mono tracking-wider text-slate-400 mb-4 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-brand-emerald" /> Verified Runtime Guarantees
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
          <div className="p-3.5 rounded-lg bg-bg-dark border border-border-dark flex items-start gap-3">
            <span className="w-2 h-2 rounded-full bg-brand-emerald mt-1 shrink-0" />
            <div>
              <div className="font-semibold text-white">ADR-094: Row-Level Queue Locks</div>
              <div className="text-slate-400 text-[11px] mt-0.5">PostgreSQL FOR UPDATE OF s SKIP LOCKED avoids race conditions across concurrent workers.</div>
            </div>
          </div>

          <div className="p-3.5 rounded-lg bg-bg-dark border border-border-dark flex items-start gap-3">
            <span className="w-2 h-2 rounded-full bg-brand-emerald mt-1 shrink-0" />
            <div>
              <div className="font-semibold text-white">ADR-039: Anti-Zombie Fencing Tokens</div>
              <div className="text-slate-400 text-[11px] mt-0.5">Monotonic tokens reject stale worker commits after lease reclamation.</div>
            </div>
          </div>

          <div className="p-3.5 rounded-lg bg-bg-dark border border-border-dark flex items-start gap-3">
            <span className="w-2 h-2 rounded-full bg-brand-emerald mt-1 shrink-0" />
            <div>
              <div className="font-semibold text-white">ADR-035: Transactional Outbox</div>
              <div className="text-slate-400 text-[11px] mt-0.5">Guarantees zero lost domain events with at-least-once delivery semantics.</div>
            </div>
          </div>

          <div className="p-3.5 rounded-lg bg-bg-dark border border-border-dark flex items-start gap-3">
            <span className="w-2 h-2 rounded-full bg-brand-emerald mt-1 shrink-0" />
            <div>
              <div className="font-semibold text-white">ADR-072: Zero Silent Paid Spend</div>
              <div className="text-slate-400 text-[11px] mt-0.5">Automated free-first tier routing ensures $0 cost unless explicit policy permits.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
