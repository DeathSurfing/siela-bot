CREATE TABLE "guild_features" (
	"guild_id" text NOT NULL,
	"feature_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "guild_features_guild_id_feature_id_pk" PRIMARY KEY("guild_id","feature_id")
);
--> statement-breakpoint
ALTER TABLE "guild_features" ADD CONSTRAINT "guild_features_guild_id_guild_settings_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guild_settings"("guild_id") ON DELETE cascade ON UPDATE no action;