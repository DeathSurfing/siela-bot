CREATE TABLE "economy_holdings" (
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"symbol" varchar(8) NOT NULL,
	"shares" bigint DEFAULT 0 NOT NULL,
	"avg_cost" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "economy_holdings_guild_id_user_id_symbol_pk" PRIMARY KEY("guild_id","user_id","symbol"),
	CONSTRAINT "economy_holding_shares_nonneg" CHECK ("economy_holdings"."shares" >= 0)
);
--> statement-breakpoint
CREATE TABLE "economy_markets" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"last_tick_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tick_count" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "economy_stocks" (
	"guild_id" text NOT NULL,
	"symbol" varchar(8) NOT NULL,
	"name" text NOT NULL,
	"sector" text NOT NULL,
	"description" text NOT NULL,
	"price" bigint NOT NULL,
	"fair_value" bigint NOT NULL,
	"volatility" integer NOT NULL,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_event" text,
	"last_event_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "economy_stocks_guild_id_symbol_pk" PRIMARY KEY("guild_id","symbol"),
	CONSTRAINT "economy_stock_price_positive" CHECK ("economy_stocks"."price" > 0)
);
--> statement-breakpoint
ALTER TABLE "welcome_settings" ALTER COLUMN "message" SET DEFAULT '𓆩♡𓆪 yooo {mention} just spawned in ⋆.𐙚 ̊Sierra''s 서버~~!!!!

bro really joined the server 😭
dude does NOT know what they''re getting into ...💀

anyways welcome to this mentally unstable household
take a seat, start yapping, and pretend we''re normal~~

𖤐 read the rules before the mods get a new victim
𖤐 yap in general
𖤐 make friends or lurk like an npc

have fun gang 🗣️🔥';--> statement-breakpoint
ALTER TABLE "guild_settings" ADD COLUMN "leveling_channel_id" text;--> statement-breakpoint
ALTER TABLE "member_activity" ADD COLUMN "xp" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "member_activity" ADD COLUMN "level" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "economy_holdings" ADD CONSTRAINT "economy_holdings_guild_id_guild_settings_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guild_settings"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "economy_markets" ADD CONSTRAINT "economy_markets_guild_id_guild_settings_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guild_settings"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "economy_stocks" ADD CONSTRAINT "economy_stocks_guild_id_guild_settings_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guild_settings"("guild_id") ON DELETE cascade ON UPDATE no action;