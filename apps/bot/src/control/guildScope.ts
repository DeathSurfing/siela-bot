import { UserError } from "../lib/errors.js";

/**
 * Pick the guild for an internal API request. An explicit guild must be
 * served; a single-guild node falls back to its only guild; a multi-guild
 * node refuses to guess.
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
