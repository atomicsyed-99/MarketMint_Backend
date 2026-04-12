import type { Context } from "hono";
import { eq } from "drizzle-orm";
import { handleChatStream } from "@mastra/ai-sdk";
import { RequestContext } from "@mastra/core/request-context";
import { createLogger } from "@/lib/logger";

const log = createLogger("chat");
import { captureException } from "@/lib/sentry";
import { z } from "zod";
import { db } from "@/db/client";
import { chats } from "@/db/schema/chats";
import { agentJobChats } from "@/db/schema/agent-job-chats";
import { agentJobRuns } from "@/db/schema/agent-job-runs";
import {
  createMessage,
  createOrUpdateMessage,
  deleteMessageByMessageId,
} from "@/db/queries/messages";
import { getUserConnections } from "@/connectors/nango/connections";
import {
  getOrCreateConnectorProcessor,
  createEmptyConnectorProcessor,
  createOrchestratorInputProcessor,
} from "@/connectors/build-toolset";
import {
  buildConnectorSystemPrompt,
  buildOrchestratorConnectorContextPrompt,
} from "@/connectors/prompt";
import { upsertExecutionForChat } from "@/lib/executions-sync";

import { sanitizeAttachments, enrichAttachments, buildAttachmentContext } from "./chat/attachment-enrichment";
import {
  assertHasEnoughCredits,
  buildBrandMemoryBlock,
  collectUserTextForHiddenPayload,
  deriveProductImageUrlFromTemplateAttachments,
  extractContent,
  extractAttachmentsFromMessages,
  extractAttachmentsFromContentArray,
  generateChatTitle,
  normalizeIncomingMessagesForAgent,
  parseHiddenTemplatePayloadFromText,
} from "./chat/helpers";
import { wrapStreamWithPersistence, type StreamState } from "./chat/stream-processor";
import { SUPERVISOR_MAX_STEPS } from "@/constants";
import { buildScheduledJobOrchestratorSystemBlock } from "./chat/scheduled-job-intent";
import { mastraRegistryKeyForChatAgentId } from "@/lib/agent-job-readonly-tools";
import { aggregatedOutputTokensFromAgentFinish } from "@/lib/conversation-output-tokens";
import { deductCreditsForConversation } from "@/lib/call-python-assets-credits";
import { getInternalUserIdByClerkUserId } from "@/db/queries/users";

const ScheduledJobSpecSchema = z
  .object({
    name: z.string().optional(),
    description: z.string().optional(),
    schedule: z.string().optional(),
    timezone: z.string().optional(),
    notifyOnComplete: z.boolean().optional(),
    notifyOnFailure: z.boolean().optional(),
  })
  .optional();

const ChatBodySchema = z
  .object({
    chat_id: z.string().optional(),
    chatId: z.string().optional(),
    message_id: z.string().optional(),
    content: z.array(z.any()).optional(),
    attachments: z.array(z.any()).optional(),
    selected_asset_mode: z.any().optional(),
    direct_gen_bm: z.boolean().optional(),
    messages: z.array(z.any()).optional(),
    agentJobRunId: z.string().uuid().optional(),
    // Resume flow — sent by frontend after tool-call-approval/rejection
    resumeData: z.record(z.string(), z.any()).optional(),
    runId: z.string().optional(),
    /** When true, orchestrator should delegate to Agents Job Manager for scheduled job setup */
    createScheduledJob: z.boolean().optional(),
    createJob: z.boolean().optional(),
    scheduledJob: z.boolean().optional(),
    scheduledJobSpec: ScheduledJobSpecSchema,
    /** Logical agent id (e.g. orchestrator). Omit → orchestrator. */
    agentId: z.string().optional(),
  })
  .passthrough();

export async function chatRoute(c: Context) {
  try {
    const mastra = c.get("mastra");
    const user = c.get("authUser");
    if (!user?.id) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    if (!user.accessToken) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    try {
      await assertHasEnoughCredits(user.accessToken);
    } catch (e: any) {
      const status = typeof e?.status === "number" ? e.status : 500;
      const message =
        status === 402 ? "Insufficient credits" : "Credits check failed";
      return c.json({ error: message }, status as any);
    }

    // --- Parse & validate request ---
    const parsedBody = ChatBodySchema.safeParse(await c.req.json());
    if (!parsedBody.success) {
      return c.json({ error: "Invalid request payload" }, 400);
    }
    const body = parsedBody.data;
    const {
      chat_id: rawChatId,
      chatId,
      message_id,
      content: rawContent,
      attachments: rawAttachments,
      selected_asset_mode,
      direct_gen_bm,
      messages: incomingMessages,
      agentJobRunId,
      resumeData,
      runId,
      createScheduledJob,
      createJob,
      scheduledJob,
      scheduledJobSpec,
      agentId: bodyAgentId,
    } = body;
    const chat_id = rawChatId ?? chatId;
    if (!chat_id) {
      return c.json({ error: "chat_id is required" }, 400);
    }

    const mastraAgentRegistryKey = mastraRegistryKeyForChatAgentId(bodyAgentId);
    if (mastraAgentRegistryKey === null) {
      return c.json({ error: "Invalid agentId" }, 400);
    }

    // --- Extract content & attachments ---
    const content = extractContent(rawContent, incomingMessages);

    const rawMessageAttachments = [
      ...(Array.isArray(incomingMessages)
        ? extractAttachmentsFromMessages(incomingMessages)
        : []),
      ...extractAttachmentsFromContentArray(rawContent),
    ];
    const attachmentFromSingular = (body as { attachment?: unknown }).attachment;
    const rawAttachmentsMerged = [
      ...(Array.isArray(rawAttachments) ? rawAttachments : []),
      ...(attachmentFromSingular &&
      attachmentFromSingular !== null &&
      typeof attachmentFromSingular === "object"
        ? [attachmentFromSingular as Record<string, unknown>]
        : []),
    ];
    const attachments = sanitizeAttachments(
      rawAttachmentsMerged,
      rawMessageAttachments,
    );

    // --- Enrich attachments with DB metadata + Gemini analysis ---
    const enrichedAttachments = await enrichAttachments(attachments, user.id);

    // --- Persist user message ---
    const userMessageId = message_id || crypto.randomUUID();
    await createMessage({
      messageId: userMessageId,
      chatId: chat_id,
      role: "user",
      agent: "none",
      content,
      attachments: enrichedAttachments || [],
    } as any);

    await db
      .update(chats)
      .set({ lastUpdated: new Date(), version: "v3" })
      .where(eq(chats.id, chat_id));
    if (agentJobRunId) {
      const run = await db.query.agentJobRuns.findFirst({
        where: eq(agentJobRuns.id, agentJobRunId as any),
        columns: { jobId: true },
      });
      if (run) {
        await db
          .insert(agentJobChats)
          .values({ chatId: chat_id, agentJobId: run.jobId, agentJobRunId })
          .onConflictDoNothing();
      }
    }
    await upsertExecutionForChat(chat_id);

    // --- Build context for agent ---
    const { userText, attachmentCatalog } = buildAttachmentContext(
      content,
      enrichedAttachments,
    );

    const responseMessageId = crypto.randomUUID();
    await createMessage({
      messageId: responseMessageId,
      chatId: chat_id,
      role: "ai",
      agent: "none",
      content: [],
    } as any);

    let aiMessageFinalized = false;
    const abortHandler = () => {
      if (aiMessageFinalized) return;
      void deleteMessageByMessageId(responseMessageId).catch((err) => {
        log.error({ err, responseMessageId }, "failed to delete aborted message");
      });
    };
    if (c.req.raw.signal.aborted) {
      abortHandler();
    } else {
      c.req.raw.signal.addEventListener("abort", abortHandler, { once: true });
    }

    /** Mastra `RequestContext` (Map-backed) so tools and delegation always read keys via `.get()` — matches framework expectations. */
    const requestContext = new RequestContext();
    requestContext.set("userId", user.id);
    requestContext.set("email", user.email ?? "");
    requestContext.set("workspaceId", user.orgId ?? user.id);
    requestContext.set("chatId", chat_id);
    requestContext.set("responseMessageId", responseMessageId);
    requestContext.set("directGenBm", direct_gen_bm === true);
    if (selected_asset_mode !== undefined) {
      requestContext.set("selectedAssetMode", selected_asset_mode);
    }
    requestContext.set("userAccessToken", user.accessToken);
    requestContext.set("attachments", enrichedAttachments || []);

    /** Template / space hidden block — same fields Python sets on `AgentState` (selected_template_prompt_id, etc.). */
    const hiddenPayloadText = collectUserTextForHiddenPayload(
      rawContent as any[] | undefined,
      incomingMessages as any[] | undefined,
    );
    const hiddenParsed = parseHiddenTemplatePayloadFromText(hiddenPayloadText);
    if (hiddenParsed.selected_template_prompt_id) {
      requestContext.set(
        "selectedTemplatePromptId",
        hiddenParsed.selected_template_prompt_id,
      );
    }
    if (hiddenParsed.template_id) {
      requestContext.set("templateIdFromPayload", hiddenParsed.template_id);
    }
    if (hiddenParsed.workflow_id) {
      requestContext.set("hiddenWorkflowId", hiddenParsed.workflow_id);
    }
    if (hiddenParsed.use_case_id) {
      requestContext.set("hiddenUseCaseId", hiddenParsed.use_case_id);
    }
    const productUrlForTemplate = deriveProductImageUrlFromTemplateAttachments(
      (enrichedAttachments || []) as Record<string, unknown>[],
    );
    if (productUrlForTemplate) {
      requestContext.set("productImageUrlFromTemplate", productUrlForTemplate);
    }

    requestContext.set("mastra__threadId", chat_id);
    requestContext.set("mastra__resourceId", user.orgId ?? user.id);

    // --- Build system messages ---
    const brandMemoryBlock = buildBrandMemoryBlock(direct_gen_bm === true);
    const systemMessages: { role: "system"; content: string }[] = [];
    systemMessages.push({ role: "system", content: `Current date and time: ${new Date().toISOString()}` });
    const wantsScheduledJobIntent =
      createScheduledJob === true || createJob === true || scheduledJob === true;
    if (wantsScheduledJobIntent) {
      systemMessages.push({
        role: "system",
        content: buildScheduledJobOrchestratorSystemBlock(scheduledJobSpec),
      });
    }
    if (brandMemoryBlock) systemMessages.push({ role: "system", content: brandMemoryBlock });
    if (attachmentCatalog) {
      systemMessages.push({
        role: "system",
        content: `ASSET CATALOG:\n${attachmentCatalog}`,
      });
    }

    // --- Connector integration ---
    const workspaceId = user.orgId ?? user.id;
    const connections = await getUserConnections(workspaceId);
    log.info({ workspaceId, connections: Object.keys(connections) }, "chat workspace context");
    // Orchestrator: routing only — no connector/dynamic tools via search_tools (specialists own those).
    const connectorProcessor =
      mastraAgentRegistryKey === "marketMintAgent"
        ? createOrchestratorInputProcessor()
        : getOrCreateConnectorProcessor(workspaceId, connections) ??
          createEmptyConnectorProcessor();
    requestContext.set(
      "__orchestratorConnectorToolsDisabled",
      mastraAgentRegistryKey === "marketMintAgent",
    );
    requestContext.set("__connections", connections);
    log.info(
      { workspaceId, mastraAgentRegistryKey, bodyAgentId },
      "connector processor active",
    );
    requestContext.set("__connectorProcessor", connectorProcessor);
    const connectorPromptBlock =
      mastraAgentRegistryKey === "marketMintAgent"
        ? buildOrchestratorConnectorContextPrompt(connections)
        : buildConnectorSystemPrompt(connections);
    if (connectorPromptBlock) {
      systemMessages.push({ role: "system", content: connectorPromptBlock });
    }

    // --- Prepare messages for agent ---
    const fallbackMessages =
      systemMessages.length > 0
        ? [...systemMessages, { role: "user" as const, content: userText }]
        : [{ role: "user" as const, content: userText }];
    const messagesForAgent =
      Array.isArray(incomingMessages) && incomingMessages.length > 0
        ? [
            ...systemMessages,
            ...normalizeIncomingMessagesForAgent(
              incomingMessages,
              enrichedAttachments || [],
            ),
          ]
        : (fallbackMessages as any);

    // --- Shared state between stream processor and onFinish ---
    const streamState: StreamState = { seq: 0 };

    // --- Start streaming ---
    const stream = await handleChatStream({
      mastra,
      agentId: mastraAgentRegistryKey,
      params: {
        inputProcessors: [connectorProcessor],
        messages: messagesForAgent,
        // Resume flow: if resumeData is provided, agent.resumeStream() is called
        // instead of agent.stream(). runId is required to resume the correct execution.
        ...(resumeData && runId ? { resumeData, runId } : {}),
        maxSteps: SUPERVISOR_MAX_STEPS,
        modelSettings: {
          temperature: 0.7,
          maxOutputTokens: 30000,
        },
        providerOptions: {
          anthropic: {
            thinking: { type: "enabled", budgetTokens: 4000 },
            sendReasoning: true,
          },
        },
        memory: {
          thread: { id: chat_id },
          resource: user.orgId ?? user.id,
        },
        requestContext,
        onFinish: async (finalResult: any) => {
          let finalText: string = await finalResult.text;
          // Strip trailing suggestions prose when a structured suggestions event
          // was already emitted — avoids duplicate rendering (UI buttons + markdown).
          if (streamState.hasSuggestions && finalText) {
            finalText = finalText.replace(
              /\n*(?:#{1,4}\s*)?(?:\*{0,2})(?:Quick actions|Suggested (?:follow-ups|next steps)|Here (?:are|is) (?:some|what) you can (?:do|try|take)|Follow-up|Next steps).*$/is,
              "",
            ).trimEnd();
          }
          // Mastra aggregates all model steps into totalUsage; usage is last step only.
          const llmUsageForMessage = finalResult.totalUsage ?? finalResult.usage;
          if (streamState.hasStreamedText) {
            // Text was already persisted per-part during streaming (text-end events).
            // Only save llmUsage — skip duplicate text to preserve per-step segmentation.
            await createOrUpdateMessage(responseMessageId, {
              chatId: chat_id,
              role: "ai",
              agent: "none",
              llmUsage: llmUsageForMessage,
            } as any);
          } else {
            // Fallback: no text-end events fired (e.g. single-step or aborted).
            // Persist the full concatenated text as before.
            await createOrUpdateMessage(responseMessageId, {
              chatId: chat_id,
              role: "ai",
              agent: "none",
              content: [{ id: crypto.randomUUID(), type: "text", text: finalText, seq: ++streamState.seq }],
              llmUsage: llmUsageForMessage,
            } as any);
          }
          const outputTok = aggregatedOutputTokensFromAgentFinish(finalResult);
          if (outputTok > 0) {
            const creditResult = await deductCreditsForConversation({
              userId: (await getInternalUserIdByClerkUserId(user.id)) ?? user.id,
              workspaceId,
              totalTokens: outputTok,
            });
            if (!creditResult.success) {
              log.warn(
                { chatId: chat_id, outputTok, message: creditResult.message },
                "conversation credits deduction did not succeed",
              );
            }
          }
          aiMessageFinalized = true;
        },
      },
      sendReasoning: true,
    });

    // --- Wrap stream with event persistence ---
    const wrappedStream = wrapStreamWithPersistence(
      stream as ReadableStream<any>,
      responseMessageId,
      chat_id,
      abortHandler,
      async (enqueue) => {
        // Generate and emit chat title as the last SSE event
        try {
          const chat = await db.query.chats.findFirst({
            where: eq(chats.id, chat_id as any),
            columns: { title: true },
          });
          const currentTitle = (chat?.title ?? "").trim().toLowerCase();
          if (!currentTitle || currentTitle === "new chat") {
            const generatedTitle = await generateChatTitle(userText);
            const finalTitle = generatedTitle || "New Chat";
            await db
              .update(chats)
              .set({ title: finalTitle, lastUpdated: new Date() })
              .where(eq(chats.id, chat_id as any));
            await upsertExecutionForChat(chat_id);
            // Emit as ACTION type — matches V2 StreamChunkType.ACTION handler
            // and V3 adapter mapping ("action" → MessageContentType.ACTION)
            enqueue({
              type: "data-action",
              data: {
                actionType: "UPDATE_CHAT_TITLE",
                title: finalTitle,
                chatId: chat_id,
              },
            });
          }
        } catch (titleErr) {
          log.warn({ err: titleErr, chatId: chat_id }, "title generation failed");
        }
      },
      streamState,
      workspaceId,
    );

    return new Response(wrappedStream as any, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Message-Id": responseMessageId,
      },
    });
  } catch (error: any) {
    const requestId = c.get("requestId");
    log.error({ err: error, requestId, path: c.req.path }, "chatRoute unhandled error");
    captureException(error, { requestId, path: c.req.path });
    return c.json({ error: "Chat request failed" }, 500);
  }
}
