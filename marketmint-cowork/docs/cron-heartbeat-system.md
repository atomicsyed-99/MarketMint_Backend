# Cron/Heartbeat System — Implementation Plan

## Context

This document covers the scheduled task execution system for Marketmint sub-agents. It depends on the **Supervisor Agent System** (`supervisor-agent-system.md`) being implemented first — sub-agents must exist and be independently callable before cron jobs can invoke them.

**Goal**: Sub-agents run autonomously on schedules (daily/weekly), producing actionable insights without user initiation. Results are stored and surfaced proactively when users open chat.

---

## Architecture Overview

```
┌─ Trigger.dev Scheduled Tasks ─────────────────────────┐
│                                                        │
│  Schedule: cron expression (e.g., "0 8 * * *")       │
│                                                        │
│  For each active workspace:                            │
│    1. Load workspace connections (Nango)               │
│    2. Build headless requestContext (no HTTP session)   │
│    3. Call agent.generate() (headless, no stream)      │
│    4. Store result in agent_runs table                 │
│    5. Create notification if actionable findings       │
│                                                        │
│  Auth: TRIGGER_SECRET_KEY (server-to-server)           │
│  No HTTP session, no SSE, no Clerk user                │
│                                                        │
└───────────────────────────────────────────────────────┘

┌─ Proactive Surfacing ─────────────────────────────────┐
│                                                        │
│  On chat open → check agent_notifications              │
│  Show unread findings from recent cron runs            │
│  User can drill into any finding via chat              │
│                                                        │
└───────────────────────────────────────────────────────┘
```

---

## 1. Headless Agent Runner

The core utility for executing agents without an HTTP request context.

```typescript
// src/trigger/shared/agent-runner.ts

import { mastra } from "@/mastra";
import { getUserConnections } from "@/connectors/nango/connections";

export interface AgentRunOptions {
  agentId: string;
  prompt: string;
  workspaceId: string;
  modelOverride?: string; // e.g., "anthropic/claude-haiku-4-5-20251001" for cost optimization
}

export interface AgentRunResult {
  text: string;
  toolResults: any[];
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
}

export async function runAgentHeadless(opts: AgentRunOptions): Promise<AgentRunResult> {
  const agent = mastra.getAgent(opts.agentId);
  if (!agent) throw new Error(`Agent not found: ${opts.agentId}`);

  // Build connections for the workspace
  const connections = await getUserConnections(opts.workspaceId);

  // Minimal requestContext (no HTTP session, no Clerk user)
  const requestContext = {
    workspaceId: opts.workspaceId,
    userId: "system",
    email: "system@marketmint.ai",
    chatId: `cron-${opts.agentId}-${Date.now()}`,
    directGenBm: false,
    __connections: connections,
    get(key: string) { return this[key]; },
    set(key: string, value: unknown) { this[key] = value; return this; },
    forEach(callback: (v: unknown, k: string) => void) {
      Object.entries(this).forEach(([k, v]) => {
        if (typeof v !== "function") callback(v, k);
      });
    },
  };

  const result = await agent.generate(opts.prompt, {
    requestContext,
    maxSteps: 15,
    modelSettings: {
      temperature: 0.3, // lower temp for analytical cron tasks
      ...(opts.modelOverride ? { model: opts.modelOverride } : {}),
    },
  });

  return {
    text: result.text,
    toolResults: result.toolResults ?? [],
    usage: result.usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  };
}
```

**Key design decisions:**
- Uses `agent.generate()` (not `.stream()`) — no SSE needed for headless execution
- Lower temperature (0.3) — analytical/reporting tasks benefit from consistency
- Haiku model override for cost — cron jobs are high-volume, analytical
- Minimal requestContext — no Clerk user, no chat session, but connections are loaded

---

## 2. Workspace Registry

Enumerates active workspaces for multi-tenant cron execution.

```typescript
// src/lib/workspace-registry.ts

export interface ActiveWorkspace {
  id: string;
  name: string;
  connectedServices: string[]; // e.g., ["shopify", "meta-ads", "klaviyo"]
}

export async function getActiveWorkspaces(): Promise<ActiveWorkspace[]> {
  // Implementation depends on org management system.
  // Options:
  // 1. Clerk API: list all organizations
  // 2. Dedicated DB table: workspaces with active flags
  // 3. Nango: enumerate workspaces with active connections
  //
  // For each workspace, also check which connectors are active
  // to skip workspaces without relevant integrations.
}

// Helper: filter workspaces that have specific connectors
export async function getWorkspacesWithConnectors(
  connectorIds: string[]
): Promise<ActiveWorkspace[]> {
  const workspaces = await getActiveWorkspaces();
  return workspaces.filter(ws =>
    connectorIds.some(id => ws.connectedServices.includes(id))
  );
}
```

---

## 3. Trigger.dev Scheduled Tasks

### Performance Daily Scan

```typescript
// src/trigger/jobs/performance-daily-scan.ts
import { schedules } from "@trigger.dev/sdk/v3";
import { runAgentHeadless } from "../shared/agent-runner";
import { getWorkspacesWithConnectors } from "@/lib/workspace-registry";
import { insertAgentRun, createNotification } from "@/db/queries/agent-runs";

export const performanceDailyScan = schedules.task({
  id: "performance-daily-scan",
  cron: "0 8 * * *", // Daily 8 AM UTC
  run: async () => {
    const workspaces = await getWorkspacesWithConnectors(["meta-ads", "google-ads"]);

    for (const ws of workspaces) {
      try {
        const startTime = Date.now();
        const result = await runAgentHeadless({
          agentId: "performance-marketing-agent",
          prompt: "Run a daily performance scan: check ROAS trends across all active campaigns, " +
            "detect creative fatigue (frequency > 3, CTR declining), identify budget waste " +
            "(campaigns with spend > $50/day and ROAS < 1).",
          workspaceId: ws.id,
          modelOverride: "anthropic/claude-haiku-4-5-20251001",
        });

        const runId = await insertAgentRun({
          agentId: "performance-marketing-agent",
          workspaceId: ws.id,
          userId: "system",
          runType: "cron",
          input: { job: "performance-daily-scan" },
          output: { text: result.text, usage: result.usage },
          status: "completed",
          durationMs: Date.now() - startTime,
        });

        // Create notification if findings are substantive
        if (result.text.length > 200) {
          await createNotification({
            workspaceId: ws.id,
            agentRunId: runId,
            type: "performance-alert",
            title: "Daily Performance Scan",
            summary: result.text.substring(0, 300) + "...",
          });
        }
      } catch (error) {
        console.error(`[cron] performance-daily-scan failed for workspace ${ws.id}:`, error);
        await insertAgentRun({
          agentId: "performance-marketing-agent",
          workspaceId: ws.id,
          userId: "system",
          runType: "cron",
          input: { job: "performance-daily-scan" },
          output: {},
          status: "failed",
          error: String(error),
        });
      }
    }
  },
});
```

### Other Scheduled Tasks

| Job | File | Schedule | Agent | Prompt Focus | Required Connectors |
|-----|------|----------|-------|-------------|-------------------|
| `performance-daily-scan` | `performance-daily-scan.ts` | Daily 8 AM | Performance Marketing | ROAS trends, creative fatigue, budget waste | meta-ads OR google-ads |
| `creative-fatigue-check` | `creative-fatigue-check.ts` | 2x daily (8 AM, 4 PM) | Performance Marketing | Fatigue-specific: frequency, CTR decay, creative age | meta-ads |
| `shopify-daily-health` | `shopify-daily-health.ts` | Daily 7 AM | Store Manager | Inventory alerts, catalog completeness, broken products | shopify |
| `email-weekly-audit` | `email-weekly-audit.ts` | Monday 9 AM | Email & CRM | Flow coverage, open/click rate trends, list hygiene | klaviyo |

All cron jobs use **Haiku 4.5** for cost optimization.

---

## 4. Database Schema

### Table: `agent_runs`

```sql
CREATE TABLE agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL, -- "system" for cron
  run_type TEXT NOT NULL CHECK (run_type IN ('direct', 'cron', 'delegation')),
  input JSONB NOT NULL DEFAULT '{}',
  output JSONB NOT NULL DEFAULT '{}',
  signals TEXT[] DEFAULT '{}', -- e.g., ['fatigue_detected', 'high_spend_low_cvr']
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  error TEXT,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_agent_runs_workspace ON agent_runs (workspace_id, created_at DESC);
CREATE INDEX idx_agent_runs_agent ON agent_runs (agent_id, workspace_id);
```

### Table: `agent_notifications`

```sql
CREATE TABLE agent_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  user_id TEXT, -- NULL = broadcast to all workspace members
  agent_run_id UUID REFERENCES agent_runs(id),
  type TEXT NOT NULL, -- 'performance-alert', 'inventory-warning', 'fatigue-detected', etc.
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_workspace ON agent_notifications (workspace_id, read, created_at DESC);
```

### Drizzle Schema

```typescript
// src/db/schema.ts — additions

export const agentRuns = pgTable("agent_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: text("agent_id").notNull(),
  workspaceId: text("workspace_id").notNull(),
  userId: text("user_id").notNull(),
  runType: text("run_type").notNull(), // 'direct', 'cron', 'delegation'
  input: jsonb("input").notNull().default({}),
  output: jsonb("output").notNull().default({}),
  signals: text("signals").array().default([]),
  status: text("status").notNull(), // 'running', 'completed', 'failed'
  error: text("error"),
  durationMs: integer("duration_ms"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const agentNotifications = pgTable("agent_notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: text("workspace_id").notNull(),
  userId: text("user_id"),
  agentRunId: uuid("agent_run_id").references(() => agentRuns.id),
  type: text("type").notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  read: boolean("read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

---

## 5. Query Layer

```typescript
// src/db/queries/agent-runs.ts

export async function insertAgentRun(data: {
  agentId: string;
  workspaceId: string;
  userId: string;
  runType: string;
  input: Record<string, any>;
  output: Record<string, any>;
  status: string;
  error?: string;
  durationMs?: number;
}): Promise<string> {
  const [run] = await db.insert(agentRuns).values({
    ...data,
    completedAt: data.status === "completed" ? new Date() : undefined,
  }).returning({ id: agentRuns.id });
  return run.id;
}

export async function createNotification(data: {
  workspaceId: string;
  agentRunId: string;
  type: string;
  title: string;
  summary: string;
  userId?: string;
}): Promise<void> {
  await db.insert(agentNotifications).values(data);
}

export async function getUnreadNotifications(workspaceId: string, limit = 10) {
  return db.select()
    .from(agentNotifications)
    .where(and(
      eq(agentNotifications.workspaceId, workspaceId),
      eq(agentNotifications.read, false),
    ))
    .orderBy(desc(agentNotifications.createdAt))
    .limit(limit);
}

export async function markNotificationsRead(ids: string[]): Promise<void> {
  await db.update(agentNotifications)
    .set({ read: true })
    .where(inArray(agentNotifications.id, ids));
}
```

---

## 6. Notification Surfacing

### API Endpoints

```typescript
// Added to src/mastra/index.ts apiRoutes

// GET /cowork/notifications — unread notifications for current workspace
export async function getNotificationsRoute(c: Context) {
  const user = c.get("authUser");
  const workspaceId = user.orgId;
  const notifications = await getUnreadNotifications(workspaceId);
  return c.json({ notifications });
}

// POST /cowork/notifications/read — mark notifications as read
export async function markReadRoute(c: Context) {
  const { ids } = await c.req.json();
  await markNotificationsRead(ids);
  return c.json({ ok: true });
}
```

### Proactive Chat Surfacing

When user opens a chat, the frontend:
1. Calls `GET /cowork/notifications`
2. If unread notifications exist, shows a summary card
3. User can click to start a chat thread about any finding
4. Marks notifications as read after display

---

## 7. File Structure

```
src/trigger/
  jobs/
    performance-daily-scan.ts                # NEW
    creative-fatigue-check.ts                # NEW
    shopify-daily-health.ts                  # NEW
    email-weekly-audit.ts                    # NEW
  shared/
    agent-runner.ts                          # NEW: Headless agent execution

src/lib/
  workspace-registry.ts                      # NEW: Active workspace enumeration

src/db/
  schema.ts                                  # MODIFY: Add agent_runs, agent_notifications
  queries/
    agent-runs.ts                            # NEW: CRUD for agent_runs + notifications

src/routes/
  (or src/mastra/index.ts apiRoutes)
    notifications routes                     # NEW: GET/POST notifications
```

---

## 8. Phased Implementation

### Phase A: Foundation (After supervisor system Phase 3 is complete)

1. Create DB tables: `agent_runs`, `agent_notifications` via Drizzle schema + migration
2. Create `src/db/queries/agent-runs.ts` query layer
3. Create `src/trigger/shared/agent-runner.ts` headless runner
4. Create `src/lib/workspace-registry.ts` (start with hardcoded workspace list or Clerk API)
5. Create first cron job: `shopify-daily-health` (simplest, single connector)
6. Test manually: trigger job via Trigger.dev dashboard → verify agent_runs record created

### Phase B: Full Cron Suite + Notifications

1. Create remaining 3 cron jobs
2. Add notification creation logic to each job
3. Add notification API endpoints
4. Test all 4 jobs end-to-end across multiple workspaces
5. Monitor token usage and costs

### Phase C: Proactive Surfacing

1. Frontend: notification badge/card on chat open
2. Frontend: "View findings" action → starts chat thread
3. Mark notifications as read after display
4. Add workspace opt-in/opt-out for cron jobs (if cost is a concern)

---

## 9. Verification Plan

| Test | Type | What to verify |
|------|------|----------------|
| Headless agent execution | Integration | `runAgentHeadless()` returns results without HTTP context |
| Workspace iteration | Integration | Cron iterates all active workspaces with correct connections |
| Connector filtering | Unit | Jobs skip workspaces without required connectors |
| Result persistence | Integration | agent_runs record created with correct data |
| Notification creation | Integration | Actionable findings create notifications |
| Notification API | Integration | GET/POST endpoints work correctly |
| Error handling | Integration | Failed cron runs logged to agent_runs with error |
| Cost monitoring | Observability | Token usage per cron job per workspace tracked |

---

## 10. Open Risks

1. **Cron cost**: 4 daily/weekly jobs x N workspaces x Haiku calls. Monitor token usage. Add per-workspace opt-in if costs grow.
2. **Workspace registry**: Implementation depends on org management system (Clerk API, DB table, or config). Need to decide approach.
3. **Trigger.dev cron execution**: Current Trigger.dev setup is for workflow tasks, not agent execution. Need to verify Trigger.dev scheduled tasks can import and run Mastra agents.
4. **Connection credentials in cron**: `getUserConnections()` uses Nango with cached credentials. Verify OAuth token refresh works for headless (non-user-initiated) requests.
5. **Rate limits**: Cron jobs hitting connector APIs (Shopify, Meta, Google) for all workspaces simultaneously could trigger rate limits. May need to stagger execution or add delays between workspaces.
