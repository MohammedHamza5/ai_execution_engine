import React, { useState } from "react";
import { submitDAGTask, submitStandardTask } from "../api";
import { Play, Sparkles, AlertCircle, CheckCircle2, Code2, GitFork } from "lucide-react";

interface TaskWorkbenchProps {
  onTaskCreated: (taskId: string) => void;
}

export const TaskWorkbench: React.FC<TaskWorkbenchProps> = ({ onTaskCreated }) => {
  const [template, setTemplate] = useState<string>("diamond");
  const [prompt, setPrompt] = useState<string>("Explain the architectural advantages of Content-Addressed Storage in AI Infrastructure.");
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successId, setSuccessId] = useState<string | null>(null);

  const handleTemplateChange = (t: string) => {
    setTemplate(t);
    if (t === "diamond") {
      setPrompt("Explain the architectural advantages of Content-Addressed Storage in AI Infrastructure.");
    } else if (t === "code") {
      setPrompt("Generate a TypeScript function for monotonic fencing token validation in PostgreSQL.");
    } else {
      setPrompt("Compare Groq LPU latency with Cerebras wafer-scale chips for LLM inference.");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setSuccessId(null);

    try {
      if (template === "standard") {
        const res = await submitStandardTask({
          taskType: "general_inference",
          inputPayload: { prompt },
          requirements: { allowPaid: false },
          policy: { validationLevel: "standard" },
          priority: 5,
        });
        setSuccessId(res.taskId);
        onTaskCreated(res.taskId);
      } else {
        // Multi-step DAG template
        const steps =
          template === "code"
            ? [
                {
                  stepKey: "code_gen",
                  name: "1. Implementation",
                  stepType: "model_inference",
                  dependencies: [],
                  inputPayload: { prompt: `Generate production-grade implementation for: ${prompt}` },
                },
                {
                  stepKey: "code_review",
                  name: "2. Code Review & Verification",
                  stepType: "model_inference",
                  dependencies: ["code_gen"],
                  inputPayload: { prompt: `Verify edge-cases and error safety for: ${prompt}` },
                },
              ]
            : [
                {
                  stepKey: "research_step",
                  name: "1. Core Research",
                  stepType: "model_inference",
                  dependencies: [],
                  inputPayload: { prompt: `Research and outline core concepts for: "${prompt}"` },
                },
                {
                  stepKey: "analysis_a",
                  name: "2a. Technical Analysis",
                  stepType: "model_inference",
                  dependencies: ["research_step"],
                  inputPayload: { prompt: `Analyze technical architecture & trade-offs for: "${prompt}"` },
                },
                {
                  stepKey: "analysis_b",
                  name: "2b. Reliability Analysis",
                  stepType: "model_inference",
                  dependencies: ["research_step"],
                  inputPayload: { prompt: `Analyze failure recovery & checkpoints for: "${prompt}"` },
                },
                {
                  stepKey: "synthesis_join",
                  name: "3. Synthesis Join",
                  stepType: "model_inference",
                  dependencies: ["analysis_a", "analysis_b"],
                  inputPayload: { prompt: `Synthesize a comprehensive, executive answer for: "${prompt}"` },
                },
              ];

        const payload = {
          taskType: "dag_workflow",
          initialPayload: { prompt },
          steps,
          requirements: { allowPaid: false },
          policy: { allowPaid: false, maxAttemptsPerStep: 3 },
          priority: 10,
        };
        const res = await submitDAGTask(payload);
        setSuccessId(res.taskId);
        onTaskCreated(res.taskId);
      }
    } catch (err: any) {
      setError(err.message || "Failed to submit task");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="bg-bg-card border border-border-dark rounded-xl p-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand-indigo/10 border border-brand-indigo/30 flex items-center justify-center text-brand-indigo">
            <Sparkles className="w-5 h-5 text-brand-cyan" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white">Task Submission Workbench</h2>
            <p className="text-xs text-slate-400">Dispatch single-model tasks or complex multi-branch DAG workflows.</p>
          </div>
        </div>

        {/* Template Selector */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-6">
          <button
            type="button"
            onClick={() => handleTemplateChange("diamond")}
            className={`p-4 rounded-xl border text-left transition-all ${
              template === "diamond"
                ? "bg-brand-indigo/10 border-brand-indigo text-white shadow-md shadow-indigo-950/20"
                : "bg-bg-dark/40 border-border-dark text-slate-400 hover:text-slate-200"
            }`}
          >
            <GitFork className="w-4 h-4 text-brand-cyan mb-2" />
            <div className="text-xs font-semibold">Diamond DAG Pipeline</div>
            <div className="text-[11px] text-slate-400 mt-1">Research $\rightarrow$ 2 Parallel Branches $\rightarrow$ Synthesis</div>
          </button>

          <button
            type="button"
            onClick={() => handleTemplateChange("code")}
            className={`p-4 rounded-xl border text-left transition-all ${
              template === "code"
                ? "bg-brand-indigo/10 border-brand-indigo text-white shadow-md shadow-indigo-950/20"
                : "bg-bg-dark/40 border-border-dark text-slate-400 hover:text-slate-200"
            }`}
          >
            <Code2 className="w-4 h-4 text-brand-emerald mb-2" />
            <div className="text-xs font-semibold">Code Generation DAG</div>
            <div className="text-[11px] text-slate-400 mt-1">TypeScript $\rightarrow$ Deterministic Validation</div>
          </button>

          <button
            type="button"
            onClick={() => handleTemplateChange("standard")}
            className={`p-4 rounded-xl border text-left transition-all ${
              template === "standard"
                ? "bg-brand-indigo/10 border-brand-indigo text-white shadow-md shadow-indigo-950/20"
                : "bg-bg-dark/40 border-border-dark text-slate-400 hover:text-slate-200"
            }`}
          >
            <Play className="w-4 h-4 text-brand-amber mb-2" />
            <div className="text-xs font-semibold">Single Model Step</div>
            <div className="text-[11px] text-slate-400 mt-1">Direct Task Submission $\rightarrow$ Fast Free Tier</div>
          </button>
        </div>

        {/* Input Form */}
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="block text-xs font-mono text-slate-300 mb-1.5">
              Task Prompt / Instruction Payload
            </label>
            <textarea
              rows={4}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="w-full bg-bg-dark border border-border-dark focus:border-brand-cyan rounded-xl p-3 text-xs text-white font-mono placeholder:text-slate-600 focus:outline-none transition-colors"
              placeholder="Enter your instruction or query here..."
            />
          </div>

          <div className="flex items-center justify-between pt-2">
            <span className="text-[11px] font-mono text-brand-emerald flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-brand-emerald" />
              Policy: Zero Silent Paid Spend (allowPaid: false)
            </span>

            <button
              type="submit"
              disabled={submitting || !prompt.trim()}
              className="px-5 py-2.5 rounded-xl bg-brand-indigo hover:bg-indigo-600 text-white font-medium text-xs flex items-center gap-2 transition-all shadow-md shadow-brand-indigo/30 disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              {submitting ? "Submitting Task..." : "Execute Workflow"}
            </button>
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-brand-rose/10 border border-brand-rose/30 text-brand-rose text-xs font-mono flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          {successId && (
            <div className="p-3 rounded-lg bg-brand-emerald/10 border border-brand-emerald/30 text-brand-emerald text-xs font-mono flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              Task successfully dispatched! ID: {successId}
            </div>
          )}
        </form>
      </div>
    </div>
  );
};
