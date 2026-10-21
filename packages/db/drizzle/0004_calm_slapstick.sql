CREATE TABLE "user_birthdays" (
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"month" integer NOT NULL,
	"day" integer NOT NULL,
	"birth_year" integer,
	"last_wished_date" varchar(10),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_birthdays_guild_id_user_id_pk" PRIMARY KEY("guild_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "guild_settings" ADD COLUMN "birthday_channel_id" text;--> statement-breakpoint
ALTER TABLE "user_birthdays" ADD CONSTRAINT "user_birthdays_guild_id_guild_settings_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guild_settings"("guild_id") ON DELETE cascade ON UPDATE no action;