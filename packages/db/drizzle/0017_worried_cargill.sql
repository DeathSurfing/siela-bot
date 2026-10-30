CREATE TABLE "scheduled_voice_event_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"event_id" bigint NOT NULL,
	"guild_id" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" varchar(16) NOT NULL,
	"triggered_by" text NOT NULL,
	"error" text,
	CONSTRAINT "scheduled_voice_event_runs_status_ck" CHECK ("scheduled_voice_event_runs"."status" IN ('running', 'success', 'failed', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE "scheduled_voice_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"name" varchar(80) NOT NULL,
	"channel_id" text NOT NULL,
	"source_url" text NOT NULL,
	"repeat" varchar(10) DEFAULT 'none' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"next_run_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"last_status" varchar(16),
	"last_error" text,
	"run_count" integer DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scheduled_voice_events_repeat_ck" CHECK ("scheduled_voice_events"."repeat" IN ('none', 'daily', 'weekly')),
	CONSTRAINT "scheduled_voice_events_last_status_ck" CHECK ("scheduled_voice_events"."last_status" IS NULL OR "scheduled_voice_events"."last_status" IN ('running', 'success', 'failed', 'skipped'))
);
--> statement-breakpoint
ALTER TABLE "scheduled_voice_event_runs" ADD CONSTRAINT "scheduled_voice_event_runs_event_id_scheduled_voice_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."scheduled_voice_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_voice_event_runs" ADD CONSTRAINT "scheduled_voice_event_runs_guild_id_guild_settings_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guild_settings"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_voice_events" ADD CONSTRAINT "scheduled_voice_events_guild_id_guild_settings_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guild_settings"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scheduled_voice_event_runs_event_started_idx" ON "scheduled_voice_event_runs" USING btree ("event_id","started_at");--> statement-breakpoint
CREATE INDEX "scheduled_voice_events_guild_next_run_idx" ON "scheduled_voice_events" USING btree ("guild_id","next_run_at");