CREATE TABLE "agent_job_chats" (
	"chat_id" uuid NOT NULL,
	"agent_job_id" uuid NOT NULL,
	"agent_job_run_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_job_chats_chat_id_agent_job_id_agent_job_run_id_pk" PRIMARY KEY("chat_id","agent_job_id","agent_job_run_id")
);
--> statement-breakpoint
ALTER TABLE "agent_job_chats" ADD CONSTRAINT "agent_job_chats_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_job_chats" ADD CONSTRAINT "agent_job_chats_agent_job_id_agent_jobs_id_fk" FOREIGN KEY ("agent_job_id") REFERENCES "public"."agent_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_job_chats" ADD CONSTRAINT "agent_job_chats_agent_job_run_id_agent_job_runs_id_fk" FOREIGN KEY ("agent_job_run_id") REFERENCES "public"."agent_job_runs"("id") ON DELETE cascade ON UPDATE no action;