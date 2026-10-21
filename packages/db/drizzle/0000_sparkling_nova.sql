CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"actor_id" text,
	"actor_type" text NOT NULL,
	"source" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"before" jsonb,
	"after" jsonb,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "autorole_settings" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"role_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"include_bots" boolean DEFAULT false NOT NULL,
	"min_account_age_days" integer DEFAULT 0 NOT NULL,
	"delay_ms" integer DEFAULT 500 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "guild_settings" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"prefix" varchar(5) DEFAULT '!' NOT NULL,
	"locale" varchar(10) DEFAULT 'en' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "interaction_counters" (
	"guild_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"target_id" text NOT NULL,
	"kind" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interaction_counters_guild_id_actor_id_target_id_kind_pk" PRIMARY KEY("guild_id","actor_id","target_id","kind")
);
--> statement-breakpoint
CREATE TABLE "interaction_optouts" (
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text DEFAULT '*' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interaction_optouts_guild_id_user_id_kind_pk" PRIMARY KEY("guild_id","user_id","kind")
);
--> statement-breakpoint
CREATE TABLE "music_settings" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"dj_role_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"default_volume" integer DEFAULT 80 NOT NULL,
	"max_queue_size" integer DEFAULT 100 NOT NULL,
	"music_channel_id" text,
	"alone_timeout_seconds" integer DEFAULT 120 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "temp_voice_channels" (
	"channel_id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"hub_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"locked" boolean DEFAULT true NOT NULL,
	"user_limit" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"last_empty_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tempvc_settings" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"hub_channel_id" text,
	"category_id" text,
	"name_template" text DEFAULT '{user}''s VC' NOT NULL,
	"default_user_limit" integer DEFAULT 0 NOT NULL,
	"default_locked" boolean DEFAULT true NOT NULL,
	"auto_delete" boolean DEFAULT true NOT NULL,
	"grace_seconds" integer DEFAULT 30 NOT NULL,
	"max_channels" integer DEFAULT 50 NOT NULL,
	"max_per_user" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "welcome_settings" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"channel_id" text,
	"message" text DEFAULT 'Welcome {mention} to **{server}**!' NOT NULL,
	"embed" boolean DEFAULT true NOT NULL,
	"ping_user" boolean DEFAULT false NOT NULL,
	"dm_enabled" boolean DEFAULT false NOT NULL,
	"dm_message" text,
	"goodbye_enabled" boolean DEFAULT false NOT NULL,
	"goodbye_channel_id" text,
	"goodbye_message" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
ALTER TABLE "autorole_settings" ADD CONSTRAINT "autorole_settings_guild_id_guild_settings_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guild_settings"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "music_settings" ADD CONSTRAINT "music_settings_guild_id_guild_settings_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guild_settings"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tempvc_settings" ADD CONSTRAINT "tempvc_settings_guild_id_guild_settings_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guild_settings"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "welcome_settings" ADD CONSTRAINT "welcome_settings_guild_id_guild_settings_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guild_settings"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_guild_created_idx" ON "audit_log" USING btree ("guild_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_action_created_idx" ON "audit_log" USING btree ("action","created_at");--> statement-breakpoint
CREATE INDEX "counters_guild_kind_count_idx" ON "interaction_counters" USING btree ("guild_id","kind","count");--> statement-breakpoint
CREATE INDEX "counters_guild_target_kind_idx" ON "interaction_counters" USING btree ("guild_id","target_id","kind");--> statement-breakpoint
CREATE INDEX "counters_guild_actor_kind_idx" ON "interaction_counters" USING btree ("guild_id","actor_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "tempvc_active_owner_uq" ON "temp_voice_channels" USING btree ("guild_id","owner_id") WHERE "temp_voice_channels"."status" = 'active';--> statement-breakpoint
CREATE INDEX "tempvc_guild_status_idx" ON "temp_voice_channels" USING btree ("guild_id","status");