import { timingSafeEqual } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import type { Client } from "discord.js";
import {
  musicAutoplaySchema,
  musicFilterSchema,
  musicJoinSchema,
  musicJumpSchema,
  musicLoopSchema,
  musicMoveSchema,
  musicPlaySchema,
  musicRemoveSchema,
  musicSeekSchema,
  musicSkipSchema,
  musicVolumeSchema,
} from "@siela/shared";
import type { Services } from "../framework/types.js";
import type { Logger } from "../lib/logger.js";
import { UserError, errorMessage } from "../lib/errors.js";

export interface WorkerServerOptions {
  services: Services;
  client: Client;
  token: string;
  logger: Logger;
  getGuildId: () => string | null;
}

export class WorkerServer {
  private readonly app: FastifyInstance;

  constructor(private readonly options: WorkerServerOptions) {
    this.app = Fastify({ logger: false, bodyLimit: 16 * 1024 });
    this.app.addHook("preHandler", async (request, reply) => {
      const header = request.headers.authorization;
      if (!this.validToken(header)) {
        return reply.code(401).send({ error: { code: "unauthorized", message: "Invalid worker token" } });
      }
    });
    this.app.setErrorHandler((error, request, reply) => {
      const message = errorMessage(error);
      const code = error instanceof UserError ? error.code : "internal_error";
      const status = error instanceof UserError ? 400 : 500;
      if (status >= 500) this.options.logger.error({ err: error, url: request.url }, "worker API error");
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

  private guildId(): string {
    const guildId = this.options.getGuildId();
    if (!guildId) throw new UserError("The worker is not bound to a guild yet.", "not_ready");
    return guildId;
  }

  private async selfMember() {
    const guildId = this.guildId();
    const guild = this.options.client.guilds.cache.get(guildId);
    if (!guild) throw new UserError("Guild not available.", "not_ready");
    return guild.members.fetch(this.options.client.user!.id);
  }

  private registerRoutes(): void {
    this.app.get("/internal/music/state", async () => {
      const music = this.options.services.music;
      if (!music) throw new UserError("Music service is not ready.", "not_ready");
      return music.state(this.guildId()) ?? { playing: false, paused: false, volume: 0, loop: "off", position: 0, current: null, upcoming: [] };
    });

    this.app.post("/internal/music/join", async (request) => {
      const body = musicJoinSchema.parse(request.body ?? {});
      const member = await this.selfMember();
      const channelId = await this.options.services.music!.join(member, body.voiceChannelId);
      return { channelId };
    });

    this.app.post("/internal/music/play", async (request) => {
      const body = musicPlaySchema.parse(request.body);
      const member = await this.selfMember();
      return this.options.services.music!.play(member, body.query, body.voiceChannelId, body.next);
    });

    const guildOp = (fn: (music: NonNullable<Services["music"]>, guildId: string) => Promise<unknown>) => async () => {
      const music = this.options.services.music;
      if (!music) throw new UserError("Music service is not ready.", "not_ready");
      return fn(music, this.guildId());
    };

    this.app.post("/internal/music/pause", guildOp(async (music, guildId) => {
      await music.pause(guildId);
      return { ok: true };
    }));
    this.app.post("/internal/music/resume", guildOp(async (music, guildId) => {
      await music.resume(guildId);
      return { ok: true };
    }));
    this.app.post("/internal/music/stop", guildOp(async (music, guildId) => {
      await music.stop(guildId);
      return { ok: true };
    }));
    this.app.post("/internal/music/disconnect", guildOp(async (music, guildId) => {
      await music.disconnect(guildId);
      return { ok: true };
    }));
    this.app.post("/internal/music/shuffle", guildOp(async (music, guildId) => {
      await music.shuffle(guildId);
      return { ok: true };
    }));
    this.app.post("/internal/music/clear", guildOp(async (music, guildId) => {
      await music.clear(guildId);
      return { ok: true };
    }));
    this.app.post("/internal/music/skip", async (request) => {
      const body = musicSkipSchema.parse(request.body ?? {});
      await this.options.services.music!.skip(this.guildId(), body.count);
      return { ok: true };
    });
    this.app.post("/internal/music/volume", async (request) => {
      const body = musicVolumeSchema.parse(request.body);
      return { volume: await this.options.services.music!.volume(this.guildId(), body.volume) };
    });
    this.app.post("/internal/music/seek", async (request) => {
      const body = musicSeekSchema.parse(request.body);
      await this.options.services.music!.seek(this.guildId(), body.positionMs);
      return { ok: true };
    });
    this.app.post("/internal/music/loop", async (request) => {
      const body = musicLoopSchema.parse(request.body);
      await this.options.services.music!.loop(this.guildId(), body.mode);
      return { ok: true };
    });
    this.app.post("/internal/music/remove", async (request) => {
      const body = musicRemoveSchema.parse(request.body);
      const removed = await this.options.services.music!.remove(this.guildId(), body.index);
      return { removed: removed.title };
    });
    this.app.post("/internal/music/move", async (request) => {
      const body = musicMoveSchema.parse(request.body);
      await this.options.services.music!.move(this.guildId(), body.from, body.to);
      return { ok: true };
    });
    this.app.post("/internal/music/jump", async (request) => {
      const body = musicJumpSchema.parse(request.body);
      await this.options.services.music!.jump(this.guildId(), body.index);
      return { ok: true };
    });
    this.app.post("/internal/music/autoplay", async (request) => {
      const body = musicAutoplaySchema.parse(request.body);
      await this.options.services.music!.autoplay(this.guildId(), body.enabled);
      return { ok: true };
    });
    this.app.post("/internal/music/filters", async (request) => {
      const body = musicFilterSchema.parse(request.body);
      await this.options.services.music!.filters(this.guildId(), body.preset);
      return { ok: true };
    });
  }

  async start(host: string, port: number): Promise<void> {
    await this.app.listen({ host, port });
  }

  async stop(): Promise<void> {
    await this.app.close().catch(() => undefined);
  }
}
