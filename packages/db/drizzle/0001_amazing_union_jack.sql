CREATE TABLE "music_sessions" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"state" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "welcome_settings" ADD COLUMN "card" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "music_sessions" ADD CONSTRAINT "music_sessions_guild_id_guild_settings_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guild_settings"("guild_id") ON DELETE cascade ON UPDATE no action;