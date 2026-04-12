# PRD: Agent Jobs Dashboard

> **Status**: Review
> **Author**: Claude + Manish
> **Date**: 2026-04-01
> **Depends on**: [Cron/Heartbeat System](./cron-heartbeat-system.md), [Supervisor Agent System](./supervisor-agent-system.md)

---

## 1. Problem Statement

Today, MarketMint subagents (Creative Director, Performance Marketing, Shopify Store Manager, Email & CRM Manager) are only accessible through real-time chat. Users must manually initiate every analysis, audit, or report. There is no way to:

- Schedule recurring agent tasks (e.g., "audit my store health every Monday")
- See what agent work is running, completed, or scheduled
- Get aggregated insights from repeated agent runs over time
- Have the agent "remember" findings from automated runs during future chat conversations

This means users miss timely alerts (creative fatigue, inventory issues, budget waste) and the agents have no long-term operational awareness beyond the current chat thread.

---

## 2. Goal

Build an **Agent Jobs Dashboard** — a new page in the MarketMint Pro app where users can:

1. **Configure recurring agent jobs** with custom prompts, agent selection, and cron schedules
2. **Monitor job execution** in a Kanban board (Upcoming → Running → Completed → Failed)
3. **View auto-generated insights** derived from job run history
4. **Enrich the supervisor's working memory** so that chat conversations benefit from automated findings

---

## 3. User Personas

| Persona | Usage Pattern |
|---------|--------------|
| **DTC Brand Owner** | Sets up weekly Shopify health checks + daily ad performance scans. Checks dashboard for alerts, then drills into chat for details. |
| **Marketing Manager** | Configures creative fatigue checks twice daily. Uses insights to decide when to refresh ad creatives. |
| **E-commerce Ops** | Runs daily inventory alerts + weekly email flow audits. Relies on dashboard insights for operational decisions. |

---

## 4. Scope

### In Scope

| Area | Details |
|------|---------|
| **Job CRUD** | Create, read, update, delete, enable/disable recurring jobs |
| **Job Configuration** | Custom prompt, agent selection (manual or auto-routing), cron schedule, connector requirements |
| **Kanban Board** | 4-column view: Upcoming, Running, Completed, Failed |
| **Job Run Detail** | Summary view in kanban card; full run details stored for audit (accessible via drill-down) |
| **Insights Engine** | Auto-generated insights from run history using LLM + structured aggregations |
| **Working Memory Sync** | After job completion, update supervisor's Mastra working memory with findings |
| **Backend APIs** | Full REST API for jobs, runs, and insights |
| **Trigger.dev Scheduled Tasks** | Headless agent execution via Trigger.dev `schedules.task()` |
| **Multi-tenancy** | All jobs scoped to workspace; any workspace member can create/manage |

### Out of Scope (v1)

| Area | Reason |
|------|--------|
| **Role-based access control** | Any workspace member can manage jobs for now; RBAC deferred |
| **Job approval workflows** | No approval chain before a job runs |
| **Real-time SSE for dashboard** | Polling-based refresh; SSE/WebSocket for live updates deferred |
| **Mobile dashboard** | Desktop-first; responsive but not mobile-optimized |
| **Job templates marketplace** | Predefined job templates deferred to v2 |
| **Cost budgets per job** | Token cost tracking is observability-only, no hard limits |
| **Daily aggregation job** | Cross-agent trend/correlation generation deferred to v2 |
| **Pause-all-jobs switch** | Workspace-level kill switch deferred |

---

## 5. Feature Specification

### 5.1 Job Configuration

A **Job** represents a recurring agent task configured by a user.

#### Job Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | UUID | Auto | Primary key |
| `workspaceId` | string | Yes | Owning workspace |
| `createdByUserId` | string | Yes | User who created the job |
| `name` | string | Yes | Human-readable name (e.g., "Daily Ad Performance Scan") |
| `description` | string | No | Optional longer description |
| `agentId` | string | Yes | Target subagent ID (e.g., `performance-marketing-agent`) or `auto` for supervisor routing |
| `prompt` | string | Yes | The instruction sent to the agent on each run |
| `schedule` | string | Yes | Cron expression (e.g., `0 8 * * *` for daily 8 AM UTC) |
| `timezone` | string | Yes | User's timezone for schedule display (e.g., `Asia/Kolkata`) |
| `enabled` | boolean | Yes | Whether the job is active (default: `true`) |
| `connectorRequirements` | string[] | No | Required connectors (e.g., `["shopify", "meta-ads"]`). Job skips if not connected. |
| `modelOverride` | string | No | Override model (e.g., `claude-haiku-4-5` for cost savings) |
| `maxSteps` | number | No | Override max agent steps (default: 15) |
| `notifyOnComplete` | boolean | Yes | Send notification on completion (default: `true`) |
| `notifyOnFailure` | boolean | Yes | Send notification on failure (default: `true`) |
| `createdAt` | timestamp | Auto | |
| `updatedAt` | timestamp | Auto | |
| `lastRunAt` | timestamp | Auto | Timestamp of most recent run |
| `nextRunAt` | timestamp | Computed | Next scheduled execution time |

#### Agent Selection

- **Manual selection**: User picks a specific subagent from a dropdown:
  - Creative Director Agent
  - Performance Marketing Agent
  - Shopify Store Manager Agent
  - Email & CRM Manager Agent
- **Auto-routing** (`agentId: "auto"`): The prompt is sent to the **supervisor agent (marketMintAgent)**, which uses its existing routing table and delegation logic to assign the task to the appropriate subagent. This leverages the same intent → agent decision tree used in chat, including support for multi-agent chains (e.g., perf marketing → creative director for fatigue-triggered refreshes). The supervisor uses `agent.generate()` headlessly — the routing overhead is minimal since it only decides delegation, not content generation.

#### Schedule Configuration UI

- Predefined presets: "Every hour", "Daily at 8 AM", "Twice daily (8 AM, 4 PM)", "Weekly on Monday", "Monthly 1st"
- Advanced: raw cron expression editor with human-readable preview (e.g., `0 8 * * 1` → "Every Monday at 8:00 AM")
- Timezone selector (default to user's browser timezone)
- Next 5 runs preview showing exact timestamps

#### Connector Validation

When a job runs, the system checks if the workspace has the required connectors active. If not:
- The run is **skipped** (not failed) with status `skipped`
- A notification is created: "Job X skipped — Shopify is not connected"
- The job remains enabled for the next scheduled run

---

### 5.2 Kanban Board

The primary dashboard view showing job runs organized by lifecycle status.

#### Columns

| Column | Source | Card Count | Sort |
|--------|--------|------------|------|
| **Upcoming** | Enabled jobs with computed `nextRunAt` | All enabled jobs | Nearest first |
| **Running** | `agent_job_runs` with `status = 'running'` | Active runs | Start time ascending |
| **Completed** | `agent_job_runs` with `status = 'completed'` | Last 50 (paginated) | Most recent first |
| **Failed** | `agent_job_runs` with `status IN ('failed', 'skipped')` | Last 20 (paginated) | Most recent first |

#### Kanban Card — Upcoming

```
┌─────────────────────────────────────┐
│ 🟢 Daily Ad Performance Scan       │
│ Performance Marketing Agent         │
│                                     │
│ Next run: Today 8:00 AM IST        │
│ Schedule: Daily at 8:00 AM          │
│                                     │
│ [Edit] [Disable] [Run Now]          │
└─────────────────────────────────────┘
```

- Shows: job name, assigned agent, next run time (in user TZ), schedule description
- Actions: Edit job config, Disable/Enable toggle, Trigger immediate run

#### Kanban Card — Running

```
┌─────────────────────────────────────┐
│ 🔵 Daily Ad Performance Scan       │
│ Performance Marketing Agent         │
│                                     │
│ Started: 2 min ago                  │
│ Steps: 4/15                         │
│ ████████░░░░░░░ 53%                │
│                                     │
│ [Cancel]                            │
└─────────────────────────────────────┘
```

- Shows: job name, agent, elapsed time, step progress (if available)
- Actions: Cancel run (sets status to `cancelled`)

#### Kanban Card — Completed

```
┌─────────────────────────────────────┐
│ ✅ Daily Ad Performance Scan        │
│ Performance Marketing Agent         │
│                                     │
│ Completed: 3 hours ago              │
│ Duration: 45s | Tokens: 12.4K       │
│                                     │
│ Summary: ROAS declined 12% on       │
│ Campaign "Summer Sale". Creative    │
│ fatigue detected on 2 ad sets...    │
│                                     │
│ [View Details] [Chat About This]    │
└─────────────────────────────────────┘
```

- Shows: job name, agent, completion time, duration, token usage, truncated summary
- Actions: View full run details (modal/drawer), Open chat pre-filled with "Tell me more about the findings from [job name] run on [date]"

#### Kanban Card — Failed

```
┌─────────────────────────────────────┐
│ ❌ Weekly Email Flow Audit          │
│ Email & CRM Manager Agent           │
│                                     │
│ Failed: 1 hour ago                  │
│ Error: Klaviyo connection expired   │
│                                     │
│ [View Error] [Retry] [Fix Connection]│
└─────────────────────────────────────┘
```

- Shows: job name, agent, failure time, error summary
- Actions: View full error, Retry run, Link to connector settings (if connector issue)

#### Filters & Controls

- **Filter by agent**: Show jobs for a specific subagent
- **Filter by job**: Show runs for a specific job definition
- **Time range**: Today, Last 7 days, Last 30 days
- **Search**: Search jobs by name or prompt content
- **Refresh**: Manual refresh button + auto-refresh interval (30s)

---

### 5.3 Job Run Detail View

Accessed via "View Details" on a completed/failed card. Opens as a slide-over drawer.

#### Detail Fields

| Section | Content |
|---------|---------|
| **Header** | Job name, agent, status badge, timestamp |
| **Summary** | LLM-generated 2-3 sentence summary of findings |
| **Full Output** | Complete agent text response (scrollable, markdown-rendered) |
| **Tool Calls** | List of tools invoked during the run with inputs/outputs |
| **Signals** | Extracted signals/tags (e.g., `fatigue_detected`, `budget_waste`, `inventory_low`) |
| **Token Usage** | Prompt tokens, completion tokens, total, estimated cost |
| **Duration** | Wall-clock execution time |
| **Error** | Full error message and stack trace (if failed) |

#### Audit Trail

Full run data is persisted in `agent_job_runs` table including:
- Raw agent output (text + tool results)
- Token usage metrics
- Extracted signals
- Duration
- Error details (if any)

This data is retained indefinitely for compliance and trend analysis.

---

### 5.4 Insights Engine

The insights engine transforms raw job run history into actionable intelligence.

#### Insight Types

**A. Per-Run Findings** (generated at job completion)

After each run, an LLM summarizes the run output into structured findings:

```typescript
{
  runId: string;
  findings: [
    {
      type: "alert" | "observation" | "recommendation";
      severity: "critical" | "warning" | "info";
      title: "Creative fatigue detected on 2 ad sets";
      detail: "Ad sets 'Summer Sale - Carousel' and 'New Arrivals' show frequency > 4 with CTR declining 23% over 7 days";
      metric?: { name: "CTR", value: -23, unit: "%" };
      relatedEntity?: { type: "campaign", id: "...", name: "Summer Sale" };
    }
  ]
}
```

**B. Aggregated Trends** (generated on-demand or daily)

Cross-run trend analysis covering a time window:

- **Frequency analysis**: "Creative fatigue detected 5 times in the last 14 days — trending up from 2/week to 4/week"
- **Metric tracking**: "Average ROAS across all scans: 2.1x (down from 2.8x two weeks ago)"
- **Resolution tracking**: "3 of 5 fatigue alerts were followed by creative refreshes within 48 hours"

**C. Cross-Agent Correlations** (generated weekly)

Patterns that span multiple agents:

- "Store health score dropped 15% the same week ad spend increased 40% — possible traffic quality issue"
- "Email open rates declined after 3 consecutive weeks of high campaign frequency"
- "Inventory alerts for SKU X coincided with a 200% spike in ad-driven traffic to that product"

**D. Anomaly Detection**

Flag unusual patterns:

- Run duration significantly longer than average (possible API issues)
- Sudden spike in error signals
- Agent producing empty or minimal output (possible prompt degradation)

#### Insight Generation Architecture (v1)

```
Job Run Completes
       ↓
[Per-Run Insight Extraction]
  - LLM call (Haiku for cost) on run output
  - Extract findings + signals + metrics
  - Store in `agent_job_insights` table
       ↓
[Dashboard Display]
  - Insights panel on dashboard
  - Filterable by agent, severity, time range

(v2: Daily Aggregation Job for cross-agent trends + correlations)
```

#### Insights Dashboard Section

Displayed alongside or below the Kanban board:

```
┌─────────────────────────────────────────────────────────┐
│ Insights                              [Last 7 days ▾]   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ 🔴 CRITICAL (2)                                        │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ Creative fatigue on "Summer Sale" campaigns         │ │
│ │ Detected 3x this week • CTR down 23%               │ │
│ │ Recommendation: Refresh creatives immediately       │ │
│ │ [Chat About This] [Dismiss]                         │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│ 🟡 WARNING (5)                                         │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ Inventory low on 3 SKUs with active ads             │ │
│ │ Detected daily since Mar 28                         │ │
│ │ Linked: Store Manager + Performance Marketing       │ │
│ │ [Chat About This] [View Runs]                       │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│ 📊 TRENDS                                              │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ ROAS: 2.1x avg (↓ 0.7x from last week)            │ │
│ │ Store Health: 78/100 (↑ 5 from last week)          │ │
│ │ Email Open Rate: 24.3% (→ stable)                  │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

#### Insight-to-Chat Bridge

Each insight card has a "Chat About This" action that:
1. Opens a new chat (or continues existing)
2. Pre-fills the message: "Based on the [insight title] from [date], help me [recommended action]"
3. The supervisor already has the insight in working memory, so it responds with full context

---

### 5.5 Working Memory Integration

After each job run completes, the system updates Mastra working memory using **dedicated memory threads scoped to workspace + subagent**. This ensures each agent domain has its own isolated memory, and the supervisor can selectively load relevant context.

#### Memory Thread Structure

```
Thread IDs (one per workspace × subagent):
  ws-{workspaceId}-jobs-performance-marketing     → perf marketing run findings
  ws-{workspaceId}-jobs-shopify-store-manager      → store manager run findings
  ws-{workspaceId}-jobs-email-crm-manager          → email/CRM run findings
  ws-{workspaceId}-jobs-creative-director           → creative director run findings
  ws-{workspaceId}-jobs-cross-agent                 → cross-agent correlations + daily aggregation trends

Resource: workspace ID (shared across all members)
```

#### Memory Update Flow

```
Job Run Completes (e.g., performance-marketing-agent)
       ↓
Extract structured findings (signals, metrics, recommendations)
       ↓
Write to agent-specific memory thread:
  Thread: ws-{workspaceId}-jobs-performance-marketing
  Entry: {
    date: "2026-04-01",
    job: "Daily Ad Performance Scan",
    signals: ["fatigue_detected", "roas_declining"],
    summary: "ROAS declined 12% on Campaign 'Summer Sale'. Creative fatigue on 2 ad sets.",
    severity: "warning"
  }
       ↓
Prune: Keep only the last 30 days of findings per thread
(older findings remain in DB for audit but are removed from active memory)

Daily Aggregation Job
       ↓
Reads all agent-specific threads for the workspace
       ↓
Generates cross-agent correlations + trends via LLM
       ↓
Writes to: ws-{workspaceId}-jobs-cross-agent
```

#### Per-Thread Memory Template

Each agent-specific thread uses this template:

```
# Recent Job Findings — [Agent Name]

## Latest Findings
- [2026-04-01] Daily Ad Performance Scan: ROAS declined 12% on "Summer Sale". Creative fatigue on 2 ad sets. (warning)
- [2026-03-31] Daily Ad Performance Scan: All campaigns healthy. ROAS stable at 2.8x. (info)
- [2026-03-30] Creative Fatigue Check: Frequency > 4 on "New Arrivals" carousel. CTR down 15%. (warning)

## Active Signals
fatigue_detected (3x in 7 days, trending up)
roas_declining (2x in 7 days)
```

The cross-agent thread uses:

```
# Cross-Agent Insights

## Correlations
- Store health score dropped 15% the same week ad spend increased 40% — possible traffic quality issue
- Inventory alerts for SKU X coincided with 200% spike in ad-driven traffic

## Trends (7-day)
- ROAS: 2.1x avg (↓ 0.7x from prior week)
- Store Health: 78/100 (↑ 5 from prior week)
- Email Open Rate: 24.3% (→ stable)
```

#### Chat Integration Behavior

When a user opens chat:

1. **Supervisor loads a lightweight summary** from all subagent memory threads — last 3-5 signals per agent. This gives it a holistic operational snapshot without token bloat.

2. **On delegation**, the supervisor injects the target subagent's full memory thread into the delegation context. E.g., when delegating to Performance Marketing, it includes all recent perf marketing findings.

3. **Proactive surfacing**: Supervisor can reference the cross-agent thread — "I noticed from recent scans that your store health is declining while ad fatigue is increasing — these might be connected. Want me to investigate?"

4. **Direct recall**: User asks "What did the last store health check find?" — supervisor reads from `ws-{id}-jobs-shopify-store-manager` thread and responds from memory without running a new analysis.

#### Why Per-Agent Threads (Not a Single Thread)

| Concern | Single thread | Per-agent threads |
|---------|---------------|-------------------|
| Token efficiency | Loads all agent findings even when only one is relevant | Loads only the relevant agent's thread |
| Pruning | Hard to selectively prune — mixed entries | Each thread manages its own 30-day window |
| Delegation context | All findings in context, most irrelevant | Only targeted agent's findings injected |
| Cross-agent insights | Easy to query | Handled by dedicated cross-agent thread |
| Scalability | Grows linearly with total runs × agents | Grows linearly per agent, bounded |

---

### 5.6 Notifications

Reuses the `agent_notifications` table from the [cron-heartbeat-system](./cron-heartbeat-system.md) but extended for job context.

#### Notification Triggers

| Event | Notification | Severity |
|-------|-------------|----------|
| Job completed with critical findings | "Daily Ad Scan found critical issues: creative fatigue on 2 campaigns" | critical |
| Job completed with warnings | "Store Health Check: 3 SKUs below reorder point" | warning |
| Job completed normally | "Weekly Email Audit completed — all flows healthy" (if `notifyOnComplete`) | info |
| Job failed | "Daily Ad Scan failed: Meta Ads API rate limit exceeded" | error |
| Job skipped (connector missing) | "Weekly Email Audit skipped — Klaviyo not connected" | warning |
| Aggregated insight generated | "Weekly trend: ROAS declining for 3 consecutive weeks" | warning |

#### Delivery

- **In-app**: Badge count on dashboard nav item + notification drawer
- **Future (v2)**: Email digest, Slack webhook, push notifications

---

## 6. Data Model

### 6.1 New Tables

#### `agent_jobs` — Job definitions

```sql
CREATE TABLE agent_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  agent_id TEXT NOT NULL,              -- subagent ID or "auto"
  prompt TEXT NOT NULL,
  schedule TEXT NOT NULL,              -- cron expression
  timezone TEXT NOT NULL DEFAULT 'UTC',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  connector_requirements TEXT[] DEFAULT '{}',
  model_override TEXT,
  max_steps INTEGER DEFAULT 15,
  notify_on_complete BOOLEAN NOT NULL DEFAULT TRUE,
  notify_on_failure BOOLEAN NOT NULL DEFAULT TRUE,
  trigger_schedule_id TEXT,            -- Trigger.dev schedule ID for updates/deletes
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agent_jobs_workspace ON agent_jobs (workspace_id, enabled);
CREATE INDEX idx_agent_jobs_next_run ON agent_jobs (next_run_at) WHERE enabled = TRUE;
```

#### `agent_job_runs` — Individual run records

```sql
CREATE TABLE agent_job_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES agent_jobs(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  run_type TEXT NOT NULL CHECK (run_type IN ('scheduled', 'manual', 'retry')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped', 'cancelled')),
  prompt TEXT NOT NULL,                -- snapshot of prompt at run time
  summary TEXT,                        -- LLM-generated summary
  output JSONB NOT NULL DEFAULT '{}',  -- full agent response (text + tool results)
  signals TEXT[] DEFAULT '{}',         -- extracted signals (e.g., 'fatigue_detected')
  token_usage JSONB,                   -- { promptTokens, completionTokens, totalTokens }
  estimated_cost_usd NUMERIC(10, 6),   -- estimated LLM cost
  error TEXT,
  duration_ms INTEGER,
  trigger_run_id TEXT,                 -- Trigger.dev run ID for tracing
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_job_runs_job ON agent_job_runs (job_id, created_at DESC);
CREATE INDEX idx_job_runs_workspace_status ON agent_job_runs (workspace_id, status, created_at DESC);
CREATE INDEX idx_job_runs_workspace_completed ON agent_job_runs (workspace_id, completed_at DESC) WHERE status = 'completed';
```

#### `agent_job_insights` — Extracted insights

```sql
CREATE TABLE agent_job_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  run_id UUID REFERENCES agent_job_runs(id) ON DELETE SET NULL,
  insight_type TEXT NOT NULL CHECK (insight_type IN ('finding', 'trend', 'correlation', 'anomaly')),
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'warning', 'info')),
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  metric JSONB,                        -- { name, value, unit, direction }
  related_entity JSONB,                -- { type, id, name }
  agent_id TEXT,
  dismissed BOOLEAN NOT NULL DEFAULT FALSE,
  dismissed_by_user_id TEXT,
  dismissed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- NOTE: No expires_at — insights persist until manually dismissed by user
);

CREATE INDEX idx_insights_workspace ON agent_job_insights (workspace_id, dismissed, created_at DESC);
CREATE INDEX idx_insights_severity ON agent_job_insights (workspace_id, severity, created_at DESC);
```

### 6.2 Relationship Diagram

```
agent_jobs (1) ──< (N) agent_job_runs (1) ──< (N) agent_job_insights
     │                       │
     │                       └── agent_notifications (existing table)
     │
     └── workspace_id ──> Clerk Org / user_connections
```

---

## 7. API Design

All endpoints are prefixed with `/cowork` and require Clerk authentication.

### 7.1 Job Management

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/jobs` | Create a new job |
| `GET` | `/jobs` | List jobs for workspace |
| `GET` | `/jobs/:id` | Get job details |
| `PATCH` | `/jobs/:id` | Update job config |
| `DELETE` | `/jobs/:id` | Delete job (cascades to runs) |
| `POST` | `/jobs/:id/toggle` | Enable/disable job |
| `POST` | `/jobs/:id/run` | Trigger immediate manual run |

#### `POST /cowork/jobs` — Create job

**Request:**
```json
{
  "name": "Daily Ad Performance Scan",
  "description": "Check ROAS, creative fatigue, and budget waste",
  "agentId": "performance-marketing-agent",
  "prompt": "Run a daily performance scan: check ROAS trends across all active campaigns, detect creative fatigue, identify budget waste.",
  "schedule": "0 8 * * *",
  "timezone": "Asia/Kolkata",
  "connectorRequirements": ["meta-ads"],
  "modelOverride": "claude-haiku-4-5",
  "notifyOnComplete": true,
  "notifyOnFailure": true
}
```

**Response:** `201 Created`
```json
{
  "job": {
    "id": "uuid",
    "name": "Daily Ad Performance Scan",
    "nextRunAt": "2026-04-02T02:30:00.000Z",
    "...": "..."
  }
}
```

#### `GET /cowork/jobs` — List jobs

**Query params:** `?enabled=true&agentId=performance-marketing-agent`

**Response:**
```json
{
  "jobs": [...],
  "total": 8
}
```

### 7.2 Job Runs

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/jobs/:id/runs` | List runs for a job (paginated) |
| `GET` | `/job-runs` | List all runs for workspace (for kanban) |
| `GET` | `/job-runs/:runId` | Get full run details (audit view) |
| `POST` | `/job-runs/:runId/cancel` | Cancel a running job |
| `POST` | `/job-runs/:runId/retry` | Retry a failed run |

#### `GET /cowork/job-runs` — Kanban data

**Query params:** `?status=completed&agentId=...&from=2026-03-25&to=2026-04-01&limit=50&cursor=...`

**Response:**
```json
{
  "runs": [
    {
      "id": "uuid",
      "jobId": "uuid",
      "jobName": "Daily Ad Performance Scan",
      "agentId": "performance-marketing-agent",
      "status": "completed",
      "summary": "ROAS declined 12% on Campaign 'Summer Sale'...",
      "signals": ["fatigue_detected", "roas_declining"],
      "durationMs": 45000,
      "tokenUsage": { "total": 12400 },
      "completedAt": "2026-04-01T02:30:45.000Z"
    }
  ],
  "nextCursor": "...",
  "total": 142
}
```

#### `GET /cowork/job-runs/:runId` — Full audit detail

**Response:** Same as above but includes `output` (full agent text + tool results), `prompt` snapshot, `error` details, `estimatedCostUsd`.

### 7.3 Insights

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/insights` | List insights for workspace |
| `POST` | `/insights/:id/dismiss` | Dismiss an insight |
| `GET` | `/insights/summary` | Aggregated insight summary (for dashboard header) |

#### `GET /cowork/insights` — List insights

**Query params:** `?severity=critical,warning&insightType=finding,trend&agentId=...&from=...&to=...&limit=20`

**Response:**
```json
{
  "insights": [
    {
      "id": "uuid",
      "insightType": "finding",
      "severity": "critical",
      "title": "Creative fatigue on Summer Sale campaigns",
      "detail": "Ad sets show frequency > 4 with CTR declining 23% over 7 days",
      "metric": { "name": "CTR", "value": -23, "unit": "%", "direction": "down" },
      "agentId": "performance-marketing-agent",
      "runId": "uuid",
      "createdAt": "2026-04-01T02:31:00.000Z"
    }
  ],
  "counts": { "critical": 2, "warning": 5, "info": 12 }
}
```

#### `GET /cowork/insights/summary` — Dashboard header

**Response:**
```json
{
  "totalRuns7d": 42,
  "successRate7d": 0.95,
  "criticalInsights": 2,
  "warningInsights": 5,
  "topSignals": [
    { "signal": "fatigue_detected", "count": 5, "trend": "up" },
    { "signal": "inventory_low", "count": 3, "trend": "stable" }
  ],
  "tokenUsage7d": { "total": 284000, "estimatedCostUsd": 0.42 }
}
```

---

## 8. System Architecture

### 8.1 Component Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend (marketmint-ui)                     │
│                                                                  │
│  apps/marketmint-pro/                                               │
│  ├── app/(protected)/agents-dashboard/     ← NEW PAGE           │
│  ├── modules/agents-dashboard/             ← NEW MODULE         │
│  │   ├── components/                                            │
│  │   │   ├── kanban-board.tsx                                   │
│  │   │   ├── kanban-column.tsx                                  │
│  │   │   ├── kanban-card.tsx                                    │
│  │   │   ├── job-config-dialog.tsx                              │
│  │   │   ├── job-run-detail-drawer.tsx                          │
│  │   │   ├── insights-panel.tsx                                 │
│  │   │   ├── insight-card.tsx                                   │
│  │   │   └── dashboard-header.tsx                               │
│  │   ├── hooks/                                                 │
│  │   │   ├── use-jobs.ts                                        │
│  │   │   ├── use-job-runs.ts                                    │
│  │   │   └── use-insights.ts                                    │
│  │   └── api/                                                   │
│  │       └── agents-dashboard-client.ts                         │
│  └── lib/api/agents-dashboard-client.ts                         │
│                                                                  │
└──────────────────────────┬──────────────────────────────────────┘
                           │ REST API (Clerk auth)
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Backend (marketmint-pro-cowork)                    │
│                                                                  │
│  src/routes/                                                    │
│  ├── jobs.ts              ← Job CRUD endpoints                  │
│  ├── job-runs.ts          ← Run listing + actions               │
│  └── insights.ts          ← Insight listing + summary           │
│                                                                  │
│  src/db/schema/                                                 │
│  ├── agent-jobs.ts        ← agent_jobs table                    │
│  ├── agent-job-runs.ts    ← agent_job_runs table                │
│  └── agent-job-insights.ts← agent_job_insights table            │
│                                                                  │
│  src/lib/                                                       │
│  ├── job-scheduler.ts     ← Cron→Trigger.dev sync              │
│  ├── insight-extractor.ts ← LLM insight extraction              │
│  └── memory-sync.ts       ← Working memory update               │
│                                                                  │
└──────────────────────────┬──────────────────────────────────────┘
                           │ Trigger.dev API
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Trigger.dev (trigger-workflows)                  │
│                                                                  │
│  src/trigger/agent-jobs/                                        │
│  ├── scheduled-runner.ts  ← schedules.task() per job            │
│  └── headless-agent.ts    ← Calls cowork backend to run agent   │
│                                                                  │
│  OR: Dynamic schedule management via Trigger.dev API             │
│  (schedules.create/update/delete for user-defined cron)         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 8.2 Job Execution Flow

```
1. User creates job via dashboard
   └→ POST /cowork/jobs → insert into agent_jobs → register schedule with Trigger.dev

2. Trigger.dev fires on cron schedule
   └→ Calls headless agent runner
       └→ Checks workspace connectors
           ├─ Missing connector → status: skipped, create notification
           └─ Connectors OK → continue
       └→ runAgentHeadless(agentId, prompt, workspaceId)
           ├─ agentId = "auto" → supervisor routes to subagent
           └─ agentId = specific → direct subagent call
       └→ Agent executes (generate, not stream)
       └→ Insert into agent_job_runs (status: completed/failed)

3. Post-run processing (async)
   └→ Extract insights via LLM (Haiku)
       └→ Insert into agent_job_insights
   └→ Update supervisor working memory
       └→ Append findings to workspace memory thread
   └→ Create notifications (if enabled)
   └→ Update agent_jobs.last_run_at + compute next_run_at

4. Dashboard polls for updates
   └→ GET /cowork/job-runs → kanban data
   └→ GET /cowork/insights → insights panel
```

### 8.3 Trigger.dev Schedule Management

**Confirmed approach: Trigger.dev Imperative Schedules API**

Trigger.dev fully supports dynamic schedule management via `schedules.create()` / `schedules.update()` / `schedules.del()`. This is the recommended approach for user-defined cron jobs.

#### Architecture

**One `schedules.task()` definition** in trigger-workflows handles all agent job runs:

```typescript
// trigger-workflows/src/trigger/agent-jobs/scheduled-runner.ts
import { schedules } from "@trigger.dev/sdk";

export const agentJobRunner = schedules.task({
  id: "agent-job-runner",
  run: async (payload) => {
    // payload.externalId = job ID from our agent_jobs table
    // payload.timezone = user-configured timezone
    // payload.scheduleId = Trigger.dev schedule ID

    // 1. Fetch job config from cowork backend
    // 2. Check workspace connectors
    // 3. Run agent headlessly
    // 4. Store results + extract insights
    // 5. Update working memory
  },
});
```

**When a user creates/updates/deletes a job**, the cowork backend calls Trigger.dev SDK:

```typescript
// Create: POST /cowork/jobs
const schedule = await schedules.create({
  task: "agent-job-runner",
  cron: job.schedule,                              // e.g., "0 8 * * *"
  timezone: job.timezone,                           // e.g., "Asia/Kolkata"
  externalId: job.id,                               // our agent_jobs.id
  deduplicationKey: `agent-job-${job.id}`,          // prevents duplicates
});
// Store schedule.id in agent_jobs.triggerScheduleId

// Update: PATCH /cowork/jobs/:id
await schedules.update(job.triggerScheduleId, {
  task: "agent-job-runner",
  cron: newSchedule,
  timezone: newTimezone,
  externalId: job.id,
  deduplicationKey: `agent-job-${job.id}`,
});

// Toggle disable: POST /cowork/jobs/:id/toggle
await schedules.deactivate(job.triggerScheduleId);  // or .activate()

// Delete: DELETE /cowork/jobs/:id
await schedules.del(job.triggerScheduleId);
```

#### Key Trigger.dev Features Used

| Feature | Usage |
|---------|-------|
| `schedules.create()` | One schedule per user job with `deduplicationKey` |
| `externalId` | Maps to our `agent_jobs.id` for lookup in the runner |
| `timezone` | User's IANA timezone — Trigger.dev handles DST automatically |
| `deduplicationKey` | `agent-job-{jobId}` — prevents duplicate schedules |
| `schedules.deactivate/activate` | Enable/disable without deleting |
| `payload.upcoming` | Next 5 run times — used for "Upcoming" kanban column |
| Concurrency keys | `concurrencyKey: workspaceId` to enforce per-workspace limits |

#### Concurrency Control

```typescript
// Per-workspace concurrency limit
const agentJobQueue = queue({
  name: "agent-job-queue",
  concurrencyLimit: 5,  // max 5 concurrent runs per workspace
});

export const agentJobRunner = schedules.task({
  id: "agent-job-runner",
  queue: agentJobQueue,
  run: async (payload) => {
    // Trigger with concurrencyKey = workspaceId
    // This creates a per-workspace queue with limit 5
  },
});
```

#### Additional DB Column

Add `trigger_schedule_id TEXT` to `agent_jobs` table to store the Trigger.dev schedule ID for updates/deletes.

---

## 9. Additional Insight Considerations

Beyond the core insight types, the engine should also track:

| Insight Type | Description | Example |
|---|---|---|
| **Cost Efficiency** | Token usage trends per job, cost per insight | "Performance scan uses 40% fewer tokens with Haiku vs Sonnet — savings of $12/month" |
| **Job Health** | Success rate, avg duration, failure patterns | "Shopify Health Check has failed 3 of last 5 runs — investigate Shopify API connectivity" |
| **Recommendation Engine** | Suggest new jobs based on connected services | "You connected Google Ads but have no ad performance job — would you like to set one up?" |
| **Stale Job Detection** | Jobs that haven't produced actionable findings in N runs | "Email audit has returned 'all healthy' for 8 consecutive weeks — consider reducing frequency to monthly" |
| **Signal Co-occurrence** | Signals that frequently appear together | "fatigue_detected and roas_declining co-occur in 80% of runs — these are likely the same root cause" |

---

## 10. Non-Functional Requirements

| Requirement | Target |
|-------------|--------|
| **Job execution latency** | < 2 min from scheduled time to run start |
| **Dashboard load time** | < 1.5s for initial kanban + insights render |
| **Run data retention** | Indefinite (for audit compliance) |
| **Insight retention** | Indefinite — insights persist until manually dismissed (no auto-expire) |
| **Working memory staleness** | Findings older than 30 days pruned from active memory |
| **Max concurrent runs per workspace** | 5 (to prevent runaway costs) |
| **Max jobs per workspace** | 50 (soft limit, configurable) |
| **API rate limit** | Standard Clerk-enforced limits |
| **Token cost per run (target)** | < 20K tokens avg using Haiku |

---

## 11. Success Metrics

| Metric | Target (3 months post-launch) |
|--------|-------------------------------|
| **Adoption** | 40% of active workspaces have ≥ 1 job configured |
| **Engagement** | Avg 3 jobs per workspace |
| **Insight action rate** | 30% of critical/warning insights lead to a chat session |
| **Proactive chat usage** | 20% of chat sessions reference job findings from memory |
| **Job reliability** | 95% success rate across all runs |
| **Time to insight** | < 3 min from schedule trigger to insight visible on dashboard |

---

## 12. Phased Rollout

### Phase 1: Foundation (Weeks 1-2)
- DB schema: `agent_jobs`, `agent_job_runs`, `agent_job_insights`
- Backend APIs: Job CRUD, run listing, manual trigger
- Headless agent runner (extend from cron-heartbeat-system)
- Trigger.dev schedule integration (dynamic schedules)
- Basic frontend: Job list + create dialog + manual run

### Phase 2: Kanban + Execution (Weeks 3-4)
- Kanban board UI with 4 columns
- Job run cards with summary display
- Run detail drawer (full audit view)
- Scheduled execution via Trigger.dev
- Run now / cancel / retry actions
- Polling-based dashboard refresh

### Phase 3: Insights + Memory (Weeks 5-6)
- Per-run insight extraction (LLM)
- Insights panel on dashboard
- Working memory sync after each run (per-agent threads)
- "Chat About This" bridge — opens new chat pre-filled with insight context

### Phase 4: Polish + Notifications (Weeks 7-8)
- Notification system (in-app badge + drawer)
- Connector validation + skip handling
- Stale job detection + recommendation engine
- Dashboard header with summary stats
- Filters, search, time range controls
- Cost tracking and token usage display

---

## 13. Resolved Decisions

| # | Question | Decision | Rationale |
|---|----------|----------|-----------|
| 1 | Trigger.dev dynamic schedules | **Use `schedules.create()` imperative API** | Trigger.dev SDK fully supports dynamic schedule CRUD with `deduplicationKey`, `externalId`, timezone, activate/deactivate. One `schedules.task()` definition + N imperative schedules. |
| 2 | Auto-routing via supervisor or lightweight classifier? | **Full supervisor with delegation** | Supervisor already has routing table, delegation callbacks, and multi-agent chain support. Routing overhead is minimal (no content generation). Avoids maintaining a separate classifier. |
| 3 | Max concurrent runs per workspace | **5 concurrent runs** | Enforced via Trigger.dev `concurrencyKey: workspaceId` on a shared queue with `concurrencyLimit: 5`. |
| 4 | Dashboard placement | **Top-level sidebar nav item** — new page at `/agents-dashboard` | Not a settings tab. This is a primary workflow surface, not a configuration page. |
| 5 | Daily aggregation job visibility | **Visible as a system job** on the dashboard (marked with "System" badge, not editable/deletable by users) | Transparency — users should see that the system is actively analyzing their data. |
| 6 | Insight expiry | **No auto-expire** — insights persist until manually dismissed by a user | Users want explicit control. Dismissed insights are soft-deleted (retained for audit). |
| 7 | Working memory thread strategy | **Dedicated per-agent threads** scoped to workspace + subagent, plus a cross-agent thread for correlations | Token-efficient (only relevant agent's thread loaded on delegation), clean pruning, scalable. See section 5.5 for full design. |

## 14. Resolved — Remaining Questions

| # | Question | Decision |
|---|----------|----------|
| 1 | Trigger.dev schedule limits | **Pro plan supports 1000+ scheduled jobs** — no concern. |
| 2 | Daily aggregation job | **Deferred** — skip for v1. Cross-agent insights will be added later. Per-run insight extraction still in scope. |
| 3 | "Chat About This" behavior | **Always opens a new chat** pre-filled with insight context. |
| 4 | Pause-all-jobs switch | **Not needed for v1.** |

---

## 15. Dependencies

| Dependency | Status | Notes |
|------------|--------|-------|
| Supervisor agent system (Phase 3) | ✅ Complete | All 4 subagents live with delegation |
| Cron/heartbeat system foundation | ⬜ Not started | Headless runner, workspace registry needed |
| Trigger.dev imperative schedules | ✅ Confirmed | SDK supports `schedules.create/update/del/activate/deactivate` |
| Frontend agents-dashboard route | ⬜ New | New sidebar page in marketmint-ui at `/agents-dashboard` |
| Mastra working memory write API | ⬜ Needs verification | Confirm we can programmatically write to per-agent memory threads |
| Trigger.dev `@trigger.dev/sdk` in cowork | ⬜ New dependency | Backend needs SDK to call `schedules.create()` from job CRUD endpoints |

---

## 16. Deferred: Daily Aggregation System Job (v2)

> **Deferred** — cross-agent trend/correlation generation is out of scope for v1. The per-run insight extraction (section 5.4, type A) is still in scope. This section is retained for v2 planning.

When implemented, a system-managed daily job would:
- Read all per-agent memory threads and recent insights
- Generate cross-agent correlations, trend analysis, anomaly detection, stale job detection
- Write to `agent_job_insights` with types `trend`, `correlation`, `anomaly`
- Update the cross-agent memory thread (`ws-{workspaceId}-jobs-cross-agent`)
