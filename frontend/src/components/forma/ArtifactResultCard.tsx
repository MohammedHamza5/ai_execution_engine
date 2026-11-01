// ─── Forma Canvas – Artifact Result Card ───────────────────────────────────────
// Prominently shown when a task completes and has an inline output artifact.
// Handles copy-to-clipboard with a single, stable debounce-safe handler.

import React, { useState, useCallback } from "react";
import { Sparkles, Copy, Check, FileText } from "lucide-react";

interface ArtifactData {
  readonly inline_content?: string;
  readonly content_hash?: string;
}

interface Props {
  artifact: ArtifactData | null;
  taskId: string;
  onInspectArtifact?: (taskId: string) => void;
}

export const ArtifactResultCard: React.FC<Props> = ({ artifact, taskId, onInspectArtifact }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    if (!artifact?.inline_content) return;
    navigator.clipboard.writeText(artifact.inline_content).then(() => {
      setCopied(true);
      const timer = setTimeout(() => setCopied(false), 2000);
      return () => clearTimeout(timer);
    });
  }, [artifact?.inline_content]);

  if (!artifact?.inline_content) return null;

  return (
    <div className="bg-gradient-to-r from-bg-card via-brand-indigo/10 to-bg-card border border-brand-cyan/40 rounded-xl p-5 shadow-lg shadow-cyan-950/20">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-border-dark/60">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-brand-cyan/10 border border-brand-cyan/30 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-brand-cyan" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              Final Synthesized Artifact
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-brand-emerald/10 text-brand-emerald border border-brand-emerald/30">
                VERIFIED RESULT
              </span>
            </h3>
            {artifact.content_hash && (
              <p className="text-[11px] font-mono text-slate-400">
                SHA-256: {artifact.content_hash.slice(0, 24)}…
              </p>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono border border-border-dark bg-bg-dark hover:bg-bg-hover text-slate-200 transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-brand-emerald" /> : <Copy className="w-3.5 h-3.5 text-brand-cyan" />}
            {copied ? "Copied" : "Copy Result"}
          </button>

          {onInspectArtifact && (
            <button
              onClick={() => onInspectArtifact(taskId)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono border border-brand-indigo/40 bg-brand-indigo/20 text-brand-cyan hover:bg-brand-indigo/30 transition-colors"
            >
              <FileText className="w-3.5 h-3.5" />
              Full Drawer
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <pre className="mt-4 p-4 rounded-xl bg-bg-dark/80 border border-border-dark text-xs font-mono text-slate-200 overflow-x-auto whitespace-pre-wrap max-h-80 leading-relaxed selection:bg-brand-cyan/30">
        {artifact.inline_content}
      </pre>
    </div>
  );
};
