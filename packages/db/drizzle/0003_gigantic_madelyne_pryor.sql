CREATE TABLE "user_biases" (
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"bias" varchar(32) NOT NULL,
	"bias_wrecker" varchar(32) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_biases_guild_id_user_id_pk" PRIMARY KEY("guild_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "user_biases" ADD CONSTRAINT "user_biases_guild_id_guild_settings_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guild_settings"("guild_id") ON DELETE cascade ON UPDATE no action;