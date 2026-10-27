import type { Client, Guild } from "discord.js";

/** Relationships can outlive guild membership, so resolve the Discord account too. */
export async function resolveFamilyProfiles(guild: Guild, client: Client, ids: string[]) {
  const names = new Map<string, string>();
  const avatars = new Map<string, string>();
  await Promise.all(ids.map(async (id) => {
    const member = guild.members.cache.get(id) ?? await guild.members.fetch(id).catch(() => null);
    const user = member?.user ?? client.users.cache.get(id) ?? await client.users.fetch(id).catch(() => null);
    names.set(id, member?.displayName || user?.globalName || user?.username || "Unavailable user");
    const avatar = member?.displayAvatarURL({ extension: "png", size: 128 })
      ?? user?.displayAvatarURL({ extension: "png", size: 128 });
    if (avatar) avatars.set(id, avatar);
  }));
  return { names, avatars };
}
