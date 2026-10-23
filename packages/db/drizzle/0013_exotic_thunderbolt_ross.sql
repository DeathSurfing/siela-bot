CREATE TABLE "relic_auctions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"card_id" bigint NOT NULL,
	"channel_id" text NOT NULL,
	"message_id" text,
	"slot" varchar(48) NOT NULL,
	"drop_date" varchar(10) NOT NULL,
	"status" varchar(16) DEFAULT 'live' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"starting_bid" integer NOT NULL,
	"min_increment" integer NOT NULL,
	"highest_bid" bigint DEFAULT 0 NOT NULL,
	"highest_bidder_id" text,
	"bid_count" integer DEFAULT 0 NOT NULL,
	"winner_id" text,
	"winning_bid" bigint,
	"winning_bid_id" bigint,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "relic_auction_status_ck" CHECK ("relic_auctions"."status" IN ('live', 'settled', 'cancelled')),
	CONSTRAINT "relic_auction_bid_ck" CHECK ("relic_auctions"."highest_bid" >= 0 AND "relic_auctions"."bid_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "relic_bids" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"auction_id" bigint NOT NULL,
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"amount" bigint NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "relic_bid_amount_ck" CHECK ("relic_bids"."amount" > 0),
	CONSTRAINT "relic_bid_status_ck" CHECK ("relic_bids"."status" IN ('active', 'outbid', 'won', 'refunded', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "relic_cards" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"subject_key" varchar(64) NOT NULL,
	"name" text NOT NULL,
	"variant_key" varchar(32) NOT NULL,
	"rarity" varchar(16) NOT NULL,
	"seed" bigint NOT NULL,
	"power" integer NOT NULL,
	"chaos" integer NOT NULL,
	"luck" integer NOT NULL,
	"aura" integer NOT NULL,
	"rating" integer NOT NULL,
	"lore" text NOT NULL,
	"emoji" varchar(16) NOT NULL,
	"palette" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sigil" varchar(16) NOT NULL,
	"foil" varchar(16) NOT NULL,
	"is_genesis" boolean DEFAULT false NOT NULL,
	"auction_id" bigint,
	"owner_id" text,
	"minted_at" timestamp with time zone,
	"minted_price" bigint,
	"acquired_via" varchar(16),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "relic_card_rarity_ck" CHECK ("relic_cards"."rarity" IN ('common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic')),
	CONSTRAINT "relic_card_stats_ck" CHECK ("relic_cards"."power" BETWEEN 1 AND 99 AND "relic_cards"."chaos" BETWEEN 1 AND 99 AND "relic_cards"."luck" BETWEEN 1 AND 99 AND "relic_cards"."aura" BETWEEN 1 AND 99)
);
--> statement-breakpoint
CREATE TABLE "relic_inventory" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"card_id" bigint NOT NULL,
	"acquired_via" varchar(16) DEFAULT 'auction' NOT NULL,
	"acquired_price" bigint DEFAULT 0 NOT NULL,
	"last_yield_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_trade_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "relic_profiles" (
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"featured_card_id" bigint,
	"total_yield_claimed" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "relic_profiles_guild_id_user_id_pk" PRIMARY KEY("guild_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "relic_settings" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"channel_id" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"start_hour_ist" integer DEFAULT 16 NOT NULL,
	"duration_minutes" integer DEFAULT 60 NOT NULL,
	"starting_bid" integer DEFAULT 25 NOT NULL,
	"min_increment" integer DEFAULT 10 NOT NULL,
	"ping_role_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "relic_settings_hour_ck" CHECK ("relic_settings"."start_hour_ist" >= 0 AND "relic_settings"."start_hour_ist" <= 23)
);
--> statement-breakpoint
CREATE TABLE "relic_trades" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"proposer_id" text NOT NULL,
	"partner_id" text NOT NULL,
	"offer_card_id" bigint NOT NULL,
	"request_card_id" bigint,
	"coins" bigint DEFAULT 0 NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"channel_id" text,
	"message_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "relic_trade_coins_ck" CHECK ("relic_trades"."coins" >= 0),
	CONSTRAINT "relic_trade_status_ck" CHECK ("relic_trades"."status" IN ('pending', 'accepted', 'declined', 'expired', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "relic_auctions" ADD CONSTRAINT "relic_auctions_guild_id_guild_settings_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guild_settings"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relic_auctions" ADD CONSTRAINT "relic_auctions_card_id_relic_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."relic_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relic_bids" ADD CONSTRAINT "relic_bids_auction_id_relic_auctions_id_fk" FOREIGN KEY ("auction_id") REFERENCES "public"."relic_auctions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relic_cards" ADD CONSTRAINT "relic_cards_guild_id_guild_settings_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guild_settings"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relic_inventory" ADD CONSTRAINT "relic_inventory_guild_id_guild_settings_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guild_settings"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relic_inventory" ADD CONSTRAINT "relic_inventory_card_id_relic_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."relic_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relic_profiles" ADD CONSTRAINT "relic_profiles_guild_id_guild_settings_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guild_settings"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relic_settings" ADD CONSTRAINT "relic_settings_guild_id_guild_settings_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guild_settings"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relic_trades" ADD CONSTRAINT "relic_trades_guild_id_guild_settings_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guild_settings"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "relic_auction_slot_uq" ON "relic_auctions" USING btree ("guild_id","slot");--> statement-breakpoint
CREATE INDEX "relic_auction_status_idx" ON "relic_auctions" USING btree ("status","ends_at");--> statement-breakpoint
CREATE INDEX "relic_auction_message_idx" ON "relic_auctions" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "relic_bid_auction_idx" ON "relic_bids" USING btree ("auction_id","status");--> statement-breakpoint
CREATE INDEX "relic_bid_user_idx" ON "relic_bids" USING btree ("guild_id","user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "relic_card_seed_uq" ON "relic_cards" USING btree ("guild_id","seed");--> statement-breakpoint
CREATE INDEX "relic_card_owner_idx" ON "relic_cards" USING btree ("guild_id","owner_id");--> statement-breakpoint
CREATE INDEX "relic_card_rarity_idx" ON "relic_cards" USING btree ("guild_id","rarity");--> statement-breakpoint
CREATE UNIQUE INDEX "relic_inventory_card_uq" ON "relic_inventory" USING btree ("card_id");--> statement-breakpoint
CREATE INDEX "relic_inventory_user_idx" ON "relic_inventory" USING btree ("guild_id","user_id","created_at");--> statement-breakpoint
CREATE INDEX "relic_inventory_trade_idx" ON "relic_inventory" USING btree ("locked_trade_id");--> statement-breakpoint
CREATE INDEX "relic_trade_status_idx" ON "relic_trades" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "relic_trade_user_idx" ON "relic_trades" USING btree ("guild_id","proposer_id");--> statement-breakpoint
CREATE INDEX "relic_trade_partner_idx" ON "relic_trades" USING btree ("guild_id","partner_id");