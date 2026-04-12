/**
 * When the chat client sets a scheduled-job intent flag, inject this so the orchestrator
 * delegates to agentsJobManagerAgent instead of treating the message as immediate work.
 */

export type ScheduledJobClientHints = {
  name?: string;
  description?: string;
  schedule?: string;
  timezone?: string;
  notifyOnComplete?: boolean;
  notifyOnFailure?: boolean;
};

export function buildScheduledJobOrchestratorSystemBlock(
  hints?: ScheduledJobClientHints | null,
): string {
  const base = [
    "SCHEDULED JOB SETUP (client flag): The user is creating or configuring a **recurring scheduled agent job** (cron), not asking for immediate one-off execution.",
    "You MUST delegate to **agent-agentsJobManagerAgent** (Agents Job Manager). Your handoff must include: the per-run task, preferred specialist if they named one, any integration needs, and all timing — cron expression, IANA timezone, job name, description, notify-on-complete / notify-on-failure if stated.",
    "The job manager uses **createAgentJob**, **listAgentJobs**, **getAgentJob**, **updateAgentJob**, and **deleteAgentJob** as needed. Do **not** route this intent to the main orchestrator for immediate creative work, or to Store Manager, Email CRM, or Performance Marketing for immediate work unless the user explicitly wants a one-off run now instead of automation.",
  ].join("\n");

  const entries = hints
    ? Object.entries(hints).filter(
        ([, v]) => v !== undefined && v !== null && v !== "",
      )
    : [];
  if (entries.length === 0) return base;

  const json = JSON.stringify(Object.fromEntries(entries), null, 2);
  return `${base}\n\nStructured fields from the client (repeat faithfully in your handoff):\n${json}`;
}
