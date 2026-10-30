import { styleMessage } from "../features/ui.js";
import { randomUUID, timingSafeEqual } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { PermissionsBitField, ChannelType, type Client, type Guild, type GuildMember } from "discord.js";
import type { ZodType } from "zod";
import {
  auditQuerySchema,
  autoroleSyncSchema,
  autoroleUpdateSchema,
  birthdaySetSchema,
  cahGameActionSchema,
  cahHostSchema,
  cahRoundActionSchema,
  casinoCoinflipSchema,
  casinoSlotsSchema,
  countersQuerySchema,
  countersResetSchema,
  featureBulkUpdateSchema,
  featureUpdateSchema,
  MAX_CASINO_BET,
  messageSendSchema,
  musicAutoplaySchema,
  musicFilterSchema,
  musicJoinSchema,
  musicJumpSchema,
  musicLoopSchema,
  musicMoveSchema,
  musicPlaySchema,
  musicRemoveSchema,
  musicSeekSchema,
  musicSettingsUpdateSchema,
  musicSkipSchema,
  musicVolumeSchema,
  prefixSetSchema,
  privacyDeleteSchema,
  resolveQuerySchema,
  snowflakeSchema,
  stockTradeSchema,
  tambolaGameActionSchema,
  tempvcChannelUpdateSchema,
  tempvcSettingsUpdateSchema,
  tempvcUserActionSchema,
  welcomeTestSchema,
  welcomeUpdateSchema,
  type BotStatus,
  type ResolveKind,
} from "@siela/shared";
import type { Services } from "../framework/types.js";
import type { Logger } from "../lib/logger.js";
import { UserError, errorMessage } from "../lib/errors.js";
import { playCoinflip, playSlots } from "../features/casino.js";
import { stockSeed } from "../features/stocks.js";
import { tradeErrorMessage } from "../features/stocks-ui.js";
import { selectGuildId } from "./guildScope.js";

export interface ControlServerOptions {
  services: Services;
  client: Client;
  token: string;
  logger: Logger;
  getStatus: () => BotStatus | Promise<BotStatus>;
  /** The guild used when a request does not name one. Null while several are served. */
  getDefaultGuildId: () => string | null;
  /** Every guild this node serves. */
  getGuildIds: () => string[];
}

type Handler = (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

const SNOWFLAKE = /^\d{17,20}$/;
const AUDIT_ACTOR_FETCH_LIMIT = 10;
const ECONOMY_DAILY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const ECONOMY_WORK_COOLDOWN_MS = 2 * 60 * 60 * 1000;
const ECONOMY_MEMBER_FETCH_LIMIT = 10;

const RESOLVE_KIND_ORDER: Record<ResolveKind, number> = { channel: 0, voice: 1, role: 2, user: 3 };

interface ResolveCandidate {
  id: string;
  name: string;
  kind: ResolveKind;
  label: string;
  description?: string;
  rank: number;
}

/** Exact match outranks a prefix, and a prefix outranks a substring. */
function resolveRank(name: string, term: string): number {
  const haystack = name.toLocaleLowerCase();
  if (haystack === term) return 0;
  if (haystack.startsWith(term)) return 1;
  if (haystack.includes(term)) return 2;
  return -1;
}

export class ControlServer {
  private readonly app: FastifyInstance;

  /** Test seam. Routes are exercised with Fastify inject, not a socket. */
  get instance(): FastifyInstance {
    return this.app;
  }

  constructor(private readonly options: ControlServerOptions) {
    this.app = Fastify({ logger: false, bodyLimit: 16 * 1024 });
    this.app.addHook("preHandler", async (request, reply) => {
      const header = request.headers.authorization;
      if (!this.validToken(header)) {
        return reply.code(401).send({ error: { code: "unauthorized", message: "Invalid control token" } });
      }
    });
    this.app.setErrorHandler((error, request, reply) => {
      const message = errorMessage(error);
      const code = error instanceof UserError ? error.code : "internal_error";
      const status = error instanceof UserError ? 400 : 500;
      if (status >= 500) this.options.logger.error({ err: error, url: request.url }, "control API error");
      void reply.code(status).send({ error: { code, message, requestId: request.id } });
    });
    this.registerRoutes();
  }

  private validToken(header: string | undefined): boolean {
    if (!header?.startsWith("Bearer ")) return false;
    const provided = Buffer.from(header.slice("Bearer ".length));
    const expected = Buffer.from(this.options.token);
    return provided.length === expected.length && timingSafeEqual(provided, expected);
  }

  /**
   * Guild scoping for automation. `x-guild-id` (or a `guildId` query value)
   * names the guild; without it a single-guild node uses its only guild and a
   * multi-guild node refuses ambiguous writes.
   */
  private guildId(request: FastifyRequest): string {
    const header = request.headers["x-guild-id"];
    const query = (request.query ?? {}) as { guildId?: unknown };
    const explicit = typeof header === "string" && header
      ? header
      : typeof query.guildId === "string" && query.guildId
        ? query.guildId
        : null;
    return selectGuildId({
      explicit,
      served: this.options.getGuildIds(),
      fallback: this.options.getDefaultGuildId(),
    });
  }

  private guild(request: FastifyRequest): Guild {
    const guild = this.options.client.guilds.cache.get(this.guildId(request));
    if (!guild) throw new UserError("Guild not available.", "not_ready");
    return guild;
  }

  private parse<T>(schema: ZodType<T>, data: unknown): T {
    const result = schema.safeParse(data);
    if (!result.success) {
      throw new UserError(result.error.issues.map((issue) => issue.message).join("; "), "validation_error");
    }
    return result.data;
  }

  private async resolveNames(
    guild: Guild,
    query: { q: string; kind?: ResolveKind; limit: number },
  ): Promise<Array<Omit<ResolveCandidate, "rank">>> {
    const raw = query.q.replace(/^[#@]/, "").trim();
    const term = raw.toLocaleLowerCase();
    if (!term) return [];
    const candidates: ResolveCandidate[] = [];
    const add = (id: string, name: string, kind: ResolveKind, label: string, description?: string) => {
      const rank = resolveRank(name, term);
      if (rank >= 0) candidates.push({ id, name, kind, label, description, rank });
    };

    if (query.kind !== "role" && query.kind !== "user") {
      for (const channel of guild.channels.cache.values()) {
        const kind: ResolveKind = channel.type === ChannelType.GuildVoice ? "voice" : "channel";
        if (query.kind === "voice" && kind !== "voice") continue;
        if (query.kind === "channel" && kind === "voice") continue;
        if (query.kind === "channel" && channel.type !== ChannelType.GuildCategory && !channel.isTextBased()) continue;
        const description = channel.type === ChannelType.GuildCategory ? "Category" : undefined;
        add(channel.id, channel.name, kind, `#${channel.name}`, description);
      }
    }

    if (!query.kind || query.kind === "role") {
      for (const role of guild.roles.cache.values()) {
        const everyone = role.id === guild.id;
        add(role.id, role.name, "role", everyone ? "@everyone" : `@${role.name}`, everyone ? "Includes every member" : undefined);
      }
    }

    if (!query.kind || query.kind === "user") {
      const members = new Map(guild.members.cache);
      try {
        const fetched = await guild.members.fetch({ query: raw, limit: query.limit });
        for (const member of fetched.values()) members.set(member.id, member);
      } catch {
        // A rejected lookup still leaves the cached members as results.
      }
      for (const member of members.values()) {
        add(member.id, member.displayName, "user", member.displayName, member.user?.bot ? "Bot" : undefined);
      }
    }

    return candidates
      .sort((a, b) => a.rank - b.rank
        || RESOLVE_KIND_ORDER[a.kind] - RESOLVE_KIND_ORDER[b.kind]
        || a.name.localeCompare(b.name))
      .slice(0, query.limit)
      .map(({ id, name, kind, label, description }) => ({
        id,
        name,
        kind,
        label,
        ...(description ? { description } : {}),
      }));
  }

  private requestId(request: FastifyRequest): string {
    const header = request.headers["x-request-id"];
    if (typeof header === "string" && header) return header;
    return randomUUID();
  }

  private actor(request: FastifyRequest): string {
    const header = request.headers["x-actor"];
    return typeof header === "string" && header ? header : "mcp";
  }

  private userId(request: FastifyRequest): string {
    const parsed = snowflakeSchema.safeParse(request.headers["x-user-id"]);
    if (!parsed.success) {
      throw new UserError("Provide a valid Discord user ID in the x-user-id header.", "invalid_user_id");
    }
    return parsed.data;
  }

  private route(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    handler: Handler,
  ): void {
    this.app.route({
      method,
      url: path,
      handler: async (request, reply) => {
        const result = await handler(request, reply);
        if (!reply.sent) await reply.send(result);
      },
    });
  }

  private registerRoutes(): void {
    const { services } = this.options;

    this.route("GET", "/v1/status", async (request) => this.options.getStatus());
    this.route("GET", "/v1/guilds", async (request) => ({
      guilds: this.options.getGuildIds().flatMap((guildId) => {
        const guild = this.options.client.guilds.cache.get(guildId);
        if (!guild) return [];
        return [{
          id: guild.id,
          name: guild.name,
          iconUrl: guild.iconURL({ size: 128 }),
          memberCount: guild.memberCount,
          ownerId: guild.ownerId,
          joinedAt: guild.joinedTimestamp,
          available: true,
        }];
      }),
    }));
    this.route("GET", "/v1/commands", async (request) => services.registry.metadata());
    this.route("GET", "/v1/authorize", async (request) => {
      const userId = this.userId(request);
      const guild = this.guild(request);
      let member: GuildMember | null = null;
      try {
        member = await guild.members.fetch(userId);
      } catch {
        member = null;
      }
      return {
        administrator: member?.permissions.has(PermissionsBitField.Flags.Administrator) ?? false,
        user: member ? { id: member.id, name: member.displayName } : null,
      };
    });

    this.route("GET", "/v1/resolve", async (request) => {
      const query = this.parse(resolveQuerySchema, request.query);
      return { results: await this.resolveNames(this.guild(request), query) };
    });

    this.route("GET", "/v1/features", async (request) => {
      const guildId = this.guildId(request);
      return { guildId, features: await services.features.list(guildId) };
    });
    this.route("PATCH", "/v1/features", async (request) => {
      const body = this.parse(featureUpdateSchema, request.body);
      const guildId = this.guildId(request);
      const actor = this.actor(request);
      await services.settings.ensure(guildId);
      const before = (await services.features.list(guildId)).find((feature) => feature.id === body.featureId);
      const result = await services.features.set(guildId, body.featureId, body.enabled, actor);
      await services.audit.log({
        guildId,
        actorId: actor,
        actorType: "mcp",
        source: "control",
        action: "features.update",
        targetType: "feature",
        targetId: body.featureId,
        before: before ? { enabled: before.enabled } : null,
        after: { enabled: result.enabled },
        requestId: this.requestId(request),
      });
      return result;
    });
    this.route("PATCH", "/v1/features/bulk", async (request) => {
      const body = this.parse(featureBulkUpdateSchema, request.body);
      const guildId = this.guildId(request);
      const actor = this.actor(request);
      await services.settings.ensure(guildId);
      const before = new Map((await services.features.list(guildId)).map((feature) => [feature.id, feature.enabled]));
      const results = await services.features.setMany(guildId, body.updates, actor);
      await services.audit.log({
        guildId,
        actorId: actor,
        actorType: "mcp",
        source: "control",
        action: "features.update_many",
        targetType: "guild",
        targetId: guildId,
        before: Object.fromEntries(before),
        after: Object.fromEntries(results.map((result) => [result.featureId, result.enabled])),
        requestId: this.requestId(request),
      });
      return { features: results };
    });

    this.route("GET", "/v1/prefix", async (request) => ({
      prefix: await services.settings.getPrefix(this.guildId(request)),
    }));
    this.route("PATCH", "/v1/prefix", async (request) => {
      const body = this.parse(prefixSetSchema, request.body);
      const guildId = this.guildId(request);
      const before = await services.settings.getPrefix(guildId);
      const prefix = await services.settings.setPrefix(guildId, body.prefix, this.actor(request));
      await services.audit.log({
        guildId,
        actorId: this.actor(request),
        actorType: "mcp",
        source: "control",
        action: "prefix.set",
        before: { prefix: before },
        after: { prefix },
        requestId: this.requestId(request),
      });
      return { prefix };
    });

    this.route("GET", "/v1/welcome", async (request) => services.settings.getWelcome(this.guildId(request)));
    this.route("PATCH", "/v1/welcome", async (request) => {
      const body = this.parse(welcomeUpdateSchema, request.body);
      const guildId = this.guildId(request);
      const before = await services.settings.getWelcome(guildId);
      const after = await services.settings.updateWelcome(guildId, body, this.actor(request));
      await services.audit.log({
        guildId,
        actorId: this.actor(request),
        actorType: "mcp",
        source: "control",
        action: "welcome.update",
        before,
        after,
        requestId: this.requestId(request),
      });
      return after;
    });
    this.route("POST", "/v1/welcome/test", async (request) => {
      const body = this.parse(welcomeTestSchema, request.body ?? {});
      const member = await this.guild(request).members.fetch(this.options.client.user!.id);
      await services.welcome.sendTest(member, body.channelId, body.message);
      return { sent: true };
    });

    this.route("GET", "/v1/autorole", async (request) => {
      const settings = await services.settings.getAutoRole(this.guildId(request));
      const validation = await services.autoRole.validateRoles(this.guild(request), settings.roleIds);
      return { ...settings, validation };
    });
    this.route("PATCH", "/v1/autorole", async (request) => {
      const body = this.parse(autoroleUpdateSchema, request.body);
      const guildId = this.guildId(request);
      const before = await services.settings.getAutoRole(guildId);
      if (body.roleIds) {
        const validation = await services.autoRole.validateRoles(this.guild(request), body.roleIds);
        if (validation.errors.length) throw new UserError(validation.errors.join("; "), "invalid_autorole");
      }
      const after = await services.settings.updateAutoRole(guildId, body, this.actor(request));
      await services.audit.log({
        guildId,
        actorId: this.actor(request),
        actorType: "mcp",
        source: "control",
        action: "autorole.update",
        before,
        after,
        requestId: this.requestId(request),
      });
      return after;
    });
    this.route("POST", "/v1/autorole/validate", async (request) => {
      const settings = await services.settings.getAutoRole(this.guildId(request));
      return services.autoRole.validateRoles(this.guild(request), settings.roleIds);
    });
    this.route("POST", "/v1/autorole/sync", async (request) => {
      const body = this.parse(autoroleSyncSchema, request.body ?? {});
      if (!body.dryRun && !body.confirm) {
        throw new UserError("Set confirm: true to apply a sync.", "confirmation_required");
      }
      const result = await services.autoRole.sync(this.guild(request), body.dryRun ?? true);
      await services.audit.log({
        guildId: this.guildId(request),
        actorId: this.actor(request),
        actorType: "mcp",
        source: "control",
        action: body.dryRun ? "autorole.sync.preview" : "autorole.sync",
        after: result,
        requestId: this.requestId(request),
      });
      return result;
    });

    this.route("GET", "/v1/counters", async (request) => {
      const query = this.parse(countersQuerySchema, request.query);
      return services.counters.query({ ...query, guildId: this.guildId(request) });
    });
    this.route("GET", "/v1/counters/leaderboard", async (request) => {
      const query = request.query as { kind?: string; limit?: string };
      return services.counters.leaderboard(this.guildId(request), query.kind as never, Number(query.limit ?? 10));
    });
    this.route("GET", "/v1/optouts", async (request) => services.counters.listOptouts(this.guildId(request)));
    this.route("POST", "/v1/counters/reset", async (request) => {
      const body = this.parse(countersResetSchema, request.body);
      const removed = await services.counters.reset(this.guildId(request), body);
      await services.audit.log({
        guildId: this.guildId(request),
        actorId: this.actor(request),
        actorType: "mcp",
        source: "control",
        action: "counters.reset",
        after: { scope: body.scope, removed },
        requestId: this.requestId(request),
      });
      return { removed };
    });

    this.route("GET", "/v1/tempvc/config", async (request) => services.settings.getTempVc(this.guildId(request)));
    this.route("PATCH", "/v1/tempvc/config", async (request) => {
      const body = this.parse(tempvcSettingsUpdateSchema, request.body);
      const guildId = this.guildId(request);
      const before = await services.settings.getTempVc(guildId);
      const after = await services.settings.updateTempVc(guildId, body, this.actor(request));
      await services.audit.log({
        guildId,
        actorId: this.actor(request),
        actorType: "mcp",
        source: "control",
        action: "tempvc.update_config",
        before,
        after,
        requestId: this.requestId(request),
      });
      return after;
    });
    this.route("GET", "/v1/tempvc/channels", async (request) => services.tempVc.list(this.guildId(request)));
    this.route("GET", "/v1/tempvc/channels/:id", async (request) => {
      const { id } = request.params as { id: string };
      const row = await services.tempVc.getRow(id);
      if (!row) throw new UserError("Channel not found", "not_found");
      return services.tempVc.toDto(row);
    });
    this.route("PATCH", "/v1/tempvc/channels/:id", async (request) => {
      const { id } = request.params as { id: string };
      const body = this.parse(tempvcChannelUpdateSchema, request.body);
      if (body.name) await services.tempVc.rename(id, body.name);
      if (body.userLimit !== undefined) await services.tempVc.setLimit(id, body.userLimit);
      if (body.locked !== undefined) {
        if (body.locked) await services.tempVc.lock(id, this.actor(request));
        else await services.tempVc.unlock(id, this.actor(request));
      }
      const row = await services.tempVc.getRow(id);
      if (!row) throw new UserError("Channel not found", "not_found");
      return services.tempVc.toDto(row);
    });
    this.route("POST", "/v1/tempvc/channels/:id/permit", async (request) => {
      const { id } = request.params as { id: string };
      const body = this.parse(tempvcUserActionSchema, request.body);
      await services.tempVc.permit(id, body.userId);
      return { ok: true };
    });
    this.route("POST", "/v1/tempvc/channels/:id/deny", async (request) => {
      const { id } = request.params as { id: string };
      const body = this.parse(tempvcUserActionSchema, request.body);
      await services.tempVc.deny(id, body.userId);
      return { ok: true };
    });
    this.route("POST", "/v1/tempvc/channels/:id/disconnect", async (request) => {
      const { id } = request.params as { id: string };
      const body = this.parse(tempvcUserActionSchema, request.body);
      await services.tempVc.disconnect(id, body.userId);
      return { ok: true };
    });
    this.route("POST", "/v1/tempvc/channels/:id/claim", async (request) => {
      const { id } = request.params as { id: string };
      const body = this.parse(tempvcUserActionSchema, request.body);
      await services.tempVc.claim(id, body.userId);
      return { ok: true };
    });
    this.route("POST", "/v1/tempvc/channels/:id/transfer", async (request) => {
      const { id } = request.params as { id: string };
      const body = this.parse(tempvcUserActionSchema, request.body);
      await services.tempVc.transfer(id, body.userId);
      return { ok: true };
    });
    this.route("DELETE", "/v1/tempvc/channels/:id", async (request) => {
      const { id } = request.params as { id: string };
      const query = request.query as { confirm?: string };
      if (query.confirm !== "true") throw new UserError("Set confirm=true to delete.", "confirmation_required");
      await services.tempVc.delete(id, "Deleted by MCP");
      return { deleted: true };
    });

    this.route("GET", "/v1/music/config", async (request) => services.settings.getMusic(this.guildId(request)));
    this.route("PATCH", "/v1/music/config", async (request) => {
      const body = this.parse(musicSettingsUpdateSchema, request.body);
      const guildId = this.guildId(request);
      const before = await services.settings.getMusic(guildId);
      const after = await services.settings.updateMusic(guildId, body, this.actor(request));
      await services.audit.log({
        guildId,
        actorId: this.actor(request),
        actorType: "mcp",
        source: "control",
        action: "music.update_config",
        before,
        after,
        requestId: this.requestId(request),
      });
      return after;
    });
    this.route("GET", "/v1/music/state", async (request) => {
      const guild = this.guild(request);
      const state = this.requireMusic().state(guild.id) ?? {
        playing: false,
        paused: false,
        volume: 0,
        loop: "off",
        position: 0,
        current: null,
        upcoming: [],
        channelId: null,
        channelName: null,
        filter: "off",
      };
      const channel = state.channelId ? guild.channels.cache.get(state.channelId) : null;
      return { ...state, channelName: channel?.name ?? null };
    });
    this.route("POST", "/v1/music/join", async (request) => {
      await this.musicGuild(request);
      const body = this.parse(musicJoinSchema, request.body ?? {});
      const member = await this.musicMember(request);
      const channelId = await this.requireMusic().join(member, body.voiceChannelId);
      return { channelId };
    });
    this.route("POST", "/v1/music/play", async (request) => {
      await this.musicGuild(request);
      const body = this.parse(musicPlaySchema, request.body);
      const music = this.requireMusic();
      const member = await this.musicMember(request);
      return music.play(member, body.query, body.voiceChannelId, body.next);
    });
    this.route("POST", "/v1/music/pause", async (request) => {
      const guildId = await this.musicGuild(request);
      await this.requireMusic().pause(guildId);
      return { ok: true };
    });
    this.route("POST", "/v1/music/resume", async (request) => {
      const guildId = await this.musicGuild(request);
      await this.requireMusic().resume(guildId);
      return { ok: true };
    });
    this.route("POST", "/v1/music/skip", async (request) => {
      const guildId = await this.musicGuild(request);
      const body = this.parse(musicSkipSchema, request.body ?? {});
      await this.requireMusic().skip(guildId, body.count);
      return { ok: true };
    });
    this.route("POST", "/v1/music/stop", async (request) => {
      await this.requireMusic().stop(this.guildId(request));
      return { ok: true };
    });
    this.route("POST", "/v1/music/volume", async (request) => {
      const guildId = await this.musicGuild(request);
      const body = this.parse(musicVolumeSchema, request.body);
      return { volume: await this.requireMusic().volume(guildId, body.volume) };
    });
    this.route("POST", "/v1/music/seek", async (request) => {
      const guildId = await this.musicGuild(request);
      const body = this.parse(musicSeekSchema, request.body);
      await this.requireMusic().seek(guildId, body.positionMs);
      return { ok: true };
    });
    this.route("POST", "/v1/music/loop", async (request) => {
      const guildId = await this.musicGuild(request);
      const body = this.parse(musicLoopSchema, request.body);
      await this.requireMusic().loop(guildId, body.mode);
      return { ok: true };
    });
    this.route("POST", "/v1/music/shuffle", async (request) => {
      const guildId = await this.musicGuild(request);
      await this.requireMusic().shuffle(guildId);
      return { ok: true };
    });
    this.route("POST", "/v1/music/remove", async (request) => {
      const guildId = await this.musicGuild(request);
      const body = this.parse(musicRemoveSchema, request.body);
      const removed = await this.requireMusic().remove(guildId, body.index);
      return { removed: removed.title };
    });
    this.route("POST", "/v1/music/clear", async (request) => {
      const guildId = await this.musicGuild(request);
      await this.requireMusic().clear(guildId);
      return { ok: true };
    });
    this.route("POST", "/v1/music/move", async (request) => {
      const guildId = await this.musicGuild(request);
      const body = this.parse(musicMoveSchema, request.body);
      await this.requireMusic().move(guildId, body.from, body.to);
      return { ok: true };
    });
    this.route("POST", "/v1/music/jump", async (request) => {
      const guildId = await this.musicGuild(request);
      const body = this.parse(musicJumpSchema, request.body);
      await this.requireMusic().jump(guildId, body.index);
      return { ok: true };
    });
    this.route("POST", "/v1/music/autoplay", async (request) => {
      const guildId = await this.musicGuild(request);
      const body = this.parse(musicAutoplaySchema, request.body);
      await this.requireMusic().autoplay(guildId, body.enabled);
      return { ok: true };
    });
    this.route("POST", "/v1/music/filters", async (request) => {
      const guildId = await this.musicGuild(request);
      const body = this.parse(musicFilterSchema, request.body);
      await this.requireMusic().filters(guildId, body.preset);
      return { ok: true };
    });
    this.route("POST", "/v1/music/disconnect", async (request) => {
      await this.requireMusic().disconnect(this.guildId(request));
      return { ok: true };
    });

    this.route("GET", "/v1/cah/state", async (request) => this.cahState(this.guildId(request)));
    this.route("POST", "/v1/cah/host", async (request) => {
      const guild = this.guild(request);
      const guildId = guild.id;
      await this.requireCah(guildId);
      const body = this.parse(cahHostSchema, request.body);
      const member = await this.controlMember(request);
      const channel = await guild.channels.fetch(body.channelId).catch(() => null);
      if (!channel || channel.guildId !== guildId || !channel.isTextBased()) {
        throw new UserError("Choose a text channel in this server.", "invalid_channel");
      }
      await services.cah.host({
        guild,
        channel,
        host: member,
        pointsGoal: body.pointsGoal,
        maxPlayers: body.maxPlayers,
      });
      return this.cahState(guildId);
    });
    this.route("POST", "/v1/cah/start", async (request) => {
      const guildId = this.guildId(request);
      await this.requireCah(guildId);
      const body = this.parse(cahGameActionSchema, request.body);
      const game = this.cahGame(guildId, body.gameId);
      const member = await this.controlMember(request);
      if (member.id !== game.hostId) throw new UserError("Only the host can start the game.", "not_host");
      await services.cah.start(guildId, member);
      return this.cahState(guildId);
    });
    this.route("POST", "/v1/cah/reveal", async (request) => {
      const guildId = this.guildId(request);
      await this.requireCah(guildId);
      const body = this.parse(cahRoundActionSchema, request.body);
      const game = this.cahGame(guildId, body.gameId, body.roundIndex);
      const member = await this.controlMember(request);
      if (member.id !== game.hostId && member.id !== game.judgeId) {
        throw new UserError("Only the host or judge can force a reveal.", "not_controller");
      }
      await services.cah.reveal(guildId, member);
      return this.cahState(guildId);
    });
    this.route("POST", "/v1/cah/next", async (request) => {
      const guildId = this.guildId(request);
      await this.requireCah(guildId);
      const body = this.parse(cahRoundActionSchema, request.body);
      const game = this.cahGame(guildId, body.gameId, body.roundIndex);
      const member = await this.controlMember(request);
      if (member.id !== game.hostId && member.id !== game.judgeId) {
        throw new UserError("Only the host or judge can advance the round.", "not_controller");
      }
      await services.cah.next(guildId, member);
      return this.cahState(guildId);
    });
    this.route("POST", "/v1/cah/end", async (request) => {
      const guildId = this.guildId(request);
      const body = this.parse(cahGameActionSchema, request.body);
      const game = this.cahGame(guildId, body.gameId);
      const member = await this.controlMember(request);
      if (member.id !== game.hostId && !this.administrator(member)) {
        throw new UserError("Only the host or an admin can end the game.", "not_controller");
      }
      await services.cah.end(guildId, member);
      return this.cahState(guildId);
    });

    this.route("GET", "/v1/tambola/state", async (request) => this.tambolaState(this.guildId(request)));
    for (const action of ["end", "pause", "resume"] as const) {
      this.route("POST", `/v1/tambola/${action}`, async (request) => {
        const guildId = this.guildId(request);
        const body = this.parse(tambolaGameActionSchema, request.body);
        const game = this.tambolaGame(guildId, body.gameId);
        const member = await this.controlMember(request);
        if (member.id !== game.hostId && !this.administrator(member)) {
          throw new UserError("Only the host or an admin can control Tambola.", "not_controller");
        }
        if (action === "end") await services.tambola.end(guildId, member);
        else if (action === "pause") await services.tambola.pause(guildId, member);
        else await services.tambola.resume(guildId, member);
        return this.tambolaState(guildId);
      });
    }

    this.route("GET", "/v1/casino/state", async (request) => {
      const guildId = this.guildId(request);
      const userId = this.userId(request);
      if (!(await services.features.isEnabled(guildId, "economy-core"))) {
        return { enabled: false, balance: null, maxBet: MAX_CASINO_BET };
      }
      const { balance } = await services.economy.getBalance(guildId, userId);
      return { enabled: true, balance, maxBet: MAX_CASINO_BET };
    });
    this.route("POST", "/v1/casino/coinflip", async (request) => {
      const guildId = this.guildId(request);
      const userId = this.userId(request);
      const body = this.parse(casinoCoinflipSchema, request.body);
      await this.requireEconomy(guildId);
      const result = await playCoinflip(services.economy, guildId, userId, body.bet, body.side, body.requestId, this.options.token);
      return { enabled: true, maxBet: MAX_CASINO_BET, ...result };
    });
    this.route("POST", "/v1/casino/slots", async (request) => {
      const guildId = this.guildId(request);
      const userId = this.userId(request);
      const body = this.parse(casinoSlotsSchema, request.body);
      await this.requireEconomy(guildId);
      const result = await playSlots(services.economy, guildId, userId, body.bet, body.requestId, this.options.token);
      return { enabled: true, maxBet: MAX_CASINO_BET, ...result };
    });

    this.route("GET", "/v1/economy/state", async (request) => {
      return this.economyState(this.guildId(request), this.userId(request));
    });
    this.route("POST", "/v1/economy/daily", async (request) => {
      const guildId = this.guildId(request);
      const userId = this.userId(request);
      await this.requireEconomy(guildId);
      const claim = await services.economy.daily(guildId, userId).catch((error) => {
        throw this.cooldownError(error, "daily_cooldown", "DAILY_COOLDOWN", "You already claimed today's reward.");
      });
      const balance = await services.economy.getBalance(guildId, userId);
      return { amount: claim.amount, streak: claim.streak, nextAt: claim.nextAt.toISOString(), balance: balance.balance };
    });
    this.route("POST", "/v1/economy/work", async (request) => {
      const guildId = this.guildId(request);
      const userId = this.userId(request);
      await this.requireEconomy(guildId);
      const shift = await services.economy.work(guildId, userId).catch((error) => {
        throw this.cooldownError(error, "work_cooldown", "WORK_COOLDOWN", "You already worked a shift.");
      });
      const balance = await services.economy.getBalance(guildId, userId);
      return { amount: shift.amount, nextAt: shift.nextAt.toISOString(), balance: balance.balance };
    });
    this.route("GET", "/v1/economy/leaderboard", async (request) => {
      const guildId = this.guildId(request);
      const userId = this.userId(request);
      const query = request.query as { limit?: string };
      const limit = query.limit === undefined ? 25 : Number(query.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
        throw new UserError("Leaderboard limit must be between 1 and 50.", "validation_error");
      }
      if (!(await services.features.isEnabled(guildId, "economy-core"))) {
        return { enabled: false, entries: [], me: null };
      }
      const rows = await services.economy.leaderboard(guildId, limit);
      const guild = this.guild(request);
      const missing = rows
        .filter((row) => !guild.members.cache.has(row.userId))
        .map((row) => row.userId)
        .slice(0, ECONOMY_MEMBER_FETCH_LIMIT);
      if (missing.length) await guild.members.fetch({ user: missing }).catch(() => undefined);
      const entries = rows.map((row, index) => ({
        rank: index + 1,
        userId: row.userId,
        name: guild.members.cache.get(row.userId)?.displayName ?? row.userId,
        balance: row.balance,
      }));
      const balance = await services.economy.getBalance(guildId, userId);
      const rank = await services.economy.getRank(guildId, userId);
      return { enabled: true, entries, me: { rank, balance: balance.balance } };
    });

    this.route("GET", "/v1/stocks/state", async (request) => {
      const guildId = this.guildId(request);
      const userId = this.userId(request);
      if (!(await services.features.isEnabled(guildId, "economy-core"))) {
        return { enabled: false, market: null, portfolio: null };
      }
      const market = await services.economy.getMarket(guildId);
      const portfolio = await services.economy.getPortfolio(guildId, userId);
      return { enabled: true, market, portfolio };
    });
    for (const side of ["buy", "sell"] as const) {
      this.route("POST", `/v1/stocks/${side}`, async (request) => {
        const guildId = this.guildId(request);
        const userId = this.userId(request);
        const body = this.parse(stockTradeSchema, request.body);
        await this.requireEconomy(guildId);
        const symbol = body.symbol.toUpperCase();
        if (!stockSeed(symbol)) throw new UserError("That symbol is not on the exchange.", "unknown_stock");
        const result = await (side === "buy"
          ? services.economy.buyStock(guildId, userId, symbol, body.shares)
          : services.economy.sellStock(guildId, userId, symbol, body.shares)
        ).catch((error) => {
          throw new UserError(tradeErrorMessage(error), "trade_failed");
        });
        const market = await services.economy.getMarket(guildId);
        const portfolio = await services.economy.getPortfolio(guildId, userId);
        return { result, market, portfolio };
      });
    }

    this.route("POST", "/v1/messages", async (request) => {
      const body = this.parse(messageSendSchema, request.body);
      const channel = await this.options.client.channels.fetch(body.channelId).catch(() => null);
      if (!channel || !channel.isTextBased() || !("send" in channel)) {
        throw new UserError("Channel is not text-based", "invalid_channel");
      }
      const sendable = channel as unknown as { send: (options: unknown) => Promise<{ id: string }> };
      const sent = await sendable.send(styleMessage({ content: body.content, allowedMentions: { parse: [] } }));
      await services.audit.log({
        guildId: this.guildId(request),
        actorId: this.actor(request),
        actorType: "mcp",
        source: "control",
        action: "message.send",
        targetType: "channel",
        targetId: body.channelId,
        after: { messageId: sent.id, length: body.content.length },
        requestId: this.requestId(request),
      });
      return { messageId: sent.id };
    });

    this.route("GET", "/v1/audit", async (request) => {
      const query = this.parse(auditQuerySchema, request.query);
      const guild = this.options.client.guilds.cache.get(this.guildId(request));
      const entries = await services.audit.tail(this.guildId(request), query.limit);
      const missing = guild
        ? [...new Set(entries.flatMap((entry) => {
          const id = entry.actorId;
          return id && SNOWFLAKE.test(id) && !guild.members.cache.get(id) ? [id] : [];
        }))].slice(0, AUDIT_ACTOR_FETCH_LIMIT)
        : [];
      if (guild && missing.length) await guild.members.fetch({ user: missing }).catch(() => undefined);
      return entries.map((entry) => ({
        ...entry,
        actorName: entry.actorId ? (guild?.members.cache.get(entry.actorId)?.displayName ?? entry.actorId) : null,
      }));
    });

    this.route("GET", "/v1/users/me/birthday", async (request) => {
      const row = await services.birthday.get(this.guildId(request), this.userId(request));
      return row ?? { birthday: null };
    });
    this.route("PUT", "/v1/users/me/birthday", async (request) => {
      const body = this.parse(birthdaySetSchema, request.body);
      return services.birthday.set(
        this.guildId(request),
        this.userId(request),
        body.month,
        body.day,
        body.year ?? null,
      );
    });
    this.route("DELETE", "/v1/users/me/birthday", async (request) => {
      await services.birthday.clear(this.guildId(request), this.userId(request));
      return { ok: true };
    });

    this.route("DELETE", "/v1/users/:id/data", async (request) => {
      const { id } = request.params as { id: string };
      const query = request.query as { confirm?: string };
      if (query.confirm !== "true") throw new UserError("Set confirm=true to delete.", "confirmation_required");
      const parsed = this.parse(privacyDeleteSchema, { userId: id, confirm: true });
      await services.privacy.deleteUserData(this.guildId(request), parsed.userId);
      await services.audit.log({
        guildId: this.guildId(request),
        actorId: this.actor(request),
        actorType: "mcp",
        source: "control",
        action: "privacy.delete",
        targetType: "user",
        targetId: parsed.userId,
        requestId: this.requestId(request),
      });
      return { deleted: true };
    });
  }

  private requireMusic() {
    if (!this.options.services.music) throw new UserError("Music service is not ready.", "not_ready");
    return this.options.services.music;
  }

  private async controlMember(request: FastifyRequest): Promise<GuildMember> {
    const guild = this.guild(request);
    const userId = this.userId(request);
    try {
      return await guild.members.fetch(userId);
    } catch {
      throw new UserError("You are not a member of this server.", "not_a_member");
    }
  }

  /**
   * Voice joins follow the signed-in member when the dashboard supplies one,
   * so "join my voice channel" uses their voice state. Automation without a
   * user header keeps joining as the bot.
   */
  private async musicMember(request: FastifyRequest): Promise<GuildMember> {
    if (request.headers["x-user-id"] !== undefined) return this.controlMember(request);
    return this.guild(request).members.fetch(this.options.client.user!.id);
  }

  private administrator(member: GuildMember): boolean {
    return member.permissions.has(PermissionsBitField.Flags.Administrator);
  }

  private async requireCah(guildId: string): Promise<void> {
    if (!(await this.options.services.features.isEnabled(guildId, "games-cah"))) {
      throw new UserError("Cards Against Humanity is turned off on this server.", "feature_disabled");
    }
  }

  private async requireEconomy(guildId: string): Promise<void> {
    if (!(await this.options.services.features.isEnabled(guildId, "economy-core"))) {
      throw new UserError("The economy is turned off on this server.", "feature_disabled");
    }
  }

  private async economyState(guildId: string, userId: string) {
    if (!(await this.options.services.features.isEnabled(guildId, "economy-core"))) return { enabled: false };
    const balance = await this.options.services.economy.getBalance(guildId, userId);
    const now = Date.now();
    return {
      enabled: true,
      balance: balance.balance,
      dailyStreak: balance.dailyStreak,
      lastDailyAt: balance.lastDailyAt?.toISOString() ?? null,
      lastWorkAt: balance.lastWorkAt?.toISOString() ?? null,
      dailyReadyAt: this.readyAt(balance.lastDailyAt, ECONOMY_DAILY_COOLDOWN_MS, now),
      workReadyAt: this.readyAt(balance.lastWorkAt, ECONOMY_WORK_COOLDOWN_MS, now),
      totalEarned: balance.totalEarned,
      totalSpent: balance.totalSpent,
    };
  }

  private readyAt(last: Date | null, cooldownMs: number, now: number): string | null {
    if (!last) return null;
    const readyAt = last.getTime() + cooldownMs;
    return readyAt > now ? new Date(readyAt).toISOString() : null;
  }

  private cooldownError(error: unknown, code: string, prefix: string, message: string): Error {
    const raw = errorMessage(error);
    if (!raw.startsWith(`${prefix}:`)) return error instanceof Error ? error : new Error(raw);
    const readyAt = new Date(raw.slice(prefix.length + 1));
    if (Number.isNaN(readyAt.getTime())) return new UserError(message, code);
    const when = `${readyAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC`;
    return new UserError(`${message} Try again at ${when}.`, code);
  }

  private async cahState(guildId: string) {
    return {
      enabled: await this.options.services.features.isEnabled(guildId, "games-cah"),
      game: this.options.services.cah.snapshot(guildId) ?? this.options.services.cah.lastResult(guildId),
    };
  }

  private cahGame(guildId: string, gameId: string, roundIndex?: number) {
    const game = this.options.services.cah.snapshot(guildId);
    if (!game || game.id !== gameId) throw new UserError("That game is no longer running.", "stale_game");
    if (roundIndex !== undefined && game.roundIndex !== roundIndex) {
      throw new UserError("That round has already changed. Refresh and try again.", "stale_round");
    }
    return game;
  }

  private async tambolaState(guildId: string) {
    return {
      enabled: await this.options.services.features.isEnabled(guildId, "games-tambola"),
      game: this.options.services.tambola.snapshot(guildId),
    };
  }

  private tambolaGame(guildId: string, gameId: string) {
    const game = this.options.services.tambola.snapshot(guildId);
    if (!game || game.id !== gameId) throw new UserError("That game is no longer running.", "stale_game");
    return game;
  }

  /** Music controls require the guild's music-playback flag. Cleanup does not. */
  private async musicGuild(request: FastifyRequest): Promise<string> {
    const guildId = this.guildId(request);
    if (!(await this.options.services.features.isEnabled(guildId, "music-playback"))) {
      throw new UserError("Music playback is turned off on this server.", "feature_disabled");
    }
    return guildId;
  }

  async start(host: string, port: number): Promise<void> {
    await this.app.listen({ host, port });
    this.options.logger.info({ host, port }, "control API listening");
  }

  async stop(): Promise<void> {
    await this.app.close();
  }
}
