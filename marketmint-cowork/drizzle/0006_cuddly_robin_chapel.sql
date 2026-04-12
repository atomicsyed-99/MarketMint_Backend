CREATE TABLE "agent_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"key" text NOT NULL,
	"role" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"avatar_color" text NOT NULL,
	"avatar_src" text NOT NULL,
	"description" text,
	"connectors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"jobs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"soul_md" text,
	"how_to_use" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_agent_configs_workspace" ON "agent_configs" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_agent_configs_workspace_key" ON "agent_configs" USING btree ("workspace_id","key");