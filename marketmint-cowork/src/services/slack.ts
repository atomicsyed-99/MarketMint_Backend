import { getUserConnections } from "@/connectors/nango/connections";
import { nangoProxy } from "@/connectors/nango/proxy";
import { env } from "@/env";
import { createLogger } from "@/lib/logger";

const log = createLogger("slack-service");

const PROVIDER_CONFIG_KEY = "slack";

// ---------------------------------------------------------------------------
// Connection resolution
// ---------------------------------------------------------------------------

async function getSlackConnectionId(
  workspaceId: string,
): Promise<string | null> {
  const connections = await getUserConnections(workspaceId);
  const slack = connections[PROVIDER_CONFIG_KEY];
  return slack?.connectionId ?? null;
}

// ---------------------------------------------------------------------------
// List channels
// ---------------------------------------------------------------------------

export interface SlackChannel {
  id: string;
  name: string;
  topic: string;
  purpose: string;
  is_private: boolean;
  num_members: number;
}

export async function listSlackChannels(
  workspaceId: string, nextCursor?: string,
): Promise<{ channels: SlackChannel[]; nextCursor?: string; count: number }> {
  const connectionId = await getSlackConnectionId(workspaceId);
  if (!connectionId) {
    return { channels: [], count: 0 };
  }

  const data = await nangoProxy(
    PROVIDER_CONFIG_KEY,
    connectionId,
    "GET",
    "/conversations.list",
    {
      params: {
        types: "public_channel,private_channel",
        limit: 200,
        exclude_archived: true,
        ...(nextCursor ? { cursor: nextCursor } : {}),
      },
    },
  );

  const raw = (data as any)?.channels ?? [];
  const channels: SlackChannel[] = raw.map((ch: any) => ({
    id: ch.id,
    name: ch.name,
    topic: ch.topic?.value ?? "",
    purpose: ch.purpose?.value ?? "",
    is_private: ch.is_private ?? false,
    num_members: ch.num_members ?? 0,
  }));

  return { channels, count: channels.length, nextCursor: data.response_metadata?.next_cursor ?? null };
}

// ---------------------------------------------------------------------------
// Send message with Block Kit blocks
// ---------------------------------------------------------------------------

export interface SendSlackBlocksResult {
  ok: boolean;
  ts?: string;
  error?: string;
}

/**
 * Send a Slack message with Block Kit blocks to a channel.
 * Resolves the workspace's Slack connection via Nango.
 * Returns gracefully if Slack is not connected.
 */
export async function sendSlackBlocks(
  workspaceId: string,
  channel: string,
  blocks: Record<string, unknown>[],
  text?: string,
): Promise<SendSlackBlocksResult> {
  const connectionId = await getSlackConnectionId(workspaceId);
  if (!connectionId) {
    log.warn({ workspaceId }, "Slack not connected, skipping message");
    return { ok: false, error: "slack_not_connected" };
  }

  const data = await nangoProxy(
    PROVIDER_CONFIG_KEY,
    connectionId,
    "POST",
    "/chat.postMessage",
    {
      body: {
        channel,
        blocks,
        text: text ?? "",
      },
    },
  );

  const result = data as any;
  return {
    ok: result?.ok ?? false,
    ts: result?.ts,
    error: result?.ok ? undefined : (result?.error ?? "unknown_error"),
  };
}

// ---------------------------------------------------------------------------
// Agent job notification convenience wrapper
// ---------------------------------------------------------------------------

interface AgentJobSlackNotificationParams {
  jobName: string;
  agentJobRunId: string;
  status: "completed" | "failed" | "token_warning";
  summary?: string;
}

/**
 * Send a Slack notification for an agent job run.
 * Never throws -- logs errors and returns silently.
 */
export async function sendAgentJobSlackNotification(
  workspaceId: string,
  channel: string,
  params: AgentJobSlackNotificationParams,
): Promise<void> {
  if (!channel) return;

  try {
    const statusEmoji =
      params.status === "completed"
        ? ":white_check_mark:"
        : params.status === "failed"
          ? ":x:"
          : ":warning:";
    const statusText =
      params.status === "completed"
        ? "Completed"
        : params.status === "failed"
          ? "Failed"
          : "High token usage";
    const blocks: Record<string, unknown>[] = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `${params.jobName} — ${statusText}`,
          emoji: true,
        },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Status:*\n${statusEmoji} ${statusText}` },
          { type: "mrkdwn", text: `*Run ID:*\n\`${params.agentJobRunId}\`` },
        ],
      },
    ];

    if (params.summary) {
      const truncated =
        params.summary.length > 2900
          ? params.summary.slice(0, 2900) + "…"
          : params.summary;
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: `*Summary:*\n${truncated}` },
      });
    }

    if (env.FRONT_END_BASE_URL) {
      blocks.push({
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "View Job", emoji: true },
            url: `${env.FRONT_END_BASE_URL}/agents?tab=jobs&agentJobRunId=${params.agentJobRunId}`,
            style: "primary",
          },
        ],
      });
    }

    const fallbackText =
      params.status === "token_warning"
        ? `Agent job "${params.jobName}" high token usage`
        : `Agent job "${params.jobName}" ${params.status}`;

    await sendSlackBlocks(workspaceId, channel, blocks, fallbackText);
  } catch (err) {
    log.error({ err, workspaceId, channel }, "Failed to send Slack job notification");
  }
}
