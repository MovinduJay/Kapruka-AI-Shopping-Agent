import { hasDatabaseUrl, prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-LK", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function formatJson(value: unknown) {
  if (!value) return "None";

  return JSON.stringify(value, null, 2);
}

export default async function AgentRunsPage() {
  if (!hasDatabaseUrl()) {
    return (
      <main className="min-h-screen bg-slate-950 px-6 py-10 text-slate-100">
        <div className="mx-auto max-w-5xl">
          <h1 className="text-3xl font-semibold">Agent Runs</h1>
          <div className="mt-6 rounded-2xl border border-amber-400/25 bg-amber-500/10 p-5 text-amber-100">
            <p className="font-semibold">Database is not configured.</p>
            <p className="mt-2 text-sm leading-6">
              Add `DATABASE_URL` to `.env.local`, run
              `npm run prisma:migrate -- --name init`, then reload this page.
            </p>
          </div>
        </div>
      </main>
    );
  }

  const runs = await prisma.agentRun.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      toolCalls: {
        orderBy: { createdAt: "asc" },
      },
      session: {
        include: {
          preferences: true,
        },
      },
    },
  });

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100 sm:px-6">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm uppercase tracking-[0.18em] text-emerald-300">
              Observability
            </p>
            <h1 className="mt-2 text-3xl font-semibold">Agent Runs</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
              Recent agent traces with intent, tool calls, product ranking
              payloads, latency, and anonymous session memory.
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-slate-300">
            {runs.length} recent runs
          </div>
        </div>

        <div className="mt-8 space-y-4">
          {runs.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-slate-400">
              No agent runs have been persisted yet.
            </div>
          ) : (
            runs.map((run) => (
              <article
                key={run.id}
                className="rounded-2xl border border-white/10 bg-white/[0.045] p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-mono text-sm text-emerald-200">
                        {run.traceId}
                      </h2>
                      <span className="rounded-full bg-white/[0.06] px-2 py-1 text-xs text-slate-300">
                        {run.intent}
                      </span>
                      {run.humanReviewRequired && (
                        <span className="rounded-full border border-amber-400/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-100">
                          confirmation required
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-sm text-slate-400">
                      {formatDate(run.createdAt)}
                      {typeof run.latencyMs === "number"
                        ? ` · ${run.latencyMs}ms`
                        : ""}
                      {run.sessionId ? ` · session ${run.sessionId}` : ""}
                    </p>
                  </div>

                  <div className="rounded-xl bg-slate-900/70 px-3 py-2 text-sm text-slate-300">
                    {run.productCount} products · {run.toolCalls.length} tools
                  </div>
                </div>

                <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.85fr)]">
                  <div className="space-y-3">
                    <section>
                      <h3 className="text-sm font-semibold text-slate-200">
                        User Message
                      </h3>
                      <p className="mt-1 rounded-xl bg-slate-900/70 p-3 text-sm leading-6 text-slate-300">
                        {run.userMessage}
                      </p>
                    </section>

                    <section>
                      <h3 className="text-sm font-semibold text-slate-200">
                        Goal
                      </h3>
                      <p className="mt-1 rounded-xl bg-slate-900/70 p-3 text-sm leading-6 text-slate-300">
                        {run.goal}
                      </p>
                    </section>

                    {run.assistantReply && (
                      <section>
                        <h3 className="text-sm font-semibold text-slate-200">
                          Assistant Reply
                        </h3>
                        <p className="mt-1 rounded-xl bg-slate-900/70 p-3 text-sm leading-6 text-slate-300">
                          {run.assistantReply}
                        </p>
                      </section>
                    )}
                  </div>

                  <div className="space-y-3">
                    <section>
                      <h3 className="text-sm font-semibold text-slate-200">
                        Tool Calls
                      </h3>
                      <div className="mt-1 space-y-2">
                        {run.toolCalls.length === 0 ? (
                          <p className="rounded-xl bg-slate-900/70 p-3 text-sm text-slate-500">
                            No tools called.
                          </p>
                        ) : (
                          run.toolCalls.map((tool) => (
                            <div
                              key={tool.id}
                              className="rounded-xl bg-slate-900/70 p-3 text-sm"
                            >
                              <div className="flex justify-between gap-3">
                                <span className="font-medium text-slate-200">
                                  {tool.name}
                                </span>
                                <span className="text-slate-500">
                                  {tool.latencyMs ?? "-"}ms
                                </span>
                              </div>
                              <pre className="mt-2 max-h-32 overflow-auto text-xs leading-5 text-slate-400">
                                {formatJson(tool.argumentsJson)}
                              </pre>
                            </div>
                          ))
                        )}
                      </div>
                    </section>

                    <section>
                      <h3 className="text-sm font-semibold text-slate-200">
                        Ranking
                      </h3>
                      <pre className="mt-1 max-h-52 overflow-auto rounded-xl bg-slate-900/70 p-3 text-xs leading-5 text-slate-400">
                        {formatJson(run.rankingJson)}
                      </pre>
                    </section>

                    {run.session?.preferences && (
                      <section>
                        <h3 className="text-sm font-semibold text-slate-200">
                          Session Memory
                        </h3>
                        <pre className="mt-1 max-h-40 overflow-auto rounded-xl bg-slate-900/70 p-3 text-xs leading-5 text-slate-400">
                          {formatJson(run.session.preferences)}
                        </pre>
                      </section>
                    )}
                  </div>
                </div>
              </article>
            ))
          )}
        </div>
      </div>
    </main>
  );
}
