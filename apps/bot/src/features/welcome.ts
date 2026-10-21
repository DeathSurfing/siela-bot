import {
  AttachmentBuilder,
  EmbedBuilder,
  type GuildMember,
  type MessageCreateOptions,
  type PartialGuildMember,
} from "discord.js";
import { COLORS, renderTemplate, TEMPLATE_KEYS } from "@siela/shared";
import { generateWelcomeCard } from "./welcomeCard.js";
import type { SettingsService } from "./settings.js";
import type { Logger } from "../lib/logger.js";

export class WelcomeService {
  constructor(
    private readonly settings: SettingsService,
    private readonly logger: Logger,
  ) {}

  validateTemplate(template: string): string[] {
    const unknown: string[] = [];
    for (const match of template.matchAll(/\{([a-zA-Z]+)\}/g)) {
      if (!TEMPLATE_KEYS.includes(match[1] as (typeof TEMPLATE_KEYS)[number])) {
        unknown.push(match[1]!);
      }
    }
    return [...new Set(unknown)];
  }

  private values(member: GuildMember | PartialGuildMember) {
    return {
      user: `<@${member.id}>`,
      mention: `<@${member.id}>`,
      username: member.user.username,
      displayName: member.displayName ?? member.user.username,
      server: member.guild.name,
      memberCount: member.guild.memberCount,
      createdAt: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:D>`,
      joinedAt: member.joinedTimestamp
        ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>`
        : "",
    };
  }

  async onMemberJoin(member: GuildMember): Promise<void> {
    if (member.user.bot) return;
    const settings = await this.settings.getWelcome(member.guild.id);
    if (!settings.enabled) return;

    if (settings.channelId) {
      const channel = member.guild.channels.cache.get(settings.channelId);
      if (channel?.isTextBased()) {
        const content = renderTemplate(settings.message, this.values(member));
        const allowedMentions = { parse: settings.pingUser ? (["users"] as const) : [] };
        let payload: MessageCreateOptions;
        if (settings.card) {
          try {
            const card = await generateWelcomeCard({
              displayName: member.displayName ?? member.user.username,
              username: member.user.username,
              avatarUrl: member.user.displayAvatarURL({ size: 256, extension: "png" }),
              serverName: member.guild.name,
              memberCount: member.guild.memberCount,
              message: content,
            });
            payload = {
              embeds: [
                new EmbedBuilder()
                  .setColor(COLORS.primary)
                  .setDescription(content)
                  .setImage("attachment://welcome.png"),
              ],
              files: [new AttachmentBuilder(card, { name: "welcome.png" })],
              allowedMentions,
            };
          } catch (error) {
            this.logger.warn({ err: error }, "welcome card generation failed; falling back to embed");
            payload = {
              embeds: [
                new EmbedBuilder()
                  .setColor(COLORS.primary)
                  .setDescription(content)
                  .setThumbnail(member.user.displayAvatarURL({ size: 256 })),
              ],
              allowedMentions,
            };
          }
        } else {
          payload = settings.embed
            ? {
                embeds: [
                  new EmbedBuilder()
                    .setColor(COLORS.primary)
                    .setDescription(content)
                    .setThumbnail(member.user.displayAvatarURL({ size: 256 })),
                ],
                allowedMentions,
              }
            : { content, allowedMentions };
        }
        await channel.send(payload).catch((error) => {
          this.logger.warn({ err: error, guildId: member.guild.id }, "welcome message failed");
        });
      }
    }

    if (settings.dmEnabled && settings.dmMessage) {
      const content = renderTemplate(settings.dmMessage, this.values(member));
      await member.send({ content, allowedMentions: { parse: [] } }).catch((error) => {
        this.logger.debug({ err: error, userId: member.id }, "welcome DM failed");
      });
    }
  }

  async onMemberRemove(member: GuildMember | PartialGuildMember): Promise<void> {
    if (member.user.bot) return;
    const settings = await this.settings.getWelcome(member.guild.id);
    if (!settings.goodbyeEnabled) return;
    const channelId = settings.goodbyeChannelId ?? settings.channelId;
    if (!channelId) return;
    const channel = member.guild.channels.cache.get(channelId);
    if (!channel?.isTextBased()) return;
    const content = renderTemplate(
      settings.goodbyeMessage ?? "{username} left the server.",
      this.values(member),
    );
    await channel
      .send({ content, allowedMentions: { parse: [] } })
      .catch((error) => this.logger.warn({ err: error }, "goodbye message failed"));
  }

  async sendTest(member: GuildMember, channelId?: string, message?: string): Promise<void> {
    const settings = await this.settings.getWelcome(member.guild.id);
    const targetId = channelId ?? settings.channelId;
    if (!targetId) throw new Error("No welcome channel is configured");
    const channel = member.guild.channels.cache.get(targetId);
    if (!channel?.isTextBased()) throw new Error("Welcome channel is not text-based");
    const template = message ?? settings.message;
    const content = renderTemplate(template, this.values(member));
    const embed = new EmbedBuilder()
      .setColor(COLORS.primary)
      .setDescription(content)
      .setFooter({ text: "Welcome preview" });
    if (settings.card) {
      try {
        const card = await generateWelcomeCard({
          displayName: member.displayName ?? member.user.username,
          username: member.user.username,
          avatarUrl: member.user.displayAvatarURL({ size: 256, extension: "png" }),
          serverName: member.guild.name,
          memberCount: member.guild.memberCount,
          message: content,
        });
        embed.setImage("attachment://welcome.png");
        await channel.send({
          embeds: [embed],
          files: [new AttachmentBuilder(card, { name: "welcome.png" })],
          allowedMentions: { parse: [] },
        });
        return;
      } catch (error) {
        this.logger.warn({ err: error }, "welcome card preview failed; falling back to embed");
      }
    }
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
  }
}
