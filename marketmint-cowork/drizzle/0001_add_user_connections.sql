CREATE TABLE "user_connections" (
	"workspace_id" text NOT NULL,
	"provider_config_key" text NOT NULL,
	"connection_id" text NOT NULL,
	"connected_by_user_id" text NOT NULL,
	"nango_raw" jsonb,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disconnected_at" timestamp with time zone,
	"disconnected_by_user_id" text,
	CONSTRAINT "user_connections_workspace_id_provider_config_key_pk" PRIMARY KEY("workspace_id","provider_config_key")
);
