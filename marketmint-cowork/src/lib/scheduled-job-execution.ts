/**
 * Scheduled agent-job runs: no chat UI, no user approval, no "plan then stop".
 */

/** Orchestrator tools that assume an interactive user or approval UI — never use on cron runs. */
export const SCHEDULED_JOB_EXCLUDED_ORCHESTRATOR_TOOL_IDS = [
  "displayPlan",
  "finisherTool",
  "showConnectBanner",
] as const;

export function filterScheduledOrchestratorToolNames(
  names: string[],
): string[] {
  const drop = new Set<string>(SCHEDULED_JOB_EXCLUDED_ORCHESTRATOR_TOOL_IDS);
  return names.filter((n) => !drop.has(n));
}

/**
 * Appended last so it wins over long chat-oriented prompts (orchestrator + soul).
 * Keep imperative and short.
 */
export const SCHEDULED_JOB_FINAL_SYSTEM_OVERRIDE = `
## Scheduled job execution (mandatory — overrides conflicting text above)

This run is a **headless cron execution**. There is **no** user present: **no** chat UI, **no** plan approval, **no** clarifying questions, **no** "I will do the rest later" or "next steps in a future message."

- **Do not** call displayPlan or any approval/planning UI (those tools are unavailable).
- **Do not** output a plan as your final answer and stop. **Do not** claim you showed a plan to the user.
- **Execute** the job prompt **to completion in this run**: use tools (search, generation, workflows, artifacts) until concrete deliverables exist or you hit a **blocking** error you cannot work around.
- **Transient tool errors** (timeouts, one-off API errors): retry or alternate approach if reasonable. **Fail** only when the **main objective** of the prompt cannot be achieved.
- If you **cannot** proceed without information only a human could provide, state that briefly — the run will be recorded as failed; do **not** pretend success.

Your final response should summarize **what was actually produced** (artifacts, links, data), not a roadmap for future work.`;

/** Conservative: fail the run if the model still describes plan/approval/deferral despite instructions. */
export function scheduledJobTextLooksLikePlanOnlyDeferral(text: string): boolean {
  const t = text.trim();
  if (t.length < 50) return false;
  const lower = t.toLowerCase();
  return (
    /\b(shown (you )?the (plan|overview)|presented (you )?(the )?plan|displayed (the )?plan (to|for) (you|the user)|here'?s (my )?plan( for|$)|awaiting your (approval|confirmation|feedback)|will (do|complete|run|execute) (the )?(next|remaining) (steps?|tasks?)|in (a |the )?(future|next) (run|message|session)|after you approve)\b/i.test(
      lower,
    ) ||
    /\b(marked (this |the )?run as complete|job (is )?complete).{0,120}\b(plan|next step|later)\b/i.test(
      lower,
    )
  );
}
