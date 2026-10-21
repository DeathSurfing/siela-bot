import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import {
  autoroleSyncSchema,
  autoroleUpdateSchema,
  auditQuerySchema,
  countersQuerySchema,
  countersResetSchema,
  interactionKindSchema,
  messageSendSchema,
  musicAutoplaySchema,
  musicFilterSchema,
  musicJumpSchema,
  musicLoopSchema,
  musicMoveSchema,
  musicJoinSchema,
  musicPlaySchema,
  musicRemoveSchema,
  musicSeekSchema,
  musicSettingsUpdateSchema,
  musicSkipSchema,
  musicVolumeSchema,
  prefixSetSchema,
  snowflakeSchema,
  tempvcChannelUpdateSchema,
  tempvcSettingsUpdateSchema,
  tempvcUserActionSchema,
  welcomeTestSchema,
  welcomeUpdateSchema,
} from "@siela/shared";
import type { ControlClient } from "./control-client.js";
import type { Logger } from "./logger.js";

type Shape = Record<string, z.ZodTypeAny>;

const READ: ToolAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const OPERATE: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const ADMIN: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const DESTRUCTIVE: ToolAnnotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };

function ok(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

function register(
  server: McpServer,
  name: string,
  description: string,
  inputSchema: Shape,
  annotations: ToolAnnotations,
  handler: (args: Record<string, unknown>) => Promise<unknown>,
): void {
  server.registerTool(
    name,
    { description, inputSchema, annotations },
    async (args: Record<string, unknown>) => {
      try {
        return ok(await handler(args));
      } catch (error) {
        return fail(error);
      }
    },
  );
}

export function registerTools(server: McpServer, client: ControlClient, logger: Logger): void {
  const call = (fn: () => Promise<unknown>) => {
    logger.debug("tool call");
    return fn();
  };

  register(server, "bot_status", "Gateway, database, music, uptime, and version.", {}, READ, () =>
    call(() => client.get("/v1/status")),
  );
  register(server, "commands_list", "Metadata for every bot command.", {}, READ, () =>
    call(() => client.get("/v1/commands")),
  );

  register(server, "prefix_get", "Current global prefix.", {}, READ, () => call(() => client.get("/v1/prefix")));
  register(server, "prefix_set", "Change the global prefix (admin).", prefixSetSchema.shape, ADMIN, (args) =>
    call(() => client.patch("/v1/prefix", args)),
  );
  register(server, "prefix_reset", "Reset the global prefix to '!' (admin).", {}, ADMIN, () =>
    call(() => client.patch("/v1/prefix", { prefix: "!" })),
  );

  register(server, "welcome_get", "Welcome and goodbye configuration.", {}, READ, () =>
    call(() => client.get("/v1/welcome")),
  );
  register(server, "welcome_update", "Update welcome/goodbye configuration (admin).", welcomeUpdateSchema.shape, ADMIN, (args) =>
    call(() => client.patch("/v1/welcome", args)),
  );
  register(server, "welcome_test", "Send a welcome preview to a channel.", welcomeTestSchema.shape, OPERATE, (args) =>
    call(() => client.post("/v1/welcome/test", args)),
  );

  register(server, "autorole_get", "Auto-role configuration plus validation warnings.", {}, READ, () =>
    call(() => client.get("/v1/autorole")),
  );
  register(server, "autorole_update", "Update auto-role roles/flags with hierarchy checks (admin).", autoroleUpdateSchema.shape, ADMIN, (args) =>
    call(() => client.patch("/v1/autorole", args)),
  );
  register(server, "autorole_validate", "Validate the configured auto-roles.", {}, READ, () =>
    call(() => client.post("/v1/autorole/validate")),
  );
  register(
    server,
    "autorole_sync",
    "Preview or apply missing auto-roles. Destructive: requires confirm=true and dryRun=false to apply.",
    autoroleSyncSchema.shape,
    DESTRUCTIVE,
    (args) => call(() => client.post("/v1/autorole/sync", args)),
  );

  register(server, "counters_get", "Interaction counters for a user or pair.", countersQuerySchema.shape, READ, (args) =>
    call(() => client.get("/v1/counters", args as Record<string, string | number | boolean | undefined>)),
  );
  register(
    server,
    "counters_leaderboard",
    "Top interaction users by kind.",
    { kind: interactionKindSchema.optional(), limit: z.number().int().min(1).max(100).optional() },
    READ,
    (args) => call(() => client.get("/v1/counters/leaderboard", args as Record<string, string | number | boolean | undefined>)),
  );
  register(server, "optouts_list", "Interaction opt-outs for this guild.", {}, READ, () =>
    call(() => client.get("/v1/optouts")),
  );
  register(
    server,
    "counters_reset",
    "Reset counters by scope. Destructive: requires confirm=true.",
    countersResetSchema.shape,
    DESTRUCTIVE,
    (args) => call(() => client.post("/v1/counters/reset", args)),
  );

  register(server, "tempvc_get_config", "Temporary VC configuration.", {}, READ, () =>
    call(() => client.get("/v1/tempvc/config")),
  );
  register(
    server,
    "tempvc_update_config",
    "Update temporary VC configuration (admin).",
    tempvcSettingsUpdateSchema.shape,
    ADMIN,
    (args) => call(() => client.patch("/v1/tempvc/config", args)),
  );
  register(server, "tempvc_list", "List active temporary VCs.", {}, READ, () =>
    call(() => client.get("/v1/tempvc/channels")),
  );
  register(server, "tempvc_get", "One temporary VC.", { channelId: snowflakeSchema }, READ, (args) =>
    call(() => client.get(`/v1/tempvc/channels/${String(args.channelId)}`)),
  );
  register(
    server,
    "tempvc_update",
    "Rename, lock, or set a user limit on a temporary VC.",
    { channelId: snowflakeSchema, ...tempvcChannelUpdateSchema.shape },
    OPERATE,
    (args) => {
      const { channelId, ...body } = args;
      return call(() => client.patch(`/v1/tempvc/channels/${String(channelId)}`, body));
    },
  );
  register(
    server,
    "tempvc_permit",
    "Allow a member to join a temporary VC.",
    { channelId: snowflakeSchema, ...tempvcUserActionSchema.shape },
    OPERATE,
    (args) => {
      const { channelId, ...body } = args;
      return call(() => client.post(`/v1/tempvc/channels/${String(channelId)}/permit`, body));
    },
  );
  register(
    server,
    "tempvc_deny",
    "Deny and disconnect a member from a temporary VC.",
    { channelId: snowflakeSchema, ...tempvcUserActionSchema.shape },
    OPERATE,
    (args) => {
      const { channelId, ...body } = args;
      return call(() => client.post(`/v1/tempvc/channels/${String(channelId)}/deny`, body));
    },
  );
  register(
    server,
    "tempvc_disconnect",
    "Disconnect a member from a temporary VC.",
    { channelId: snowflakeSchema, ...tempvcUserActionSchema.shape },
    OPERATE,
    (args) => {
      const { channelId, ...body } = args;
      return call(() => client.post(`/v1/tempvc/channels/${String(channelId)}/disconnect`, body));
    },
  );
  register(
    server,
    "tempvc_claim",
    "Claim an ownerless temporary VC.",
    { channelId: snowflakeSchema, ...tempvcUserActionSchema.shape },
    OPERATE,
    (args) => {
      const { channelId, ...body } = args;
      return call(() => client.post(`/v1/tempvc/channels/${String(channelId)}/claim`, body));
    },
  );
  register(
    server,
    "tempvc_transfer",
    "Transfer temporary VC ownership.",
    { channelId: snowflakeSchema, ...tempvcUserActionSchema.shape },
    OPERATE,
    (args) => {
      const { channelId, ...body } = args;
      return call(() => client.post(`/v1/tempvc/channels/${String(channelId)}/transfer`, body));
    },
  );
  register(
    server,
    "tempvc_delete",
    "Delete a temporary VC. Destructive: requires confirm=true.",
    { channelId: snowflakeSchema, confirm: z.literal(true) },
    DESTRUCTIVE,
    (args) => call(() => client.delete(`/v1/tempvc/channels/${String(args.channelId)}`, { confirm: true })),
  );

  register(server, "music_get_config", "Music policy configuration.", {}, READ, () =>
    call(() => client.get("/v1/music/config")),
  );
  register(server, "music_update_config", "Update music policy (admin).", musicSettingsUpdateSchema.shape, ADMIN, (args) =>
    call(() => client.patch("/v1/music/config", args)),
  );
  register(server, "music_join", "Join a voice channel so it can be used for playback.", musicJoinSchema.shape, OPERATE, (args) =>
    call(() => client.post("/v1/music/join", args)),
  );
  register(server, "music_play", "Play/queue a search, track URL, or playlist URL (YouTube/YouTube Music/SoundCloud/Spotify).", musicPlaySchema.shape, OPERATE, (args) =>
    call(() => client.post("/v1/music/play", args)),
  );
  register(server, "music_pause", "Pause playback.", {}, OPERATE, () => call(() => client.post("/v1/music/pause")));
  register(server, "music_resume", "Resume playback.", {}, OPERATE, () => call(() => client.post("/v1/music/resume")));
  register(server, "music_skip", "Skip track(s).", musicSkipSchema.shape, OPERATE, (args) =>
    call(() => client.post("/v1/music/skip", args)),
  );
  register(server, "music_stop", "Stop and clear the queue.", {}, OPERATE, () => call(() => client.post("/v1/music/stop")));
  register(server, "music_queue", "Current queue state.", {}, READ, () => call(() => client.get("/v1/music/state")));
  register(server, "music_nowplaying", "Current track.", {}, READ, () => call(() => client.get("/v1/music/state")));
  register(server, "music_volume", "Set volume (0-150).", musicVolumeSchema.shape, OPERATE, (args) =>
    call(() => client.post("/v1/music/volume", args)),
  );
  register(server, "music_seek", "Seek the current track (restarts the stream at the offset).", musicSeekSchema.shape, OPERATE, (args) =>
    call(() => client.post("/v1/music/seek", args)),
  );
  register(server, "music_loop", "Set loop mode.", musicLoopSchema.shape, OPERATE, (args) =>
    call(() => client.post("/v1/music/loop", args)),
  );
  register(server, "music_shuffle", "Shuffle the queue.", {}, OPERATE, () => call(() => client.post("/v1/music/shuffle")));
  register(server, "music_remove", "Remove a queue track.", musicRemoveSchema.shape, OPERATE, (args) =>
    call(() => client.post("/v1/music/remove", args)),
  );
  register(server, "music_clear", "Clear upcoming tracks.", {}, OPERATE, () => call(() => client.post("/v1/music/clear")));
  register(server, "music_move", "Move a queue track.", musicMoveSchema.shape, OPERATE, (args) =>
    call(() => client.post("/v1/music/move", args)),
  );
  register(server, "music_jump", "Jump to a queue track.", musicJumpSchema.shape, OPERATE, (args) =>
    call(() => client.post("/v1/music/jump", args)),
  );
  register(server, "music_autoplay", "Toggle autoplay.", musicAutoplaySchema.shape, OPERATE, (args) =>
    call(() => client.post("/v1/music/autoplay", args)),
  );
  register(server, "music_filters", "Apply a filter preset.", musicFilterSchema.shape, OPERATE, (args) =>
    call(() => client.post("/v1/music/filters", args)),
  );
  register(server, "music_disconnect", "Disconnect from voice.", {}, OPERATE, () =>
    call(() => client.post("/v1/music/disconnect")),
  );

  register(
    server,
    "message_send",
    "Send a message to a channel. Destructive: requires confirm=true and never pings.",
    messageSendSchema.shape,
    DESTRUCTIVE,
    (args) => call(() => client.post("/v1/messages", args)),
  );
  register(server, "audit_tail", "Recent audit entries (redacted).", auditQuerySchema.shape, ADMIN, (args) =>
    call(() => client.get("/v1/audit", args as Record<string, string | number | boolean | undefined>)),
  );
  register(
    server,
    "privacy_delete_user_data",
    "Delete counters/opt-outs for a user. Destructive: requires confirm=true.",
    { userId: snowflakeSchema, confirm: z.literal(true) },
    DESTRUCTIVE,
    (args) => call(() => client.delete(`/v1/users/${String(args.userId)}/data`, { confirm: true })),
  );
}
