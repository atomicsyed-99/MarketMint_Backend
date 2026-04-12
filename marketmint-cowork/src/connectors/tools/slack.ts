import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { nangoProxy } from "@/connectors/nango/proxy";

const PROVIDER_CONFIG_KEY = "slack";

export function createSlackTools(connectionId: string) {
  return {
    slack_list_channels: createTool({
      id: "slack-list-channels",
      description:
        "List Slack channels (public and private) the bot has access to. Returns channel id, name, topic, and purpose.",
      inputSchema: z.object({
        limit: z
          .number()
          .optional()
          .describe("Max channels to return (default 200, max 1000)"),
        cursor: z
          .string()
          .optional()
          .describe("Cursor to start from (pagination)"),
      }),
      execute: async (input) => {
        const data = await nangoProxy(
          PROVIDER_CONFIG_KEY,
          connectionId,
          "GET",
          "/conversations.list",
          {
            params: {
              types: "public_channel,private_channel",
              limit: input.limit ?? 200,
              exclude_archived: true,
              ...(input.cursor ? { cursor: input.cursor } : {}),
            },
          },
        );

        const channels = (data as any)?.channels ?? [];
        return {
          channels: channels.map((ch: any) => ({
            id: ch.id,
            name: ch.name,
            topic: ch.topic?.value ?? "",
            purpose: ch.purpose?.value ?? "",
            is_private: ch.is_private ?? false,
            num_members: ch.num_members ?? 0,
          })),
          count: channels.length,
          nextCursor: data.response_metadata?.next_cursor ?? null,
        };
      },
    }),

    slack_send_message: createTool({
      id: "slack-send-message",
      description:
        "Send a message to a Slack channel. This is a WRITE operation — confirm with the user before executing.",
      inputSchema: z.object({
        channel: z
          .string()
          .describe("Channel ID to post to (e.g. C01ABC123). Use slack_list_channels to find IDs."),
        text: z.string().describe("Message text to send (supports Slack mrkdwn formatting)"),
      }),
      execute: async (input) => {
        const data = await nangoProxy(
          PROVIDER_CONFIG_KEY,
          connectionId,
          "POST",
          "/chat.postMessage",
          {
            body: {
              channel: input.channel,
              text: input.text,
            },
          },
        );

        const result = data as any;
        return {
          ok: result?.ok ?? false,
          channel: result?.channel,
          ts: result?.ts,
          message: result?.ok
            ? "Message sent successfully"
            : (result?.error ?? "Failed to send message"),
        };
      },
    }),
  };
}
