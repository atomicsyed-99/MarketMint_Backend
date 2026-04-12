CREATE TABLE "shopify_apps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"provider_config_key" text NOT NULL,
	"app_name" text NOT NULL,
	"client_id_last4" text,
	"store_domain" text,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shopify_apps_provider_config_key_unique" UNIQUE("provider_config_key"),
	CONSTRAINT "shopify_apps_status_check" CHECK (status IN ('pending', 'active', 'failed', 'deleting'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "shopify_apps_workspace_active_idx" ON "shopify_apps" USING btree ("workspace_id") WHERE disabled_at IS NULL;