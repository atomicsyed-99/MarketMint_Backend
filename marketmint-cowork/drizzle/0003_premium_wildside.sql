ALTER TABLE "agent_job_runs" RENAME COLUMN "agent_id" TO "agent_ids";--> statement-breakpoint
ALTER TABLE "agent_job_runs" ADD COLUMN "scheduled_at" timestamp with time zone;