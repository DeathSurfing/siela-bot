CREATE TABLE "confessions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"author_id" text NOT NULL,
	"number" integer NOT NULL,
	"content" text NOT NULL,
	"message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text
);
--> statement-breakpoint
CREATE TABLE "friendship_levels" (
	"guild_id" text NOT NULL,
	"user_a" text NOT NULL,
	"user_b" text NOT NULL,
	"xp" integer DEFAULT 0 NOT NULL,
	"time_together_seconds" integer DEFAULT 0 NOT NULL,
	"last_activity_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "friendship_levels_guild_id_user_a_user_b_pk" PRIMARY KEY("guild_id","user_a","user_b")
);
--> statement-breakpoint
CREATE TABLE "member_activity" (
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"messages" integer DEFAULT 0 NOT NULL,
	"commands" integer DEFAULT 0 NOT NULL,
	"reactions" integer DEFAULT 0 NOT NULL,
	"voice_seconds" integer DEFAULT 0 NOT NULL,
	"last_active_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_activity_guild_id_user_id_pk" PRIMARY KEY("guild_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "guild_settings" ADD COLUMN "confession_channel_id" text;--> statement-breakpoint
ALTER TABLE "guild_settings" ADD COLUMN "confession_counter" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "confessions" ADD CONSTRAINT "confessions_guild_id_guild_settings_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guild_settings"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendship_levels" ADD CONSTRAINT "friendship_levels_guild_id_guild_settings_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guild_settings"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_activity" ADD CONSTRAINT "member_activity_guild_id_guild_settings_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guild_settings"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "confessions_guild_number_uq" ON "confessions" USING btree ("guild_id","number");