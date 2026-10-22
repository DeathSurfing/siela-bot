CREATE TABLE "family_children" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"parent_id" text NOT NULL,
	"child_id" text NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"ended_by" text
);
--> statement-breakpoint
CREATE TABLE "family_marriages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"spouse_a" text NOT NULL,
	"spouse_b" text NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"married_at" timestamp with time zone DEFAULT now() NOT NULL,
	"divorced_at" timestamp with time zone,
	"divorced_by" text
);
--> statement-breakpoint
ALTER TABLE "family_children" ADD CONSTRAINT "family_children_guild_id_guild_settings_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guild_settings"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_marriages" ADD CONSTRAINT "family_marriages_guild_id_guild_settings_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guild_settings"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "family_children_guild_parent_idx" ON "family_children" USING btree ("guild_id","parent_id");--> statement-breakpoint
CREATE INDEX "family_children_guild_child_idx" ON "family_children" USING btree ("guild_id","child_id");--> statement-breakpoint
CREATE INDEX "family_marriages_guild_spouse_a_idx" ON "family_marriages" USING btree ("guild_id","spouse_a");--> statement-breakpoint
CREATE INDEX "family_marriages_guild_spouse_b_idx" ON "family_marriages" USING btree ("guild_id","spouse_b");