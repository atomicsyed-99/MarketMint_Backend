import { and, eq } from "drizzle-orm";

import { agentJobChats } from "@/db/schema/agent-job-chats";
import { db } from "@/db/client";

export async function getAgentJobChats(agentJobId: string) {
  return await db.query.agentJobChats.findMany({
    where: eq(agentJobChats.agentJobId, agentJobId),
  });
}

export async function getAgentJobChatsByChatId(chatId: string) {
  return await db.query.agentJobChats.findMany({
    where: eq(agentJobChats.chatId, chatId),
  });
}

export async function createAgentJobChat(chatId: string, agentJobId: string, agentJobRunId: string) {
  return await db.insert(agentJobChats).values({ chatId, agentJobId, agentJobRunId }).returning();
}

export async function getAgentJobChatByJobIdAndRunId(agentJobId: string, agentJobRunId: string) {
  return await db.query.agentJobChats.findFirst({
    where: and(eq(agentJobChats.agentJobId, agentJobId), eq(agentJobChats.agentJobRunId, agentJobRunId)),
  });
}