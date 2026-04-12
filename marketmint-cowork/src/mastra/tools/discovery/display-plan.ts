import { createTool } from "@mastra/core/tools";
import { z } from "zod";

const PLAN_WIDGET_TITLE = "Execution Plan";
const PLAN_AUTO_PROCEED_SECONDS = 10;
const STEP_DELAY_MS = 500;
const PLAN_STEP_DELAY_MS = 700;

function normalizePlanLabel(line: string): string {
  return line
    .replace(/^[\*\-•]\s*/, "")
    .replace(/^\d+\.\s*/, "")
    .replace(/^#+\s*/, "")
    .trim()
    .replace(/\*\*([^*]*)\*\*/g, "$1")
    .trim();
}

function parsePlanMarkdownToTodos(planMarkdown: string): Array<{ id: string; label: string; description: string; status: "pending" | "running" | "completed" | "failed" }> {
  const lines = planMarkdown
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const todos: Array<{ id: string; label: string; description: string; status: "pending" | "running" | "completed" | "failed" }> = [];
  for (let i = 0; i < lines.length; i++) {
    const label = normalizePlanLabel(lines[i]);
    if (!label) continue;
    if (i === 0 && lines.length > 1 && label.toLowerCase().startsWith("plan:")) continue;
    todos.push({
      id: `step-${todos.length + 1}`,
      label,
      description: "",
      status: "pending",
    });
  }
  return todos;
}

export const displayPlan = createTool({
  id: "displayPlan",
  description:
    "Display the execution plan for user approval (collapsible plan). Call only when you have built a plan from loaded skill(s) and are ready to show it once. Do not call when the user is answering clarification questions.",
  inputSchema: z.object({
    plan_markdown: z.string().describe("3–5 bullet points, each starting with '- '"),
    cowork_banner_id: z.string().optional(),
  }),
  outputSchema: z.object({
    shown: z.boolean(),
    message: z.string().optional(),
    plan: z.object({
      id: z.string(),
      title: z.string(),
      autoProceedSeconds: z.number().optional(),
      todos: z.array(z.object({
        id: z.string(),
        label: z.string(),
        description: z.string().optional(),
        status: z.enum(["pending", "running", "completed", "failed"]).optional(),
      })),
    }).optional(),
  }),
  execute: async (input, context) => {
    const toolId = `au_display_plan_${crypto.randomUUID().slice(0, 8)}`;
    const start = Date.now();
    const writer = context?.writer;

    const emitMaster = (opts: {
      description: string;
      status: string;
      steps: Array<Record<string, unknown>>;
      duration_ms?: number;
      output?: Record<string, unknown>;
    }) => {
      const data: Record<string, unknown> = {
        name: "displayPlan",
        title: "Execution Plan",
        status: opts.status,
        category: "planning",
        description: opts.description,
        steps: opts.steps,
      };
      if (opts.duration_ms != null) data.duration_ms = opts.duration_ms;
      if (opts.output != null) data.output = opts.output;
      writer?.custom({ type: "data-agent-utility", id: toolId, data: { id: toolId, data } });
    };

    emitMaster({
      description: "Generating a plan",
      status: "running",
      steps: [{ id: "reviewing", title: "Reviewing skill instructions", status: "running" }],
    });

    await new Promise((r) => setTimeout(r, PLAN_STEP_DELAY_MS));
    const step1Duration = Date.now() - start;
    const steps: Array<Record<string, unknown>> = [
      { id: "reviewing", title: "Reviewing skill instructions", status: "completed", duration_ms: step1Duration },
    ];

    steps.push({ id: "identifying", title: "Identifying required actions", status: "running" });
    emitMaster({ description: "Generating a plan", status: "running", steps });
    await new Promise((r) => setTimeout(r, PLAN_STEP_DELAY_MS));
    (steps[1] as Record<string, unknown>).status = "completed";
    (steps[1] as Record<string, unknown>).duration_ms = PLAN_STEP_DELAY_MS;

    steps.push({ id: "structuring", title: "Structuring execution steps", status: "running" });
    emitMaster({ description: "Generating a plan", status: "running", steps });
    await new Promise((r) => setTimeout(r, PLAN_STEP_DELAY_MS));
    (steps[2] as Record<string, unknown>).status = "completed";
    (steps[2] as Record<string, unknown>).duration_ms = PLAN_STEP_DELAY_MS;

    steps.push({ id: "finalizing", title: "Finalizing plan", status: "running" });
    emitMaster({ description: "Generating a plan", status: "running", steps });
    await new Promise((r) => setTimeout(r, STEP_DELAY_MS));
    (steps[3] as Record<string, unknown>).status = "completed";
    (steps[3] as Record<string, unknown>).duration_ms = STEP_DELAY_MS;

    let planId: string | null = null;
    let todos: Array<{ id: string; label: string; description: string; status: "pending" | "running" | "completed" | "failed" }> = [];
    if (writer && input.plan_markdown.trim()) {
      todos = parsePlanMarkdownToTodos(input.plan_markdown);
      planId = `plan-${crypto.randomUUID().slice(0, 12)}`;
      // data-agent-task custom event removed — frontend reads plan from tool-invocation.output
    }

    const duration_ms = Date.now() - start;
    emitMaster({
      description: "Plan generated",
      status: "completed",
      steps,
      duration_ms,
      output: { plan_id: planId, todos_count: todos.length },
    });

    return {
      shown: true,
      message:
        "Plan displayed. Do NOT repeat or summarize the plan in your next message. Ask the user only once whether the plan is ok to proceed (e.g. 'Is this plan ok to go ahead with?' or 'Shall we proceed?').",
      plan: planId
        ? {
            id: planId,
            title: PLAN_WIDGET_TITLE,
            autoProceedSeconds: PLAN_AUTO_PROCEED_SECONDS,
            todos,
          }
        : undefined,
    };
  },
});
