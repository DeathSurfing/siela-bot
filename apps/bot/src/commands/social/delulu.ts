import { styleMessage } from "../../features/ui.js";
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, LabelBuilder, ModalBuilder, SlashCommandBuilder,
  StringSelectMenuBuilder, type ButtonInteraction, type ModalSubmitInteraction,
} from "discord.js";
import { BTS_MEMBERS } from "@siela/shared";
import type { Command, CommandContext, Services } from "../../framework/types.js";
import { buildDeluluPayload } from "../../features/delulu-ui.js";
import { UserError } from "../../lib/errors.js";
import { normalizeMember } from "./bias.js";

export const DELULU_SETUP_PREFIX = "delulu:setup:";
const SETUP_TTL_MS = 5 * 60 * 1000;

function setupId(action: "open" | "submit", userId: string, nsfw: boolean, createdAt = Date.now()): string {
  return `${DELULU_SETUP_PREFIX}${action}:${userId}:${nsfw ? "nsfw" : "sfw"}:${createdAt}`;
}

function setupModal(userId: string, nsfw: boolean): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(setupId("submit", userId, nsfw))
    .setTitle("Set your bias & run Delulu")
    .addLabelComponents(
      new LabelBuilder().setLabel("Your BTS bias").setStringSelectMenuComponent(
        new StringSelectMenuBuilder().setCustomId("bias")
          .setPlaceholder("Select your bias").setMinValues(1).setMaxValues(1).setRequired(true)
          .addOptions(BTS_MEMBERS.map((member) => ({ label: member, value: member }))),
      ),
      new LabelBuilder().setLabel("Your bias wrecker").setDescription("Choose a different member from your bias.").setStringSelectMenuComponent(
        new StringSelectMenuBuilder().setCustomId("wrecker")
          .setPlaceholder("Select your bias wrecker").setMinValues(1).setMaxValues(1).setRequired(true)
          .addOptions(BTS_MEMBERS.map((member) => ({ label: member, value: member }))),
      ),
    );
}

/** Both setup entry points continue through the same pricing and generation path. */
export async function handleDeluluSetup(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  services: Services,
): Promise<void> {
  const [namespace, feature, action, userId, mode, timestamp, extra] = interaction.customId.split(":");
  if (namespace !== "delulu" || feature !== "setup") return;
  if (!interaction.guild || interaction.user.id !== userId) {
    await interaction.reply(styleMessage({ content: "This bias setup belongs to someone else.", ephemeral: true }));
    return;
  }
  const age = Date.now() - Number(timestamp);
  if (extra !== undefined || !timestamp || !Number.isFinite(age) || age < 0 || age > SETUP_TTL_MS || !["sfw", "nsfw"].includes(mode ?? "")) {
    await interaction.reply(styleMessage({ content: "This setup expired. Run Delulu again to open a fresh one.", ephemeral: true }));
    return;
  }
  const nsfw = mode === "nsfw";
  if (interaction.isButton() && action === "open") {
    await interaction.showModal(setupModal(userId!, nsfw));
    await interaction.message.edit(styleMessage({ content: "Bias setup opened. Complete the form to continue.", components: [] })).catch(() => undefined);
    return;
  }
  if (!interaction.isModalSubmit() || action !== "submit") return;
  const bias = normalizeMember(interaction.fields.getStringSelectValues("bias")[0]);
  const wrecker = normalizeMember(interaction.fields.getStringSelectValues("wrecker")[0]);
  if (!bias || !wrecker || bias === wrecker) {
    const message = !bias || !wrecker
      ? `Choose BTS members: ${BTS_MEMBERS.join(", ")}.`
      : "Your bias and bias wrecker must be different members.";
    await interaction.reply(styleMessage({
      content: message,
      ephemeral: true,
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(setupId("open", userId!, nsfw))
          .setLabel("Try bias setup again").setStyle(ButtonStyle.Primary),
      )],
    }));
    return;
  }
  await interaction.deferReply();
  try {
    await services.bias.set(interaction.guild.id, userId!, bias, wrecker);
    await runDelulu({
      services, guild: interaction.guild, author: interaction.user,
      defer: async () => {},
      edit: (payload) => interaction.editReply(styleMessage({ ...payload, allowedMentions: { parse: [], repliedUser: false } })),
    }, bias, nsfw);
  } catch (error) {
    await interaction.editReply(styleMessage({
      content: error instanceof UserError ? error.message : "Could not save your bias or run Delulu. Please try again.",
      allowedMentions: { parse: [] },
    }));
  }
}

export const deluluCommand: Command = {
  name: "delulu",
  category: "social",
  description: "Generate a ridiculous fictional scenario where your BTS bias notices you.",
  usage: "[nsfw]",
  examples: ["delulu", "delulu nsfw"],
  cooldownMs: 5_000,
  slash: new SlashCommandBuilder()
    .setName("delulu")
    .setDescription("Generate a delulu BTS bias scenario")
    .addBooleanOption((option) =>
      option
        .setName("nsfw")
        .setDescription("Generate an NSFW-focused delulu scenario")
        .setRequired(false),
    ),
  async execute(ctx: CommandContext) {
    const optionNsfw = (ctx.interaction?.options as { getBoolean?: (name: string) => boolean | null } | undefined)?.getBoolean?.("nsfw");
    const nsfw = optionNsfw ?? ctx.args.some((arg) =>
      ["true", "nsfw", "on", "1"].includes(arg.toLowerCase()),
    );
    const row = await ctx.services.bias.get(ctx.guild.id, ctx.author.id);
    if (!row) {
      if (ctx.interaction?.isChatInputCommand()) {
        await ctx.interaction.showModal(setupModal(ctx.author.id, nsfw));
      } else {
        await ctx.reply({
          content: "Choose your bias and bias wrecker, then I’ll run Delulu for you. The usual coin cost and daily limit apply.",
          components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(setupId("open", ctx.author.id, nsfw))
              .setLabel("Set bias & continue").setStyle(ButtonStyle.Primary),
          )],
        });
      }
      return;
    }
    await runDelulu(ctx, row.bias, nsfw);
  },
};

type DeluluContext = Pick<CommandContext, "services" | "guild" | "author" | "defer" | "edit">;

async function runDelulu(ctx: DeluluContext, bias: string, nsfw: boolean): Promise<void> {
    await ctx.defer();
    const kind = nsfw ? "delulu_nsfw" : "delulu";
    const used = await ctx.services.economy
      .countDeluluUsesToday(ctx.guild.id, ctx.author.id, kind)
      .catch(() => 0);
    const limit = 4;
    if (!nsfw && used >= limit) {
      throw new UserError(
        `Daily delulu limit reached (${limit} uses). Try again tomorrow.`,
      );
    }
    const cost = (nsfw ? 15 : 5) * 2 ** used;
    const paymentId = `delulu:${kind}:${ctx.guild.id}:${ctx.author.id}:${Date.now()}`;
    try {
      await ctx.services.economy.spend(
        ctx.guild.id,
        ctx.author.id,
        cost,
        kind,
        paymentId,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Payment failed.";
      if (message === "INSUFFICIENT_FUNDS") {
        throw new UserError(
          `You need ${cost} SC for delulu${nsfw ? " NSFW" : ""} (use ${used + 1} today).`,
        );
      }
      throw new UserError(message);
    }
    try {
      const scenario = await ctx.services.delulu.generate(bias, nsfw);
      await ctx.edit(
        buildDeluluPayload({ bias, scenario, nsfw, cost, use: used + 1 }),
      );
    } catch (error) {
      try {
        await ctx.services.economy.award(ctx.guild.id, ctx.author.id, cost, "delulu_refund", `${paymentId}:refund`);
      } catch (refundError) {
        await ctx.services.audit.log({
          guildId: ctx.guild.id,
          actorId: ctx.author.id,
          source: "discord",
          action: "delulu.refund_failed",
          targetType: "user",
          targetId: ctx.author.id,
          after: { cost, error: refundError instanceof Error ? refundError.message : String(refundError) },
        });
      }
      throw new UserError("Delulu generation failed. Your coins have been refunded.");
    }
}
