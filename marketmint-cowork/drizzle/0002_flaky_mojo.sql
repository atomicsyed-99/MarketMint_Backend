CREATE TYPE "public"."agent_job_run_status" AS ENUM('pending', 'running', 'completed', 'failed', 'skipped', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."agent_job_run_type" AS ENUM('scheduled', 'manual', 'retry');--> statement-breakpoint
CREATE TYPE "public"."insight_severity" AS ENUM('critical', 'warning', 'info');--> statement-breakpoint
CREATE TYPE "public"."insight_type" AS ENUM('finding', 'trend', 'correlation', 'anomaly');--> statement-breakpoint
CREATE TABLE "agent_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"trigger_schedule_id" text,
	"name" text NOT NULL,
	"description" text,
	"agent_ids" text[] DEFAULT '{}' NOT NULL,
	"prompt" text NOT NULL,
	"schedule" text NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"connector_requirements" text[] DEFAULT '{}',
	"notify_on_complete" boolean DEFAULT true NOT NULL,
	"notify_on_failure" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_job_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"workspace_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"run_type" "agent_job_run_type" NOT NULL,
	"status" "agent_job_run_status" NOT NULL,
	"prompt" text NOT NULL,
	"summary" text,
	"output" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"signals" text[] DEFAULT '{}',
	"token_usage" jsonb,
	"estimated_cost_usd" numeric(10, 6),
	"error" text,
	"duration_ms" integer,
	"trigger_run_id" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_job_insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"run_id" uuid,
	"insight_type" "insight_type" NOT NULL,
	"severity" "insight_severity" NOT NULL,
	"title" text NOT NULL,
	"detail" text NOT NULL,
	"metric" jsonb,
	"related_entity" jsonb,
	"agent_id" text,
	"dismissed" boolean DEFAULT false NOT NULL,
	"dismissed_by_user_id" text,
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_job_runs" ADD CONSTRAINT "agent_job_runs_job_id_agent_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."agent_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_job_insights" ADD CONSTRAINT "agent_job_insights_run_id_agent_job_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_job_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_agent_jobs_workspace" ON "agent_jobs" USING btree ("workspace_id","enabled");--> statement-breakpoint
CREATE INDEX "idx_agent_jobs_next_run" ON "agent_jobs" USING btree ("next_run_at") WHERE "agent_jobs"."enabled" = TRUE;--> statement-breakpoint
CREATE INDEX "idx_job_runs_job" ON "agent_job_runs" USING btree ("job_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_job_runs_workspace_status" ON "agent_job_runs" USING btree ("workspace_id","status","created_at");--> statement-breakpoint
CREATE INDEX "idx_job_runs_workspace_completed" ON "agent_job_runs" USING btree ("workspace_id","completed_at") WHERE "agent_job_runs"."status" = 'completed';--> statement-breakpoint
CREATE INDEX "idx_insights_workspace" ON "agent_job_insights" USING btree ("workspace_id","dismissed","created_at");--> statement-breakpoint
CREATE INDEX "idx_insights_severity" ON "agent_job_insights" USING btree ("workspace_id","severity","created_at");