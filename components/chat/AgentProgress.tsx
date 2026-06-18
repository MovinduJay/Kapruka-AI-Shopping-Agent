"use client";

import { Check, Circle, ShieldCheck, Wrench } from "lucide-react";
import type { AgentState, AgentStepStatus } from "@/types/agent";

type Props = {
  agentState: AgentState;
};

function statusClasses(status: AgentStepStatus) {
  if (status === "completed") {
    return "border-emerald-400/40 bg-emerald-500/10 text-emerald-200";
  }

  if (status === "running") {
    return "border-sky-400/40 bg-sky-500/10 text-sky-200";
  }

  if (status === "blocked") {
    return "border-amber-400/40 bg-amber-500/10 text-amber-100";
  }

  return "border-white/10 bg-white/[0.035] text-slate-500";
}

export function AgentProgress({ agentState }: Props) {
  const visibleSteps = agentState.steps.filter(
    (step) => step.status !== "pending"
  );

  if (visibleSteps.length === 0 && agentState.tools.length === 0) return null;

  return (
    <section className="mt-3 max-w-3xl rounded-2xl border border-white/[0.08] bg-white/[0.04] p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-400">
        <span className="font-medium text-slate-200">Agent run</span>
        <span className="rounded-full bg-white/[0.05] px-2 py-1 font-mono text-[11px] text-slate-500">
          {agentState.traceId}
        </span>
        {agentState.tools.length > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.05] px-2 py-1 text-xs text-slate-300">
            <Wrench size={13} />
            {agentState.tools.length} tool
            {agentState.tools.length === 1 ? "" : "s"}
          </span>
        )}
        {agentState.humanReviewRequired && (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-100">
            <ShieldCheck size={13} />
            confirmation required
          </span>
        )}
      </div>

      <p className="mt-2 line-clamp-2 text-sm leading-5 text-slate-300">
        {agentState.goal}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {visibleSteps.map((step) => (
          <span
            key={step.id}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${statusClasses(
              step.status
            )}`}
          >
            {step.status === "completed" ? (
              <Check size={13} />
            ) : (
              <Circle size={10} />
            )}
            {step.label}
          </span>
        ))}
      </div>
    </section>
  );
}
