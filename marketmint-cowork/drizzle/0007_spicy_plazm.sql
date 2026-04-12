CREATE TYPE "public"."agent_job_notification_channel" AS ENUM('email', 'slack', 'sms');--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD COLUMN "notification_channels" "agent_job_notification_channel"[] DEFAULT '{"email"}';--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb;