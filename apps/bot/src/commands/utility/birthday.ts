import { ChannelType, EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { COLORS } from "@siela/shared";
import type { Command, CommandContext } from "../../framework/types.js";
import { isAdmin } from "../../framework/permissions.js";
import { UserError } from "../../lib/errors.js";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function daysInMonth(month: number, year?: number): number {
  const leap = year !== undefined && ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0);
  return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
}

function isValidBirthday(month: number, day: number, year?: number): boolean {
  if (!Number.isInteger(month) || month < 1 || month > 12) return false;
  if (!Number.isInteger(day) || day < 1 || day > daysInMonth(month, year)) return false;
  if (year !== undefined && (!Number.isInteger(year) || year < 1900 || year > new Date().getUTCFullYear())) return false;
  return true;
}

function ageFor(birthYear: number, month: number, day: number): number {
  const now = new Date();
  let age = now.getUTCFullYear() - birthYear;
  if (now.getUTCMonth() + 1 < month || (now.getUTCMonth() + 1 === month && now.getUTCDate() < day)) {
    age -= 1;
  }
  return age;
}

function normalizeId(value: string | undefined): string | undefined {
  return value?.replace(/^<@!?|>$/g, "");
}

function birthdayEmbed(displayName: string, month: number, day: number, birthYear?: number | null) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.social)
    .setTitle(`🎂 ${displayName}'s birthday`)
    .addFields(
      { name: "Date", value: `${MONTHS[month - 1]} ${day}`, inline: true },
    );
  if (birthYear) {
    embed.addFields({ name: "Age", value: String(ageFor(birthYear, month, day)), inline: true });
  }
  return embed;
}

export const birthdayCommand: Command = {
  name: "birthday",
  aliases: ["bday", "bd"],
  category: "utility",
  description: "Set, show, or clear your birthday. The bot wishes members automatically.",
  usage: "<set month day [year] | show [user] | clear | channel [#channel|clear]>",
  examples: ["birthday set 12 25 2000", "birthday show @user", "birthday clear", "birthday channel #birthdays"],
  cooldownMs: 2_000,
  slash: new SlashCommandBuilder()
    .setName("birthday")
    .setDescription("Set, show, or clear your birthday")
    .addSubcommand((sub) =>
      sub
        .setName("set")
        .setDescription("Set your birthday")
        .addIntegerOption((option) => option.setName("month").setDescription("Month (1-12)").setRequired(true).setMinValue(1).setMaxValue(12))
        .addIntegerOption((option) => option.setName("day").setDescription("Day (1-31)").setRequired(true).setMinValue(1).setMaxValue(31))
        .addIntegerOption((option) => option.setName("year").setDescription("Birth year").setRequired(false).setMinValue(1900).setMaxValue(new Date().getUTCFullYear())),
    )
    .addSubcommand((sub) =>
      sub
        .setName("show")
        .setDescription("Show a member's birthday")
        .addUserOption((option) => option.setName("user").setDescription("Member").setRequired(false)),
    )
    .addSubcommand((sub) => sub.setName("clear").setDescription("Clear your birthday"))
    .addSubcommand((sub) =>
      sub
        .setName("channel")
        .setDescription("Set the birthday announcement channel")
        .addChannelOption((option) => option.setName("channel").setDescription("Channel; omit to clear").setRequired(false)),
    ),
  async execute(ctx: CommandContext) {
    const args = ctx.args;
    const action = args[0]?.toLowerCase();

    if (action === "channel") {
      if (!isAdmin(ctx.member, ctx.services.config, ctx.guild)) {
        throw new UserError("You need admin permissions to set the birthday channel.");
      }
      const channelId = normalizeId(args[1]);
      if (!channelId || args[1]?.toLowerCase() === "clear") {
        await ctx.services.settings.setBirthdayChannel(ctx.guild.id, null, ctx.author.id);
        await ctx.reply({ content: "Birthday announcements will be sent by DM.", ephemeral: true });
        return;
      }
      const channel = await ctx.guild.channels.fetch(channelId).catch(() => null);
      if (!channel || channel.type !== ChannelType.GuildText) {
        throw new UserError("The birthday channel must be a text channel.");
      }
      await ctx.services.settings.setBirthdayChannel(ctx.guild.id, channel.id, ctx.author.id);
      await ctx.reply({ content: `Birthday announcements will be sent in <#${channel.id}>.`, ephemeral: true });
      return;
    }

    if (action === "clear") {
      await ctx.services.birthday.clear(ctx.guild.id, ctx.author.id);
      await ctx.reply({ content: "Your birthday has been cleared.", ephemeral: true });
      return;
    }

    if (action === "set") {
      const month = Number(args[1]);
      const day = Number(args[2]);
      const year = args[3] ? Number(args[3]) : undefined;
      if (!isValidBirthday(month, day, year)) {
        throw new UserError("Use a valid date: `birthday set <month> <day> [year]`.");
      }
      await ctx.services.birthday.set(ctx.guild.id, ctx.author.id, month, day, year);
      await ctx.reply({ embeds: [birthdayEmbed(ctx.member.displayName, month, day, year)] });
      return;
    }

    if (action === "show") {
      const userId = normalizeId(args[1]) ?? ctx.author.id;
      const member = await ctx.guild.members.fetch(userId).catch(() => null);
      if (!member) throw new UserError("Member not found.");
      const row = await ctx.services.birthday.get(ctx.guild.id, member.id);
      if (!row) {
        await ctx.reply({
          content: member.id === ctx.author.id ? "You have not set a birthday yet." : `${member.displayName} has not set a birthday yet.`,
          ephemeral: true,
        });
        return;
      }
      await ctx.reply({ embeds: [birthdayEmbed(member.displayName, row.month, row.day, row.birthYear)] });
      return;
    }

    const targetId = normalizeId(action);
    const targetMember = targetId ? await ctx.guild.members.fetch(targetId).catch(() => null) : null;
    if (targetMember) {
      const row = await ctx.services.birthday.get(ctx.guild.id, targetMember.id);
      if (!row) {
        await ctx.reply({ content: `${targetMember.displayName} has not set a birthday yet.`, ephemeral: true });
        return;
      }
      await ctx.reply({ embeds: [birthdayEmbed(targetMember.displayName, row.month, row.day, row.birthYear)] });
      return;
    }

    const row = await ctx.services.birthday.get(ctx.guild.id, ctx.author.id);
    if (!row) {
      await ctx.reply({
        content: "No birthday set yet. Use `birthday set <month> <day> [year]`.",
        ephemeral: true,
      });
      return;
    }
    await ctx.reply({ embeds: [birthdayEmbed(ctx.member.displayName, row.month, row.day, row.birthYear)] });
  },
};