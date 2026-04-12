import { Memory } from "@mastra/memory";
import { PostgresStore } from "@mastra/pg";
import { env } from "@/env";

import { orchestratorWorkingMemorySchema } from "./schemas/orchestrator";
import { storeManagerWorkingMemorySchema } from "./schemas/store-manager";
import { perfMarketingWorkingMemorySchema } from "./schemas/performance-marketing";
import { emailCrmWorkingMemorySchema } from "./schemas/email-crm";
import { geoOptimizerWorkingMemorySchema } from "./schemas/geo-optimizer";

const sharedStorage = new PostgresStore({
  id: "marketmint-memory",
  connectionString: env.DATABASE_URL,
});

export const orchestratorMemory = new Memory({
  storage: sharedStorage,
  options: {
    lastMessages: 20,
    semanticRecall: false,
    observationalMemory: {
      model: "google/gemini-2.5-flash",
      scope: "thread",
    },
    workingMemory: {
      enabled: true,
      scope: "thread",
      schema: orchestratorWorkingMemorySchema,
    },
  },
});

export const storeManagerMemory = new Memory({
  storage: sharedStorage,
  options: {
    lastMessages: 10,
    semanticRecall: false,
    workingMemory: {
      enabled: true,
      scope: "thread",
      schema: storeManagerWorkingMemorySchema,
    },
  },
});

export const perfMarketingMemory = new Memory({
  storage: sharedStorage,
  options: {
    lastMessages: 10,
    semanticRecall: false,
    workingMemory: {
      enabled: true,
      scope: "thread",
      schema: perfMarketingWorkingMemorySchema,
    },
  },
});

export const emailCrmMemory = new Memory({
  storage: sharedStorage,
  options: {
    lastMessages: 10,
    semanticRecall: false,
    workingMemory: {
      enabled: true,
      scope: "thread",
      schema: emailCrmWorkingMemorySchema,
    },
  },
});

/**
 * Job manager: stateless-ish API agent. No observational memory — it is also invoked via
 * `generate()` without a chat thread; delegating from the main agent used to inject orchestrator Memory
 * (thread-scoped observational) onto the shared agent instance and break `/agent-jobs/ai`.
 */
export const agentsJobManagerMemory = new Memory({
  storage: sharedStorage,
  options: {
    lastMessages: 5,
    semanticRecall: false,
  },
});

export const geoOptimizerMemory = new Memory({
  storage: sharedStorage,
  options: {
    lastMessages: 10,
    semanticRecall: false,
    observationalMemory: {
      model: "google/gemini-2.5-flash",
      scope: "thread",
    },
    workingMemory: {
      enabled: true,
      scope: "resource",
      schema: geoOptimizerWorkingMemorySchema,
    },
  },
});
