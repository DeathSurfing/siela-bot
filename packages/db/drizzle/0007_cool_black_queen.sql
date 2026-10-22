CREATE TABLE "economy_accounts" (
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"balance" bigint DEFAULT 0 NOT NULL,
	"last_daily_at" timestamp with time zone,
	"daily_streak" integer DEFAULT 0 NOT NULL,
	"total_earned" bigint DEFAULT 0 NOT NULL,
	"total_spent" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "economy_accounts_guild_id_user_id_pk" PRIMARY KEY("guild_id","user_id"),
	CONSTRAINT "economy_balance_nonneg" CHECK ("economy_accounts"."balance" >= 0)
);
--> statement-breakpoint
CREATE TABLE "economy_transactions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"from_user_id" text,
	"to_user_id" text,
	"amount" bigint NOT NULL,
	"kind" text NOT NULL,
	"reason" text,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "premium_passes" (
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"granted_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "premium_passes_guild_id_user_id_pk" PRIMARY KEY("guild_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "economy_accounts" ADD CONSTRAINT "economy_accounts_guild_id_guild_settings_guild_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guild_settings"("guild_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "economy_tx_idempotency_uq" ON "economy_transactions" USING btree ("guild_id","idempotency_key") WHERE "economy_transactions"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "economy_tx_guild_created_idx" ON "economy_transactions" USING btree ("guild_id","created_at");