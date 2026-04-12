import { relations } from "drizzle-orm";
import { agentJobs } from "./agent-jobs";
import { agentJobRuns } from "./agent-job-runs";
import { agentJobInsights } from "./agent-job-insights";
import { agentJobChats } from "./agent-job-chats";
import { chats } from "./chats";
import { geoPrompts } from "./geo-prompts";
import { geoAuditResults } from "./geo-audit-results";
import { geoContent } from "./geo-content";

export const agentJobsRelations = relations(agentJobs, ({ many }) => ({
  runs: many(agentJobRuns),
  chats: many(agentJobChats),
}));

export const agentJobRunsRelations = relations(agentJobRuns, ({ one, many }) => ({
  job: one(agentJobs, {
    fields: [agentJobRuns.jobId],
    references: [agentJobs.id],
  }),
  insights: many(agentJobInsights),
  chats: many(agentJobChats),
}));

export const agentJobInsightsRelations = relations(agentJobInsights, ({ one }) => ({
  run: one(agentJobRuns, {
    fields: [agentJobInsights.runId],
    references: [agentJobRuns.id],
  }),
}));

export const agentJobChatsRelations = relations(agentJobChats, ({ one }) => ({
  chat: one(chats, {
    fields: [agentJobChats.chatId],
    references: [chats.id],
  }),
  job: one(agentJobs, {
    fields: [agentJobChats.agentJobId],
    references: [agentJobs.id],
  }),
  run: one(agentJobRuns, {
    fields: [agentJobChats.agentJobRunId],
    references: [agentJobRuns.id],
  }),
}));

export const geoPromptsRelations = relations(geoPrompts, ({ many }) => ({
  auditResults: many(geoAuditResults),
  contents: many(geoContent),
}));

export const geoAuditResultsRelations = relations(geoAuditResults, ({ one }) => ({
  prompt: one(geoPrompts, {
    fields: [geoAuditResults.promptId],
    references: [geoPrompts.id],
  }),
}));

export const geoContentRelations = relations(geoContent, ({ one }) => ({
  prompt: one(geoPrompts, {
    fields: [geoContent.promptId],
    references: [geoPrompts.id],
  }),
}));
