import type {
  ChatInputCommandInteraction,
  GuildBasedChannel,
  GuildMember,
  Message,
  MessageContextMenuCommandInteraction,
} from "discord.js";
import type { CommandContext, ReplyPayload, Services } from "./types.js";

type Repliable = ChatInputCommandInteraction | MessageContextMenuCommandInteraction;

function withDefaults(payload: ReplyPayload): ReplyPayload {
  return {
    ...payload,
    allowedMentions: payload.allowedMentions ?? { parse: [], repliedUser: false },
  };
}

export async function createPrefixContext(options: {
  services: Services;
  message: Message;
  member: GuildMember;
  channel: GuildBasedChannel;
  commandName: string;
  args: string[];
  rawArgs: string;
}): Promise<CommandContext> {
  let lastReply: Message | null = null;
  const ctx: CommandContext = {
    client: options.message.client,
    services: options.services,
    guild: options.message.guild!,
    member: options.member,
    channel: options.channel,
    author: options.message.author,
    args: options.args,
    rawArgs: options.rawArgs,
    commandName: options.commandName,
    source: "prefix",
    message: options.message,
    async reply(payload) {
      const data = withDefaults(payload);
      lastReply = await options.message.reply({
        content: data.content,
        embeds: data.embeds,
        components: data.components,
        files: data.files,
        allowedMentions: data.allowedMentions,
        flags: data.flags,
      });
      return lastReply;
    },
    async defer() {
      // Prefix commands cannot defer; this is intentionally a no-op.
    },
    async edit(payload) {
      const data = withDefaults(payload);
      if (!lastReply) return ctx.reply(data);
      lastReply = await lastReply.edit({
        content: data.content,
        embeds: data.embeds,
        components: data.components,
        files: data.files,
        allowedMentions: data.allowedMentions,
        flags: data.flags,
      });
      return lastReply;
    },
    async followUp(payload) {
      const data = withDefaults(payload);
      if (!options.channel.isTextBased()) return null;
      return options.channel.send({
        content: data.content,
        embeds: data.embeds,
        components: data.components,
        files: data.files,
        allowedMentions: data.allowedMentions,
        flags: data.flags,
      });
    },
  };
  return ctx;
}

export async function createSlashContext(options: {
  services: Services;
  interaction: Repliable;
  member: GuildMember;
  channel: GuildBasedChannel;
  commandName: string;
  args: string[];
  rawArgs: string;
  source?: "slash" | "context";
}): Promise<CommandContext> {
  const { interaction } = options;
  let deferred = false;
  let replied = false;

  const ctx: CommandContext = {
    client: interaction.client,
    services: options.services,
    guild: interaction.guild!,
    member: options.member,
    channel: options.channel,
    author: interaction.user,
    args: options.args,
    rawArgs: options.rawArgs,
    commandName: options.commandName,
    source: options.source ?? "slash",
    interaction,
    async reply(payload) {
      const data = withDefaults(payload);
      if (deferred) {
        replied = true;
        return interaction.editReply({
          content: data.content,
          embeds: data.embeds,
          components: data.components,
          files: data.files,
          allowedMentions: data.allowedMentions,
          flags: data.flags,
        });
      }
      if (replied || interaction.replied) {
        return interaction.followUp({
          content: data.content,
          embeds: data.embeds,
          components: data.components,
          files: data.files,
          ephemeral: data.ephemeral,
          allowedMentions: data.allowedMentions,
          flags: data.flags,
        });
      }
      replied = true;
      await interaction.reply({
        content: data.content,
        embeds: data.embeds,
        components: data.components,
        files: data.files,
        ephemeral: data.ephemeral,
        allowedMentions: data.allowedMentions,
        flags: data.flags,
      });
      return interaction.fetchReply();
    },
    async defer(ephemeral = false) {
      if (deferred || replied || interaction.replied) return;
      deferred = true;
      await interaction.deferReply({ ephemeral });
    },
    async edit(payload) {
      const data = withDefaults(payload);
      if (deferred || interaction.replied) {
        replied = true;
        return interaction.editReply({
          content: data.content,
          embeds: data.embeds,
          components: data.components,
          files: data.files,
          allowedMentions: data.allowedMentions,
          flags: data.flags,
        });
      }
      return ctx.reply(data);
    },
    async followUp(payload) {
      const data = withDefaults(payload);
      return interaction.followUp({
        content: data.content,
        embeds: data.embeds,
        components: data.components,
        files: data.files,
        ephemeral: data.ephemeral,
        allowedMentions: data.allowedMentions,
        flags: data.flags,
      });
    },
  };
  return ctx;
}
