import { styleMessage } from "../features/ui.js";
import { randomUUID, timingSafeEqual } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import type { Client, Guild } from "discord.js";
import type { ZodType } from "zod";
import {
  auditQuerySchema,
  autoroleSyncSchema,
  autoroleUpdateSchema,
  countersQuerySchema,
  countersResetSchema,
  featureBulkUpdateSchema,
  featureUpdateSchema,
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
  tempvcChannelUpdateSchema,
  tempvcSettingsUpdateSchema,
  tempvcUserActionSchema,
  welcomeTestSchema,
  welcomeUpdateSchema,
  type BotStatus,
} from "@siela/shared";
import type { Services } from "../framework/types.js";
import type { Logger } from "../lib/logger.js";
import { UserError, errorMessage } from "../lib/errors.js";

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

/**
 * Pick the guild for a control request. An explicit guild must be served; a
 * single-guild node falls back to its only guild; a multi-guild node refuses
 * to guess.
 */
export function selectGuildId(input: {
  explicit: string | null;
  served: readonly string[];
  fallback: string | null;
}): string {
  const { explicit, served, fallback } = input;
  if (explicit) {
    if (!served.includes(explicit)) throw new UserError("Unknown guild.", "unknown_guild");
    return explicit;
  }
  if (fallback) return fallback;
  if (served.length > 1) throw new UserError("Select a guild with the x-guild-id header.", "guild_required");
  throw new UserError("The bot is not serving a guild yet.", "not_ready");
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

  private requestId(request: FastifyRequest): string {
    const header = request.headers["x-request-id"];
    if (typeof header === "string" && header) return header;
    return randomUUID();
  }

  private actor(request: FastifyRequest): string {
    const header = request.headers["x-actor"];
    return typeof header === "string" && header ? header : "mcp";
  }

  private route(
    method: "GET" | "POST" | "PATCH" | "DELETE",
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
      const music = this.requireMusic();
      return music.state(this.guildId(request)) ?? { playing: false, paused: false, volume: 0, loop: "off", position: 0, current: null, upcoming: [] };
    });
    this.route("POST", "/v1/music/join", async (request) => {
      const body = this.parse(musicJoinSchema, request.body ?? {});
      const member = await this.guild(request).members.fetch(this.options.client.user!.id);
      const channelId = await this.requireMusic().join(member, body.voiceChannelId);
      return { channelId };
    });
    this.route("POST", "/v1/music/play", async (request) => {
      const body = this.parse(musicPlaySchema, request.body);
      const music = this.requireMusic();
      const member = await this.guild(request).members.fetch(this.options.client.user!.id);
      return music.play(member, body.query, body.voiceChannelId, body.next);
    });
    this.route("POST", "/v1/music/pause", async (request) => {
      await this.requireMusic().pause(this.guildId(request));
      return { ok: true };
    });
    this.route("POST", "/v1/music/resume", async (request) => {
      await this.requireMusic().resume(this.guildId(request));
      return { ok: true };
    });
    this.route("POST", "/v1/music/skip", async (request) => {
      const body = this.parse(musicSkipSchema, request.body ?? {});
      await this.requireMusic().skip(this.guildId(request), body.count);
      return { ok: true };
    });
    this.route("POST", "/v1/music/stop", async (request) => {
      await this.requireMusic().stop(this.guildId(request));
      return { ok: true };
    });
    this.route("POST", "/v1/music/volume", async (request) => {
      const body = this.parse(musicVolumeSchema, request.body);
      return { volume: await this.requireMusic().volume(this.guildId(request), body.volume) };
    });
    this.route("POST", "/v1/music/seek", async (request) => {
      const body = this.parse(musicSeekSchema, request.body);
      await this.requireMusic().seek(this.guildId(request), body.positionMs);
      return { ok: true };
    });
    this.route("POST", "/v1/music/loop", async (request) => {
      const body = this.parse(musicLoopSchema, request.body);
      await this.requireMusic().loop(this.guildId(request), body.mode);
      return { ok: true };
    });
    this.route("POST", "/v1/music/shuffle", async (request) => {
      await this.requireMusic().shuffle(this.guildId(request));
      return { ok: true };
    });
    this.route("POST", "/v1/music/remove", async (request) => {
      const body = this.parse(musicRemoveSchema, request.body);
      const removed = await this.requireMusic().remove(this.guildId(request), body.index);
      return { removed: removed.title };
    });
    this.route("POST", "/v1/music/clear", async (request) => {
      await this.requireMusic().clear(this.guildId(request));
      return { ok: true };
    });
    this.route("POST", "/v1/music/move", async (request) => {
      const body = this.parse(musicMoveSchema, request.body);
      await this.requireMusic().move(this.guildId(request), body.from, body.to);
      return { ok: true };
    });
    this.route("POST", "/v1/music/jump", async (request) => {
      const body = this.parse(musicJumpSchema, request.body);
      await this.requireMusic().jump(this.guildId(request), body.index);
      return { ok: true };
    });
    this.route("POST", "/v1/music/autoplay", async (request) => {
      const body = this.parse(musicAutoplaySchema, request.body);
      await this.requireMusic().autoplay(this.guildId(request), body.enabled);
      return { ok: true };
    });
    this.route("POST", "/v1/music/filters", async (request) => {
      const body = this.parse(musicFilterSchema, request.body);
      await this.requireMusic().filters(this.guildId(request), body.preset);
      return { ok: true };
    });
    this.route("POST", "/v1/music/disconnect", async (request) => {
      await this.requireMusic().disconnect(this.guildId(request));
      return { ok: true };
    });

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
      return services.audit.tail(this.guildId(request), query.limit);
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

  async start(host: string, port: number): Promise<void> {
    await this.app.listen({ host, port });
    this.options.logger.info({ host, port }, "control API listening");
  }

  async stop(): Promise<void> {
    await this.app.close();
  }
}
