import React, { useState } from "react";
import type { FleetResource } from "../types";
import {
  ShieldCheck,
  Zap,
  Activity,
  Server,
  Sparkles,
  Brain,
  Code,
  Layers,
  CheckCircle2,
} from "lucide-react";

interface FleetRadarProps {
  fleet: FleetResource[];
  loading: boolean;
}

export const FleetRadar: React.FC<FleetRadarProps> = ({ fleet, loading }) => {
  const [filterCategory, setFilterCategory] = useState<string>("ALL");

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="h-52 rounded-xl bg-bg-card border border-border-dark animate-pulse p-5" />
        ))}
      </div>
    );
  }

  const getCircuitBadge = (state?: string) => {
    switch (state) {
      case "CLOSED":
        return <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-brand-emerald/10 text-brand-emerald border border-brand-emerald/30">CLOSED (HEALTHY)</span>;
      case "HALF_OPEN":
        return <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-brand-amber/10 text-brand-amber border border-brand-amber/30">HALF_OPEN (TESTING)</span>;
      case "OPEN":
        return <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-brand-rose/10 text-brand-rose border border-brand-rose/30">OPEN (DEGRADED)</span>;
      default:
        return <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-400">ACTIVE</span>;
    }
  };

  const getTierBadge = (tier?: string) => {
    switch (tier) {
      case "FRONTIER_HEAVYWEIGHT":
        return <span className="px-2 py-0.5 rounded text-[9px] font-mono bg-purple-500/10 text-purple-300 border border-purple-500/30 flex items-center gap-1"><Brain className="w-2.5 h-2.5" /> FRONTIER 120B</span>;
      case "BALANCED_WORKHORSE":
        return <span className="px-2 py-0.5 rounded text-[9px] font-mono bg-blue-500/10 text-blue-300 border border-blue-500/30 flex items-center gap-1"><Layers className="w-2.5 h-2.5" /> WORKHORSE</span>;
      case "EDGE_LIGHT":
        return <span className="px-2 py-0.5 rounded text-[9px] font-mono bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 flex items-center gap-1"><Zap className="w-2.5 h-2.5" /> FAST EDGE</span>;
      default:
        return null;
    }
  };

  const filteredFleet = fleet.filter((r) => {
    if (filterCategory === "ALL") return true;
    if (filterCategory === "REASONING") return r.taxonomy?.tier === "FRONTIER_HEAVYWEIGHT" || r.capabilities?.includes("reasoning");
    if (filterCategory === "FAST_LPU") return r.providerSlug === "groq" || r.taxonomy?.archetype === "FAST_REFLEX";
    if (filterCategory === "MULTIMODAL") return r.providerSlug === "gemini" || r.taxonomy?.archetype === "DEEP_SYNTHESIS";
    if (filterCategory === "EDGE") return r.providerSlug === "cloudflare" || r.taxonomy?.tier === "EDGE_LIGHT";
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-bg-card border border-border-dark rounded-xl p-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Server className="w-5 h-5 text-brand-cyan" />
              Model Intelligence, Taxonomy & Fleet Radar
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              4-Dimensional Orthogonal Taxonomy • Multi-Tier Bayesian Reputation • Zero-Silent-Spend
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs font-mono">
            <div className="text-right">
              <div className="text-brand-emerald font-bold">{fleet.length} Operational Nodes</div>
              <div className="text-slate-500 text-[10px]">100% Free Allocation</div>
            </div>
          </div>
        </div>

        {/* Filter Chips */}
        <div className="flex flex-wrap gap-2 mt-4 pt-3 border-t border-border-dark/60">
          {[
            { id: "ALL", label: `All Models (${fleet.length})` },
            { id: "REASONING", label: "Frontier Reasoning" },
            { id: "FAST_LPU", label: "Ultra-Fast LPU" },
            { id: "MULTIMODAL", label: "Multimodal & 1M Context" },
            { id: "EDGE", label: "Edge & Embeddings" },
          ].map((cat) => (
            <button
              key={cat.id}
              onClick={() => setFilterCategory(cat.id)}
              className={`px-3 py-1 rounded-lg text-xs font-mono transition-all ${
                filterCategory === cat.id
                  ? "bg-brand-indigo text-white shadow-md shadow-brand-indigo/30"
                  : "bg-bg-dark border border-border-dark text-slate-400 hover:text-white"
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Grid of Providers */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredFleet.map((res) => {
          const quotaPercent = res.limitValue && res.remainingValue
            ? Math.round((res.remainingValue / res.limitValue) * 100)
            : 100;
          const qualityPercent = Math.round((res.qualityEstimate ?? 0.92) * 100);

          return (
            <div
              key={res.resourceId}
              className="bg-bg-card hover:bg-bg-hover transition-all duration-200 border border-border-dark hover:border-brand-cyan/40 rounded-xl p-5 flex flex-col justify-between group shadow-sm hover:shadow-cyan-950/20"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] uppercase tracking-wider font-mono text-brand-cyan">
                        {res.providerName}
                      </span>
                      {getTierBadge(res.taxonomy?.tier)}
                    </div>
                    <h3 className="font-semibold text-white text-sm mt-1 group-hover:text-cyan-300 transition-colors">
                      {res.modelName}
                    </h3>
                  </div>
                  {getCircuitBadge(res.circuitState)}
                </div>

                {/* Taxonomy & Domains */}
                <div className="mt-3 flex flex-wrap gap-1">
                  {res.taxonomy?.specializedDomains?.map((domain) => (
                    <span
                      key={domain}
                      className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-bg-dark border border-border-dark text-slate-300"
                    >
                      {domain.replace(/_/g, " ")}
                    </span>
                  ))}
                  {!res.taxonomy?.specializedDomains && res.capabilities?.map((cap) => (
                    <span
                      key={cap}
                      className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-bg-dark border border-border-dark text-slate-400"
                    >
                      {cap}
                    </span>
                  ))}
                </div>

                {/* Quota Gauge */}
                <div className="mt-4 space-y-1.5">
                  <div className="flex justify-between text-[11px] font-mono text-slate-400">
                    <span>Quota ({res.quotaType || "RPM"})</span>
                    <span className="text-slate-200">{res.remainingValue ?? 1000} / {res.limitValue ?? 1000}</span>
                  </div>
                  <div className="w-full bg-bg-dark h-1.5 rounded-full overflow-hidden border border-border-dark">
                    <div
                      className={`h-full rounded-full transition-all ${
                        quotaPercent > 50 ? "bg-brand-emerald" : quotaPercent > 20 ? "bg-brand-amber" : "bg-brand-rose"
                      }`}
                      style={{ width: `${Math.min(100, quotaPercent)}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Footer Meta */}
              <div className="mt-5 pt-3 border-t border-border-dark/60 flex items-center justify-between text-[11px] text-slate-400 font-mono">
                <span className="flex items-center gap-1 text-slate-300">
                  <Activity className="w-3.5 h-3.5 text-brand-cyan" />
                  {res.latencyP95Ms ? `${res.latencyP95Ms}ms` : "Sub-second LPU"}
                </span>
                <span className="flex items-center gap-1 text-brand-emerald">
                  <Sparkles className="w-3.5 h-3.5 text-brand-amber" />
                  {qualityPercent}% Accuracy
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
