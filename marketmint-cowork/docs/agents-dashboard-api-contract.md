# Agents Dashboard — API Contract

## Auth

All endpoints require **Clerk authentication** via the `Authorization: Bearer <token>` header. The workspace is derived from the authenticated user's `orgId`. If `orgId` is missing, endpoints return `422`.

**Common Headers:**

| Header | Required | Description |
|---|---|---|
| `Authorization` | Yes | `Bearer <clerk_session_token>` |
| `Content-Type` | Yes (POST/PATCH) | `application/json` |

**Common Error Shapes:**

```json
{ "error": "string message" }
{ "error": "string message", "details": [/* Zod issues */] }
```

| Status | Meaning |
|---|---|
| `400` | Validation error |
| `403` | Resource belongs to another workspace |
| `404` | Resource not found |
| `422` | Missing workspace (no `orgId` on session) |
| `500` | Internal error |

## 1. Create Agent Job (Free Flow)

`POST /api/cowork/agent-jobs/ai`

Optionally pass `?jobId=<uuid>` to supply your own ID (otherwise server generates one).

**Request Body:**

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `prompt` | `string` | Yes | — | Prompt template for each run |
| `notificationChannels` | `("email" \| "slack" \| "sms")[]` | No | `["email"]` | Channels to deliver notifications to. Include `"slack"` to send run results to a Slack channel (requires `metadata.slackChannel`). |
| `metadata` | `object` | No | `{}` | Arbitrary key-value metadata. Use `slackChannel` key to set the Slack channel ID for notifications (e.g. `{ "slackChannel": "C01ABC123" }`). |

**200 Response — `AgentJob`:**

```json
{
  "id": "uuid",
  "workspaceId": "string",
  "createdByUserId": "string",
  "triggerScheduleId": "string | null",
  "name": "string",
  "description": "string | null",
  "agentIds": ["string"],
  "prompt": "string",
  "schedule": "string",
  "timezone": "string",
  "enabled": true,
  "connectorRequirements": ["string"] | null,
  "notifyOnComplete": true,
  "notifyOnFailure": true,
  "notificationChannels": ["email"],
  "metadata": {},
  "lastRunAt": "ISO8601 | null",
  "nextRunAt": "ISO8601 | null",
  "createdAt": "ISO8601",
  "updatedAt": "ISO8601"
}
```

---

## 2. Create Agent Job (Rigid)

`POST /api/cowork/agent-jobs`

Optionally pass `?jobId=<uuid>` to supply your own ID (otherwise server generates one).

**Request Body:**

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `name` | `string` | Yes | — | 1–120 chars |
| `description` | `string` | No | — | Max 500 chars |
| `agentIds` | `string[]` | Yes | — | At least 1 sub-agent ID |
| `prompt` | `string` | Yes | — | Prompt template for each run |
| `schedule` | `string` | Yes | — | Cron expression (e.g. `0 9 * * 1`) |
| `timezone` | `string` | No | `"UTC"` | IANA timezone |
| `enabled` | `boolean` | No | `true` | Whether job is active |
| `connectorRequirements` | `string[]` | No | `[]` | Required connector keys (e.g. `"shopify"`) |
| `notifyOnComplete` | `boolean` | No | `true` | Notify on success |
| `notifyOnFailure` | `boolean` | No | `true` | Notify on failure |
| `notificationChannels` | `("email" \| "slack" \| "sms")[]` | No | `["email"]` | Channels to deliver notifications to. Include `"slack"` to send run results to a Slack channel (requires `metadata.slackChannel`). |
| `metadata` | `object` | No | `{}` | Arbitrary key-value metadata. Use `slackChannel` key to set the Slack channel ID for notifications (e.g. `{ "slackChannel": "C01ABC123" }`). |

**200 Response — `AgentJob`:**

```json
{
  "id": "uuid",
  "workspaceId": "string",
  "createdByUserId": "string",
  "triggerScheduleId": "string | null",
  "name": "string",
  "description": "string | null",
  "agentIds": ["string"],
  "prompt": "string",
  "schedule": "string",
  "timezone": "string",
  "enabled": true,
  "connectorRequirements": ["string"] | null,
  "notifyOnComplete": true,
  "notifyOnFailure": true,
  "notificationChannels": ["email"],
  "metadata": {},
  "lastRunAt": "ISO8601 | null",
  "nextRunAt": "ISO8601 | null",
  "createdAt": "ISO8601",
  "updatedAt": "ISO8601"
}
```

---

## 3. List Runs for Workspace

`GET /api/cowork/agent-job-runs`

Paginated list of runs across all jobs in the workspace. **Sorting convention for UI tabs:**

| UI Tab | `status` | `orderBy` | `order` |
|---|---|---|---|
| Upcoming | `pending` | `scheduledAt` | `asc` |
| In Progress | `running` | `startedAt` | `desc` |
| Completed | `completed` | `completedAt` | `desc` |

**Query Params:**

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `status` | `"pending" \| "running" \| "completed" \| "failed" \| "skipped" \| "cancelled"` | No | — | Filter by status |
| `limit` | `int` | No | `50` | Max 100 |
| `offset` | `int` | No | `0` | For pagination |
| `orderBy` | `"createdAt" \| "scheduledAt" \| "startedAt" \| "completedAt"` | No | `"createdAt"` | Column to sort by |
| `order` | `"asc" \| "desc"` | No | `"desc"` | Sort direction |
| `agentIds` | `string[]` | No | — | Filter runs by agent IDs |

**Example:**

```
GET /api/cowork/agent-job-runs?status=pending&orderBy=scheduledAt&order=asc&limit=20&offset=0
```

**200 Response — `AgentJobRunCard[]`:**

```json
[
  {
    "id": "uuid",
    "jobId": "uuid",
    "workspaceId": "string",
    "agentIds": ["string"],
    "name": "string",
    "description": "string | null",
    "createdAt": "ISO8601",
    "scheduledAt": "ISO8601 | null",
    "completedAt": "ISO8601 | null",
    "durationMs": 1234
  }
]
```

---

## 4. Get Run Details (with Job + Insights)

`GET /api/cowork/agent-job-runs/details/:runId`

Returns the full run record with the parent `job` and all `insights` eagerly loaded.

**Path Params:**

| Param | Type | Description |
|---|---|---|
| `runId` | `uuid` | Run ID |

**200 Response — `AgentJobRun` + relations:**

```json
{
  "id": "uuid",
  "jobId": "uuid",
  "workspaceId": "string",
  "agentIds": ["string"],
  "runType": "scheduled",
  "status": "completed",
  "prompt": "string",
  "summary": "string | null",
  "output": {},
  "signals": ["string"],
  "tokenUsage": { "promptTokens": 0, "completionTokens": 0, "totalTokens": 0 },
  "estimatedCostUsd": "string | null",
  "error": "string | null",
  "durationMs": 4521,
  "triggerRunId": "string | null",
  "scheduledAt": "ISO8601 | null",
  "startedAt": "ISO8601 | null",
  "completedAt": "ISO8601 | null",
  "createdAt": "ISO8601",

  "job": {
    "id": "uuid",
    "workspaceId": "string",
    "createdByUserId": "string",
    "triggerScheduleId": "string | null",
    "name": "string",
    "description": "string | null",
    "agentIds": ["string"],
    "prompt": "string",
    "schedule": "string",
    "timezone": "string",
    "enabled": true,
    "connectorRequirements": ["string"],
    "notifyOnComplete": true,
    "notifyOnFailure": true,
    "notificationChannels": ["email"],
    "metadata": {},
    "lastRunAt": "ISO8601 | null",
    "nextRunAt": "ISO8601 | null",
    "createdAt": "ISO8601",
    "updatedAt": "ISO8601"
  },

  "insights": [
    {
      "id": "uuid",
      "workspaceId": "string",
      "runId": "uuid | null",
      "insightType": "finding | trend | correlation | anomaly",
      "severity": "critical | warning | info",
      "title": "string",
      "detail": "string",
      "metric": {
        "name": "string",
        "value": 0,
        "unit": "string",
        "direction": "up | down | flat"
      },
      "relatedEntity": {
        "type": "string",
        "id": "string",
        "name": "string"
      },
      "agentId": "string | null",
      "dismissed": false,
      "dismissedByUserId": "string | null",
      "dismissedAt": "ISO8601 | null",
      "createdAt": "ISO8601"
    }
  ]
}
```

---

## 5. List Insights for Workspace

`GET /api/cowork/agent-job-insights`

Paginated list of insights across all runs in the workspace. Dismissed insights are excluded by default.

**Query Params:**

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `includeDismissed` | `boolean` | No | `false` | Include dismissed insights |
| `severity` | `"critical" \| "warning" \| "info"` | No | — | Filter by severity |
| `limit` | `int` | No | `50` | Max 100 |
| `offset` | `int` | No | `0` | For pagination |

**200 Response — `AgentJobInsight[]`:**

Same shape as the `insights` array in endpoint 3.

---

## 6. List Agents

`GET /api/cowork/agents/list`

Returns the full list of available agents with their config, connectors, jobs, and usage hints.

**200 Response — `AgentConfig[]`:**

```json
[
  {
    "id": "string",
    "name": "string",
    "role": "string",
    "avatarColor": "string",
    "avatarSrc": "string",
    "description": "string",
    "connectors": [
      { "providerKey": "string", "label": "string" }
    ],
    "jobs": [
      {
        "title": "string",
        "description": "string",
        "connectors": ["string"]
      }
    ],
    "soulMd": "string",
    "howToUse": ["string"]
  }
]
```

---

## 7. Get Agent by ID

`GET /api/cowork/agents/:agentId`

Returns a single agent config by ID. Returns `null` if the agent is not found.

**Path Params:**

| Param | Type | Description |
|---|---|---|
| `agentId` | `string` | Agent identifier (e.g. `aria`, `don`, `cleo`) |

**200 Response — `AgentConfig`:**

Same shape as a single element of the array in endpoint 6.

---

## 8. Try in Cowork (Build Prompt from Run)

`POST /api/cowork/agent-job-runs/:runId/try-in-cowork`

Fetches the run with its parent job and insights, then either returns an existing chat (if one was already created for this job+run) or assembles a markdown prompt for starting a new Cowork chat session.

**Path Params:**

| Param | Type | Description |
|---|---|---|
| `runId` | `uuid` | Agent job run ID |

**Request Body (optional):**

| Field | Type | Required | Description |
|---|---|---|---|
| `customPrompt` | `string` | No | Additional prompt text appended after the generated context (only used when creating a new prompt) |

**200 Response:**

| Field | Type | Description |
|---|---|---|
| `agentJobRunId` | `uuid` | The run ID |
| `content` | `string \| null` | Markdown prompt for a new chat. `null` when a chat already exists. |
| `chatId` | `uuid \| null` | Existing chat ID if this run already has a linked chat. `null` when no chat exists yet. |

**Case 1 — No existing chat (first call):**

```json
{
  "agentJobRunId": "uuid",
  "content": "# Job Name\n\nJob description...\n\n**Schedule:** ...\n\n## Latest Run Details\n\n### Summary\n\n...",
  "chatId": null
}
```

The frontend should use `content` to create a new chat and pass `agentJobRunId` to the `/chat` endpoint.

**Case 2 — Chat already exists (subsequent calls):**

```json
{
  "agentJobRunId": "uuid",
  "content": null,
  "chatId": "existing-chat-uuid"
}
```

The frontend should redirect to the existing chat using `chatId`.

**Markdown prompt structure (when `content` is non-null):**

```
# {job.name}

{job.description}

**Schedule:** {job.schedule} ({job.timezone})

## Latest Run Details

### Summary

{run.summary}

### Insights

- **[{severity}] {title}**: {detail}

---

{customPrompt}
```

---

## 9. Chat Endpoint — `agentJobRunId` Support

`POST /api/v3/chat`

The chat endpoint now accepts an optional `agentJobRunId` field. When provided, the server looks up the corresponding run's `jobId` and creates an entry in the `agent_job_chats` pivot table, linking the chat to both the agent job and the specific run.

**Additional field in request body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `agentJobRunId` | `string (uuid)` | No | Links this chat to an agent job run. The server resolves `agentJobId` from the run automatically. Uses `onConflictDoNothing` so duplicate sends are safe. |

---

## 10. List Slack Channels

`GET /api/cowork/connectors/slack/channels`

Returns the Slack channels (public and private) that the workspace's connected Slack bot has access to. If Slack is not connected for the workspace, returns an empty array.

**200 Response:**

```json
{
  "channels": [
    {
      "id": "C01ABC123",
      "name": "general",
      "topic": "Company-wide announcements",
      "purpose": "General discussion",
      "is_private": false,
      "num_members": 42
    }
  ],
  "count": 1
}
```

| Field | Type | Description |
|---|---|---|
| `channels` | `array` | List of Slack channels |
| `channels[].id` | `string` | Slack channel ID (e.g. `C01ABC123`) |
| `channels[].name` | `string` | Channel name |
| `channels[].topic` | `string` | Channel topic |
| `channels[].purpose` | `string` | Channel purpose |
| `channels[].is_private` | `boolean` | Whether the channel is private |
| `channels[].num_members` | `number` | Number of members in the channel |
| `count` | `number` | Total number of channels returned |

---

## Slack Notification Flow

To enable Slack notifications for an agent job:

1. **Check connection** — call `GET /api/cowork/connectors/slack/channels`. If the response contains channels, Slack is connected.
2. **Let the user pick a channel** — present the channel list in a dropdown/picker.
3. **Create or update the job** — pass `notificationChannels: ["email", "slack"]` and `metadata: { "slackChannel": "<channel_id>" }` in the request body.
4. **At run time** — the backend checks `notificationChannels` and, when `"slack"` is present and `metadata.slackChannel` is set, posts a summary message to the chosen Slack channel on completion or failure.

---

## 11. List Agent Configs

`GET /api/cowork/agent-configs`

Returns all agent configs for the authenticated workspace. If no configs exist yet, defaults are auto-seeded on the first call.

> **Frontend convention:** Fetch all agents (no query params needed). Use `available: false` to display a "Coming soon" badge/state in the UI and when enabled is false, grey it out and add option to enable if available is true.

**200 Response — `AgentConfig[]`:**

```json
[
  {
    "id": "ULID",
    "workspaceId": "string",
    "name": "string",
    "key": "string",
    "role": "string",
    "enabled": true,
    "available": true,
    "avatarColor": "#RRGGBB",
    "avatarSrc": "string",
    "description": "string | null",
    "connectors": [
      { "providerKey": "shopify | meta-ads | google-ads | google-analytics | slack", "label": "string" }
    ],
    "jobs": [
      { "title": "string", "description": "string | null", "connectors": ["string"] }
    ],
    "soulMd": "string | null",
    "howToUse": ["string"],
    "createdAt": "ISO8601",
    "updatedAt": "ISO8601"
  }
]
```

---

## 12. Get Agent Config by Key

`GET /api/cowork/agent-configs/key/:key`

Returns a single agent config by its unique key. Uses Redis cache with DB fallback.

**Path Params:**

| Param | Type | Description |
|---|---|---|
| `key` | `string` | Agent config key (e.g. `aria`, `don`, `cleo`) |

**200 Response — `AgentConfig`:**

Same shape as a single element of the array in endpoint 10.

---

## 13. Update Agent Config

`PATCH /api/cowork/agent-configs/:configId`

Partially updates an agent config. Only provided fields are changed. Invalidates the Redis cache for the updated key.

**Path Params:**

| Param | Type | Description |
|---|---|---|
| `configId` | `ULID` | Agent config ID |

**Request Body (all fields optional):**

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | `string` | No | Agent display name |
| `role` | `string` | No | Agent role label |
| `enabled` | `boolean` | No | Enable or disable the agent |
| `available` | `boolean` | No | Whether the agent is available. When `false`, UI should show "Coming soon" |
| `avatarColor` | `string` | No | Hex color (`#RRGGBB`) |
| `avatarSrc` | `string` | No | Avatar image URL |
| `description` | `string \| null` | No | Agent description |
| `connectors` | `Connector[]` | No | Required connectors (`{ providerKey, label }`) |
| `jobs` | `Job[]` | No | Suggested job templates (`{ title, description, connectors }`) |
| `soulMd` | `string \| null` | No | Agent personality markdown |
| `howToUse` | `string[]` | No | Usage hints |

**200 Response — `AgentConfig`:**

Same shape as a single element of the array in endpoint 10.

---

## Quick Reference

| # | Method | Path | Purpose |
|---|---|---|---|
| 1 | `POST` | `/api/cowork/agent-jobs/ai` | Create free flow scheduled agent job |
| 2 | `POST` | `/api/cowork/agent-jobs` | Create a scheduled agent job |
| 3 | `GET` | `/api/cowork/agent-job-runs` | List runs (paginated, filterable by status) |
| 4 | `GET` | `/api/cowork/agent-job-runs/details/:runId` | Full run detail with job + insights |
| 5 | `GET` | `/api/cowork/agent-job-insights` | List workspace insights |
| 6 | `GET` | `/api/cowork/agents/list` | List all available agents |
| 7 | `GET` | `/api/cowork/agents/:agentId` | Get single agent config by ID |
| 8 | `POST` | `/api/cowork/agent-job-runs/:runId/try-in-cowork` | Build markdown prompt from run for Cowork chat |
| 9 | `POST` | `/api/v3/chat` | Chat endpoint (now accepts optional `agentJobRunId`) |
| 10 | `GET` | `/api/cowork/connectors/slack/channels` | List Slack channels for the connected workspace |
| 11 | `GET` | `/api/cowork/agent-configs` | List agent configs for workspace |
| 12 | `GET` | `/api/cowork/agent-configs/key/:key` | Get agent config by key |
| 13 | `PATCH` | `/api/cowork/agent-configs/:configId` | Update agent config |
