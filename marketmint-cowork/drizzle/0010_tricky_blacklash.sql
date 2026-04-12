TRUNCATE TABLE "agent_configs" CASCADE;
ALTER TABLE "agent_configs" ADD CONSTRAINT "agent_configs_key_unique" UNIQUE("key");