import { env } from "@/env";
import { Mastra } from "@mastra/core";
import { PostgresStore, ScoresPG } from "@mastra/pg";
import { registerApiRoute } from "@mastra/core/server";

import { Observability } from '@mastra/observability'
import { LangSmithExporter } from '@mastra/langsmith'

import { marketMintAgent } from "./agents/marketmint-agent";
import { shopifyStoreManagerAgent } from "./agents/shopify-store-manager/agent";
import { performanceMarketingAgent } from "./agents/performance-marketing/agent";
import { emailCrmManagerAgent } from "./agents/email-crm-manager/agent";
import { geoOptimizerAgent } from "./agents/geo-optimizer/agent";
import { finisherAgent } from "./agents/finisher-agent";
import { brandAnalyzerAgent } from "./agents/brand-analyzer-agent";
import { agentsJobManagerAgent } from "./agents/agents-job-manager-agent";
import { chatRoute } from "@/routes/chat";
import {
  connectSessionHandler,
  listConnectionsHandler,
  listSlackChannelsHandler,
  disconnectHandler,
  provisionShopifyAppHandler,
  deprovisionShopifyAppHandler,
  getShopifyAppHandler,
} from "@/routes/connectors";
import { clerkAuthMiddleware, clerkOptionalAuthMiddleware } from "@/middleware/clerk";
import { requestLogger } from "@/middleware/request-logger";
import { sentryMiddleware } from "@/middleware/sentry";
import { initSentry } from "@/lib/sentry";
import {
  createChat,
  adminViewChat,
  getShareStatus,
  updateShareStatus,
  listChats,
  getChat,
  updateChat,
  deleteChat,
} from "@/routes/chats";
import {
  createMessageHandler,
  getMessages,
  getMessagesLegacy,
  deleteMessage,
  batchCompleted,
  batchRefineCompleted,
  singleHumanRefineCompleted,
} from "@/routes/messages";
import { getSharedChat } from "@/routes/shared-chats";
import { agentRunRoute } from "@/routes/agents";
import {
  listAgentConfigsHandler,
  updateAgentConfigHandler,
  getAgentConfigByKeyHandler,
} from "@/routes/agent-configs";
import {
  createJobHandler,
  listJobsHandler,
  getJobHandler,
  updateJobHandler,
  deleteJobHandler,
  createJobByAIHandler,
} from "@/routes/agent-jobs";
import {
  createRunHandler,
  listRunsByJobHandler,
  listRunsHandler,
  getRunDetailsHandler,
  tryInCoworkHandler,
} from "@/routes/agent-job-runs";
import {
  listInsightsHandler,
  dismissInsightHandler,
  getRunInsightsHandler,
} from "@/routes/agent-job-insights";
import {
  executeAgentJobRunHandler,
} from "@/routes/internal/agent-job-runs";
import { reconcileShopifyAppsHandler } from "@/routes/internal/reconcile-shopify-apps";
import { apiKeyAuthMiddleware } from "@/middleware/api-key";
import { MastraCompositeStore } from "@mastra/core/storage";
import { metricSpecificityScorer } from "./evals/don/metric-specificity";
import { actionabilityScorer } from "./evals/don/actionability";
import { scopeAdherenceScorer } from "./evals/don/scope-adherence";
import { donTrajectoryScorer } from "./evals/don/trajectory-accuracy";
import {
  emailMetricSpecificityScorer,
  elaraScopeAdherenceScorer,
  elaraTrajectoryScorer,
} from "./evals/elara";
import {
  geoPrecisionScorer,
  sageScopeAdherenceScorer,
  sageTrajectoryScorer,
} from "./evals/sage";
import {
  storeMetricSpecificityScorer,
  samScopeAdherenceScorer,
  samTrajectoryScorer,
} from "./evals/sam";
import { truncateAgentConfigsHandler } from "@/routes/internal/agent-configs";

initSentry();

const defaultStorage = new PostgresStore({
  id: "marketmint-mastra-storage",
  connectionString: env.MASTRA_DATABASE_URL,
});

const scorersStorage = new ScoresPG({
  connectionString: env.MASTRA_DATABASE_URL,
  schemaName: "mastra_scorers",
});

export const mastra = new Mastra({
  agents: {
    marketMintAgent,
    shopifyStoreManagerAgent,
    performanceMarketingAgent,
    emailCrmManagerAgent,
    geoOptimizerAgent,
    finisherAgent,
    brandAnalyzerAgent,
    agentsJobManagerAgent,
  },
  observability: new Observability({
    configs: {
      langsmith: {
        serviceName: 'marketmint-cowork',
        exporters: [
          new LangSmithExporter({
            apiKey: process.env.LANGSMITH_API_KEY,
          }),
        ],
      },
    },
  }),
  storage: new MastraCompositeStore({
    id: "marketmint-mastra-storage",
    default: defaultStorage,
    domains: {
      scores: scorersStorage,
    },
  }),
  scorers: {
    donMetricSpecificity: metricSpecificityScorer,
    donActionability: actionabilityScorer,
    donScopeAdherence: scopeAdherenceScorer,
    donTrajectory: donTrajectoryScorer,
    elaraEmailMetricSpecificity: emailMetricSpecificityScorer,
    elaraScopeAdherence: elaraScopeAdherenceScorer,
    elaraTrajectory: elaraTrajectoryScorer,
    sageGeoPrecision: geoPrecisionScorer,
    sageScopeAdherence: sageScopeAdherenceScorer,
    sageTrajectory: sageTrajectoryScorer,
    samStoreMetricSpecificity: storeMetricSpecificityScorer,
    samScopeAdherence: samScopeAdherenceScorer,
    samTrajectory: samTrajectoryScorer,
  },
  server: {
    studioBase: '/studio',
    host: '0.0.0.0',
    apiRoutes: [
      registerApiRoute("/cowork/v3/chat", {
        method: "POST",
        requiresAuth: false,
        middleware: [sentryMiddleware, requestLogger, clerkAuthMiddleware],
        handler: chatRoute,
      }),
      registerApiRoute("/cowork/connectors/connect-session", {
        method: "POST",
        requiresAuth: false,
        middleware: [sentryMiddleware, requestLogger, clerkAuthMiddleware],
        handler: connectSessionHandler,
      }),
      registerApiRoute("/cowork/connectors/connections", {
        method: "GET",
        requiresAuth: false,
        middleware: [sentryMiddleware, requestLogger, clerkAuthMiddleware],
        handler: listConnectionsHandler,
      }),
      registerApiRoute("/cowork/connectors/disconnect", {
        method: "DELETE",
        requiresAuth: false,
        middleware: [sentryMiddleware, requestLogger, clerkAuthMiddleware],
        handler: disconnectHandler,
      }),
      registerApiRoute("/cowork/connectors/slack/channels", {
        method: "GET",
        requiresAuth: false,
        middleware: [sentryMiddleware, requestLogger, clerkAuthMiddleware],
        handler: listSlackChannelsHandler,
      }),
      registerApiRoute("/cowork/connectors/shopify-app", {
        method: "POST",
        requiresAuth: false,
        middleware: [sentryMiddleware, requestLogger, clerkAuthMiddleware],
        handler: provisionShopifyAppHandler,
      }),
      registerApiRoute("/cowork/connectors/shopify-app", {
        method: "DELETE",
        requiresAuth: false,
        middleware: [sentryMiddleware, requestLogger, clerkAuthMiddleware],
        handler: deprovisionShopifyAppHandler,
      }),
      registerApiRoute("/cowork/connectors/shopify-app", {
        method: "GET",
        requiresAuth: false,
        middleware: [sentryMiddleware, requestLogger, clerkAuthMiddleware],
        handler: getShopifyAppHandler,
      }),
      registerApiRoute("/cowork/chats", {
        method: "POST",
        requiresAuth: false,
        middleware: [sentryMiddleware, requestLogger, clerkAuthMiddleware],
        handler: createChat,
      }),

      registerApiRoute("/cowork/chats/admin/view-chats/:chat_id", {
        method: "GET",
        requiresAuth: false,
        middleware: [sentryMiddleware, requestLogger, clerkAuthMiddleware],
        handler: adminViewChat,
      }),
      registerApiRoute("/cowork/chats/share/:chat_id", {
        method: "GET",
        requiresAuth: false,
        middleware: [sentryMiddleware, requestLogger, clerkAuthMiddleware],
        handler: getShareStatus,
      }),
      registerApiRoute("/cowork/chats/share/:chat_id", {
        method: "PUT",
        requiresAuth: false,
        middleware: [sentryMiddleware, requestLogger, clerkAuthMiddleware],
        handler: updateShareStatus,
      }),
      registerApiRoute("/cowork/chats/:current_page/:limit", {
        method: "GET",
        requiresAuth: false,
        middleware: [sentryMiddleware, requestLogger, clerkAuthMiddleware],
        handler: listChats,
      }),
      registerApiRoute("/cowork/chats/:id", {
        method: "GET",
        requiresAuth: false,
        middleware: [sentryMiddleware, requestLogger, clerkAuthMiddleware],
        handler: getChat,
      }),
      registerApiRoute("/cowork/chats/:id", {
        method: "PATCH",
        requiresAuth: false,
        middleware: [sentryMiddleware, requestLogger, clerkAuthMiddleware],
        handler: updateChat,
      }),
      registerApiRoute("/cowork/chats/:id", {
        method: "DELETE",
        requiresAuth: false,
        middleware: [sentryMiddleware, requestLogger, clerkAuthMiddleware],
        handler: deleteChat,
      }),

      // Messages routes
      registerApiRoute("/cowork/messages", {
        method: "POST",
        requiresAuth: false,
        middleware: [sentryMiddleware, requestLogger, clerkAuthMiddleware],
        handler: createMessageHandler,
      }),
      registerApiRoute("/cowork/messages/hooks/batch-completed", {
        method: "PATCH",
        requiresAuth: false,
        middleware: [sentryMiddleware, requestLogger, clerkAuthMiddleware],
        handler: batchCompleted,
      }),
      registerApiRoute("/cowork/messages/hooks/batch-refine-completed", {
        method: "PATCH",
        requiresAuth: false,
        middleware: [sentryMiddleware, requestLogger, clerkAuthMiddleware],
        handler: batchRefineCompleted,
      }),
      registerApiRoute("/cowork/messages/hooks/single-human-refine-completed", {
        method: "PATCH",
        requiresAuth: false,
        middleware: [sentryMiddleware, requestLogger, clerkAuthMiddleware],
        handler: singleHumanRefineCompleted,
      }),
      registerApiRoute("/cowork/messages/:chat_id", {
        method: "GET",
        requiresAuth: false,
        middleware: [sentryMiddleware, requestLogger, clerkAuthMiddleware],
        handler: getMessages,
      }),
      registerApiRoute("/cowork/messages/:chat_id/legacy", {
        method: "GET",
        requiresAuth: false,
        middleware: [sentryMiddleware, requestLogger, clerkAuthMiddleware],
        handler: getMessagesLegacy,
      }),
      registerApiRoute("/cowork/messages/:message_id", {
        method: "DELETE",
        requiresAuth: false,
        middleware: [sentryMiddleware, requestLogger, clerkAuthMiddleware],
        handler: deleteMessage,
      }),

      // Shared chats routes
      registerApiRoute("/cowork/shared-chats/:id", {
        method: "GET",
        requiresAuth: false,
        middleware: [sentryMiddleware, requestLogger, clerkOptionalAuthMiddleware],
        handler: getSharedChat,
      }),

      // Agent routes
      registerApiRoute("/cowork/agents/:agentId/run", {
        method: "POST",
        requiresAuth: false,
        middleware: [clerkAuthMiddleware],
        handler: agentRunRoute,
      }),

      // Agent config routes
      registerApiRoute("/cowork/agent-configs", {
        method: "GET",
        requiresAuth: false,
        middleware: [sentryMiddleware, requestLogger, clerkAuthMiddleware],
        handler: listAgentConfigsHandler,
      }),
      registerApiRoute("/cowork/agent-configs/key/:key", {
        method: "GET",
        requiresAuth: false,
        middleware: [sentryMiddleware, requestLogger, clerkAuthMiddleware],
        handler: getAgentConfigByKeyHandler,
      }),
      registerApiRoute("/cowork/agent-configs/:configId", {
        method: "PATCH",
        requiresAuth: false,
        middleware: [sentryMiddleware, requestLogger, clerkAuthMiddleware],
        handler: updateAgentConfigHandler,
      }),

      // Agent jobs routes
      registerApiRoute("/cowork/agent-jobs/ai", {
        method: "POST",
        requiresAuth: false,
        middleware: [sentryMiddleware, requestLogger, clerkAuthMiddleware],
        handler: createJobByAIHandler,
      }),
      registerApiRoute("/cowork/agent-jobs", {
        method: "POST",
        requiresAuth: false,
        middleware: [sentryMiddleware, requestLogger, clerkAuthMiddleware],
        handler: createJobHandler,
      }),
      registerApiRoute("/cowork/agent-jobs", {
        method: "GET",
        requiresAuth: false,
        middleware: [sentryMiddleware, requestLogger, clerkAuthMiddleware],
        handler: listJobsHandler,
      }),
      registerApiRoute("/cowork/agent-jobs/:jobId", {
        method: "GET",
        requiresAuth: false,
        middleware: [sentryMiddleware, requestLogger, clerkAuthMiddleware],
        handler: getJobHandler,
      }),
      registerApiRoute("/cowork/agent-jobs/:jobId", {
        method: "PATCH",
        requiresAuth: false,
        middleware: [sentryMiddleware, requestLogger, clerkAuthMiddleware],
        handler: updateJobHandler,
      }),
      registerApiRoute("/cowork/agent-jobs/:jobId", {
        method: "DELETE",
        requiresAuth: false,
        middleware: [sentryMiddleware, requestLogger, clerkAuthMiddleware],
        handler: deleteJobHandler,
      }),

      // Agent job runs routes
      registerApiRoute("/cowork/agent-jobs/:jobId/runs", {
        method: "POST",
        requiresAuth: false,
        middleware: [sentryMiddleware, requestLogger, clerkAuthMiddleware],
        handler: createRunHandler,
      }),
      registerApiRoute("/cowork/agent-jobs/:jobId/runs", {
        method: "GET",
        requiresAuth: false,
        middleware: [sentryMiddleware, requestLogger, clerkAuthMiddleware],
        handler: listRunsByJobHandler,
      }),
      registerApiRoute("/cowork/agent-job-runs", {
        method: "GET",
        requiresAuth: false,
        middleware: [sentryMiddleware, requestLogger, clerkAuthMiddleware],
        handler: listRunsHandler,
      }),
      registerApiRoute("/cowork/agent-job-runs/details/:runId", {
        method: "GET",
        requiresAuth: false,
        middleware: [sentryMiddleware, requestLogger, clerkAuthMiddleware],
        handler: getRunDetailsHandler
      }),
      registerApiRoute("/cowork/agent-job-runs/:runId/try-in-cowork", {
        method: "POST",
        requiresAuth: false,
        middleware: [sentryMiddleware, requestLogger, clerkAuthMiddleware],
        handler: tryInCoworkHandler,
      }),

      // Agent job insights routes
      registerApiRoute("/cowork/agent-job-insights", {
        method: "GET",
        requiresAuth: false,
        middleware: [sentryMiddleware, requestLogger, clerkAuthMiddleware],
        handler: listInsightsHandler,
      }),
      registerApiRoute("/cowork/agent-job-insights/:insightId/dismiss", {
        method: "POST",
        requiresAuth: false,
        middleware: [sentryMiddleware, requestLogger, clerkAuthMiddleware],
        handler: dismissInsightHandler,
      }),
      registerApiRoute("/cowork/agent-job-runs/:runId/insights", {
        method: "GET",
        requiresAuth: false,
        middleware: [sentryMiddleware, requestLogger, clerkAuthMiddleware],
        handler: getRunInsightsHandler,
      }),
      registerApiRoute("/cowork/internal/agent-job-runs/execute", {
        method: "POST",
        requiresAuth: false,
        middleware: [sentryMiddleware, requestLogger, apiKeyAuthMiddleware],
        handler: executeAgentJobRunHandler,
      }),
      registerApiRoute("/cowork/internal/agent-configs/truncate", {
        method: "POST",
        requiresAuth: false,
        middleware: [sentryMiddleware, requestLogger, apiKeyAuthMiddleware],
        handler: truncateAgentConfigsHandler,
      }),
      registerApiRoute("/cowork/internal/reconcile-shopify-apps", {
        method: "POST",
        requiresAuth: false,
        middleware: [sentryMiddleware, requestLogger, apiKeyAuthMiddleware],
        handler: reconcileShopifyAppsHandler,
      }),
    ],
    cors: {
      origin: (origin) => {
        const allowed = env.ALLOWED_ORIGINS?.trim();
        if (!allowed || allowed === "*") return origin || "*";
        const origins = allowed.split(",").map((o) => o.trim());
        return origin && origins.includes(origin) ? origin : origins[0];
      },
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: [
        "Content-Type",
        "Authorization",
        "Cache-Control",
        "Expires",
        "Pragma",
        "x-mastra-client-type",
        "x-workspace-id"
      ],
      exposeHeaders: ["Content-Length", "X-Requested-With"],
      credentials: true,
    },
  },
});
