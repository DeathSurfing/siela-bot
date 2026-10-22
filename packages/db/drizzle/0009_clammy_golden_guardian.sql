CREATE TABLE "economy_inventory" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"item_key" varchar(32) NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "economy_shop_items" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"key" varchar(32) NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price" integer NOT NULL,
	"role_id" text,
	"stock" integer,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "economy_shop_items" ADD CONSTRAINT "economy_shop_items_guild_id_guild_settings_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guild_settings"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "economy_inventory_user_item_uq" ON "economy_inventory" USING btree ("guild_id","user_id","item_key");--> statement-breakpoint
CREATE UNIQUE INDEX "economy_shop_item_key_uq" ON "economy_shop_items" USING btree ("guild_id","key");