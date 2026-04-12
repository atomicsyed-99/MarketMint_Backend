-- Step 1: Add columns as nullable
ALTER TABLE "agent_job_runs" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "agent_job_runs" ADD COLUMN "description" text;--> statement-breakpoint

-- Step 2: Backfill from parent agent_jobs
UPDATE "agent_job_runs" r
SET
  "name" = j."name",
  "description" = j."description"
FROM "agent_jobs" j
WHERE r."job_id" = j."id";--> statement-breakpoint

-- Step 3: Set NOT NULL now that all rows have a value
ALTER TABLE "agent_job_runs" ALTER COLUMN "name" SET NOT NULL;

