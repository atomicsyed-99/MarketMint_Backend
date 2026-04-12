DO $$ BEGIN CREATE TYPE "public"."messageagent" AS ENUM('none', 'photographer', 'developer', 'planner', 'finisher'); EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN CREATE TYPE "public"."messagerole" AS ENUM('user', 'ai', 'tool'); EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_id" text,
	"title" text,
	"version" text,
	"deleted_at" timestamp,
	"created_at" timestamp NOT NULL,
	"last_updated" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"message_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" uuid NOT NULL,
	"role" "messagerole" NOT NULL,
	"agent" "messageagent" DEFAULT 'none',
	"content" jsonb DEFAULT '[]'::jsonb,
	"attachments" jsonb DEFAULT '[]'::jsonb,
	"tool_calls" jsonb DEFAULT '[]'::jsonb,
	"llm_usage" jsonb,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "messages_message_id_unique" UNIQUE("message_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_attachments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"url" text NOT NULL,
	"key" text NOT NULL,
	"tag" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "messages" ADD CONSTRAINT "messages_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "shared_chats" (
	"id" text PRIMARY KEY NOT NULL,
	"chat_id" uuid NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "shared_chats" ADD CONSTRAINT "shared_chats_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TYPE public.messagerole ADD VALUE IF NOT EXISTS 'user';
ALTER TYPE public.messagerole ADD VALUE IF NOT EXISTS 'ai';
ALTER TYPE public.messagerole ADD VALUE IF NOT EXISTS 'tool';

ALTER TYPE public.messageagent ADD VALUE IF NOT EXISTS 'none';
ALTER TYPE public.messageagent ADD VALUE IF NOT EXISTS 'photographer';
ALTER TYPE public.messageagent ADD VALUE IF NOT EXISTS 'developer';
ALTER TYPE public.messageagent ADD VALUE IF NOT EXISTS 'planner';
ALTER TYPE public.messageagent ADD VALUE IF NOT EXISTS 'finisher';

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE IF EXISTS public.messages
  ALTER COLUMN content DROP DEFAULT;
ALTER TABLE IF EXISTS public.messages
  ALTER COLUMN attachments DROP DEFAULT;
ALTER TABLE IF EXISTS public.messages
  ALTER COLUMN tool_calls DROP DEFAULT;

ALTER TABLE IF EXISTS public.messages
  ALTER COLUMN content TYPE jsonb USING to_jsonb(content);
ALTER TABLE IF EXISTS public.messages
  ALTER COLUMN attachments TYPE jsonb USING to_jsonb(attachments);
ALTER TABLE IF EXISTS public.messages
  ALTER COLUMN tool_calls TYPE jsonb USING to_jsonb(tool_calls);

ALTER TABLE IF EXISTS public.messages
  ALTER COLUMN content SET DEFAULT '[]'::jsonb;
ALTER TABLE IF EXISTS public.messages
  ALTER COLUMN attachments SET DEFAULT '[]'::jsonb;
ALTER TABLE IF EXISTS public.messages
  ALTER COLUMN tool_calls SET DEFAULT '[]'::jsonb;
ALTER TABLE IF EXISTS public.messages
  ALTER COLUMN files SET DEFAULT '{}'::text[];
ALTER TABLE IF EXISTS public.messages
  ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE IF EXISTS public.messages
  ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE IF EXISTS public.messages
  ALTER COLUMN message_id SET DEFAULT gen_random_uuid();

ALTER TABLE IF EXISTS public.chats
  ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE IF EXISTS public.chats
  ALTER COLUMN last_updated SET DEFAULT now();

ALTER TABLE IF EXISTS public.messages
  ALTER COLUMN message_id SET NOT NULL;
ALTER TABLE IF EXISTS public.messages
  ALTER COLUMN llm_usage DROP NOT NULL;
ALTER TABLE IF EXISTS public.messages
  ALTER COLUMN files DROP NOT NULL;

ALTER TABLE IF EXISTS public.chats
  ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE IF EXISTS public.chats
  ALTER COLUMN last_updated SET NOT NULL;