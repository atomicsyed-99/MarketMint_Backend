TRUNCATE TABLE "agent_configs" CASCADE;
CREATE TYPE "public"."geo_prompt_source" AS ENUM('auto', 'manual');--> statement-breakpoint
CREATE TABLE "geo_prompts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"prompt_text" text NOT NULL,
	"category" text,
	"source" "geo_prompt_source" DEFAULT 'auto' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "geo_audit_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"prompt_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"is_cited" boolean DEFAULT false NOT NULL,
	"citation_rank" integer,
	"citation_url" text,
	"response_snippet" text,
	"citation_sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sentiment" text,
	"competing_brands" text[] DEFAULT '{}' NOT NULL,
	"raw_response" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"audited_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "geo_content" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"prompt_id" uuid NOT NULL,
	"content_markdown" text NOT NULL,
	"content_pdf_url" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "geo_audit_results" ADD CONSTRAINT "geo_audit_results_prompt_id_geo_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."geo_prompts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geo_content" ADD CONSTRAINT "geo_content_prompt_id_geo_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."geo_prompts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_geo_prompts_workspace_active" ON "geo_prompts" USING btree ("workspace_id","is_active","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ux_geo_prompts_workspace_prompt" ON "geo_prompts" USING btree ("workspace_id","prompt_text");--> statement-breakpoint
CREATE INDEX "idx_geo_audit_workspace_time" ON "geo_audit_results" USING btree ("workspace_id","audited_at");--> statement-breakpoint
CREATE INDEX "idx_geo_audit_prompt_provider_time" ON "geo_audit_results" USING btree ("prompt_id","provider","audited_at");--> statement-breakpoint
CREATE INDEX "idx_geo_content_workspace_created" ON "geo_content" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_geo_content_prompt_created" ON "geo_content" USING btree ("prompt_id","created_at");