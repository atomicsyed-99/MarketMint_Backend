TRUNCATE TABLE "agent_configs" CASCADE;
ALTER TABLE "agent_configs" ADD COLUMN "available" boolean DEFAULT true NOT NULL;