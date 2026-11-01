import React from "react";
import { X, Copy, Check, FileCode, Hash, Database } from "lucide-react";

interface ArtifactDrawerProps {
  artifact: any | null;
  loading: boolean;
  onClose: () => void;
}

export const ArtifactDrawer: React.FC<ArtifactDrawerProps> = ({
  artifact,
  loading,
  onClose,
}) => {
  const [copied, setCopied] = React.useState(false);

  if (!artifact && !loading) return null;

  const handleCopy = () => {
    if (!artifact?.inline_content) return;
    navigator.clipboard.writeText(artifact.inline_content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-xl bg-bg-card border-l border-border-dark h-full flex flex-col p-6 shadow-2xl animate-slide-in">
        {/* Drawer Header */}
        <div className="flex items-center justify-between pb-4 border-b border-border-dark">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-brand-emerald/10 text-brand-emerald border border-brand-emerald/30">
              <FileCode className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white font-mono">Durable Output Artifact</h3>
              <p className="text-[11px] text-slate-400 font-mono">Content-Addressed SHA-256 Storage</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg border border-border-dark bg-bg-dark text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto py-5 space-y-4">
          {loading ? (
            <div className="p-12 text-center text-xs font-mono text-slate-500 animate-pulse">
              Retrieving artifact from PostgreSQL...
            </div>
          ) : artifact ? (
            <>
              {/* Hashes & Metadata */}
              <div className="bg-bg-dark border border-border-dark rounded-xl p-4 space-y-2 text-xs font-mono">
                <div className="flex justify-between items-center">
                  <span className="text-slate-400 flex items-center gap-1.5"><Database className="w-3.5 h-3.5 text-brand-cyan" /> Artifact ID:</span>
                  <span className="text-white text-[11px] truncate max-w-[280px]">{artifact.id}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-400 flex items-center gap-1.5"><Hash className="w-3.5 h-3.5 text-brand-emerald" /> SHA-256 Hash:</span>
                  <span className="text-brand-emerald text-[11px] truncate max-w-[280px]">{artifact.content_hash || artifact.hash || "Verified"}</span>
                </div>
                <div className="flex justify-between items-center pt-2 border-t border-border-dark/60 text-[11px]">
                  <span className="text-slate-400">Created:</span>
                  <span className="text-slate-300">{artifact.created_at ? new Date(artifact.created_at).toLocaleString() : "Just now"}</span>
                </div>
              </div>

              {/* Payload Box */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-mono text-slate-300">Artifact Payload Content</span>
                  <button
                    onClick={handleCopy}
                    className="flex items-center gap-1 text-[11px] font-mono text-brand-cyan hover:underline"
                  >
                    {copied ? <Check className="w-3 h-3 text-brand-emerald" /> : <Copy className="w-3 h-3" />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                <pre className="p-4 rounded-xl bg-bg-dark border border-border-dark text-xs font-mono text-slate-200 overflow-x-auto whitespace-pre-wrap max-h-96">
                  {artifact.inline_content || JSON.stringify(artifact, null, 2)}
                </pre>
              </div>
            </>
          ) : (
            <p className="text-xs text-slate-500 font-mono text-center">No artifact data found.</p>
          )}
        </div>
      </div>
    </div>
  );
};
