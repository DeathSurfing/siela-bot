import { styleMessage } from "../../features/ui.js";
import { randomUUID } from "node:crypto";
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  SlashCommandBuilder,
} from "discord.js";
import type { Command, CommandContext } from "../../framework/types.js";
import { attachConfirmation, card, confirmCard } from "../../features/ui.js";
import { generateFamilyTreeCard } from "../../features/familyCard.js";
import { ServiceUnavailableError } from "../../lib/errors.js";

function normalizeId(value: string | undefined): string | undefined {
  return value?.replace(/^<@!?|>$/g, "");
}

async function resolveMember(ctx: CommandContext, value: string | undefined) {
  const id = normalizeId(value);
  if (!id) return null;
  return ctx.guild.members.fetch(id).catch(() => null);
}

async function requestConsent(
  ctx: CommandContext,
  target: { id: string; displayName: string },
  action: string,
): Promise<boolean> {
  const requestId = randomUUID().slice(0, 8);
  const approveId = `family:consent:${action}:approve:${ctx.author.id}:${target.id}:${requestId}`;
  const rejectId = `family:consent:${action}:reject:${ctx.author.id}:${target.id}:${requestId}`;
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(approveId).setLabel("Approve").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(rejectId).setLabel("Reject").setStyle(ButtonStyle.Danger),
  );

  const expiresAt = Math.floor((Date.now() + 15_000) / 1000);
  const message = await ctx.reply({
    ...card({ theme: "social",
      title: "Consent needed",
      body: `<@${target.id}>, **${ctx.member.displayName}** wants to ${action} you.\n\n-# Expires <t:${expiresAt}:R>`,
      rows: [row],
    }),
    allowedMentions: { users: [target.id] },
  });
  if (!message) return false;

  return new Promise<boolean>((resolve) => {
    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 15_000,
    });

    collector.on("collect", async (interaction) => {
      if (interaction.user.id !== target.id) {
        await interaction.reply(styleMessage({ content: "This request is not for you.", ephemeral: true })).catch(() => undefined);
        return;
      }
      const approved = interaction.customId.includes(":approve:");
      await interaction.deferUpdate().catch(() => undefined);
      collector.stop(approved ? "approved" : "rejected");
    });

    collector.on("end", async (_collected, reason) => {
      const approved = reason === "approved";
      try {
        if (approved) {
          await message.edit(styleMessage(card({ theme: "social", title: "Approved", body: `${target.displayName} approved the request.` })));
        } else if (reason === "rejected") {
          await message.edit(styleMessage(card({ theme: "social", title: "Rejected", body: `${target.displayName} rejected the request.` })));
        } else {
          await message.edit(styleMessage(card({ theme: "social", title: "Timed out", body: `${target.displayName} did not respond in time.` })));
        }
      } catch {
        // ignore edit failures
      }
      resolve(approved);
    });
  });
}

export const marryCommand: Command = {
  name: "marry",
  category: "social",
  description: "Marry another member and link your family trees.",
  usage: "<user>",
  examples: ["marry @user"],
  cooldownMs: 5_000,
  slash: new SlashCommandBuilder()
    .setName("marry")
    .setDescription("Marry a member")
    .addUserOption((option) => option.setName("user").setDescription("Member").setRequired(true)),
  async execute(ctx: CommandContext) {
    const target = await resolveMember(ctx, ctx.args[0]);
    if (!target || target.user.bot || target.id === ctx.author.id) {
      await ctx.reply({ content: "Choose a different human member.", ephemeral: true });
      return;
    }

    const existingA = await ctx.services.family.getActiveMarriage(ctx.guild.id, ctx.author.id);
    const existingB = await ctx.services.family.getActiveMarriage(ctx.guild.id, target.id);
    if (existingA) {
      await ctx.reply({ content: "You are already married.", ephemeral: true });
      return;
    }
    if (existingB) {
      await ctx.reply({ content: "That member is already married.", ephemeral: true });
      return;
    }

    const approved = await requestConsent(ctx, target, "marry");
    if (!approved) return;

    try {
      await ctx.services.family.marry(ctx.guild.id, ctx.author.id, target.id);
    } catch (error) {
      await ctx.followUp({ content: error instanceof Error ? error.message : "Marriage failed.", ephemeral: true });
      return;
    }

    await ctx.followUp(card({ theme: "social", title: "Married", body: `**${ctx.member.displayName}** married **${target.displayName}**.` }));
  },
};

export const divorceCommand: Command = {
  name: "divorce",
  category: "social",
  description: "End your current marriage.",
  usage: "",
  examples: ["divorce"],
  cooldownMs: 5_000,
  slash: new SlashCommandBuilder().setName("divorce").setDescription("Divorce your spouse"),
  async execute(ctx: CommandContext) {
    const marriage = await ctx.services.family.getActiveMarriage(ctx.guild.id, ctx.author.id);
    if (!marriage) {
      await ctx.reply({ content: "You are not currently married.", ephemeral: true });
      return;
    }
    const spouseId = marriage.spouseA === ctx.author.id ? marriage.spouseB : marriage.spouseA;
    const spouse = await ctx.guild.members.fetch(spouseId).catch(() => null);
    const spouseName = spouse?.displayName ?? spouseId;

    const confirmId = "family:divorce:confirm";
    const cancelId = "family:divorce:cancel";
    const message = await ctx.reply(
      confirmCard({
        title: "Divorce?",
        body: `**${ctx.member.displayName}** and **${spouseName}** will end their marriage.`,
        confirmId,
        cancelId,
        confirmLabel: "Divorce",
      }),
    );
    if (!message) return;

    attachConfirmation({
      message,
      userId: ctx.author.id,
      confirmId,
      cancelId,
      onConfirm: async () => {
        await ctx.services.family.divorce(ctx.guild.id, ctx.author.id);
        await ctx.followUp(card({ theme: "social", title: "Divorced", body: `**${ctx.member.displayName}** divorced **${spouseName}**.` })).catch(() => undefined);
        return card({ theme: "social", title: "Divorce finalized", body: "Your marriage has ended." });
      },
      onCancel: () => card({ theme: "social", title: "Cancelled", body: "The marriage was not changed." }),
    });
  },
};

export const adoptCommand: Command = {
  name: "adopt",
  category: "social",
  description: "Adopt a member into your family tree.",
  usage: "<user>",
  examples: ["adopt @user"],
  cooldownMs: 5_000,
  slash: new SlashCommandBuilder()
    .setName("adopt")
    .setDescription("Adopt a member")
    .addUserOption((option) => option.setName("user").setDescription("Member").setRequired(true)),
  async execute(ctx: CommandContext) {
    const target = await resolveMember(ctx, ctx.args[0]);
    if (!target || target.user.bot || target.id === ctx.author.id) {
      await ctx.reply({ content: "Choose a different human member.", ephemeral: true });
      return;
    }

    try {
      await ctx.services.family.assertCanAdopt(ctx.guild.id, ctx.author.id, target.id);
    } catch (error) {
      await ctx.reply({ content: error instanceof Error ? error.message : "Adoption failed.", ephemeral: true });
      return;
    }

    const approved = await requestConsent(ctx, target, "be adopted by you");
    if (!approved) return;

    try {
      await ctx.services.family.adopt(ctx.guild.id, ctx.author.id, target.id);
    } catch (error) {
      await ctx.followUp({ content: error instanceof Error ? error.message : "Adoption failed.", ephemeral: true });
      return;
    }

    await ctx.followUp(card({ theme: "social", title: "Adopted", body: `**${ctx.member.displayName}** adopted **${target.displayName}**.` }));
  },
};

export const runawayCommand: Command = {
  name: "runaway",
  category: "social",
  description: "Remove a family relationship by running away.",
  usage: "[user]",
  examples: ["runaway", "runaway @user"],
  cooldownMs: 5_000,
  slash: new SlashCommandBuilder()
    .setName("runaway")
    .setDescription("Run away from a family relationship")
    .addUserOption((option) => option.setName("user").setDescription("Related member").setRequired(false)),
  async execute(ctx: CommandContext) {
    if (ctx.args[0]) {
      const target = await resolveMember(ctx, ctx.args[0]);
      if (!target) {
        await ctx.reply({ content: "Member not found.", ephemeral: true });
        return;
      }

      const confirmId = "family:runaway:confirm";
      const cancelId = "family:runaway:cancel";
      const message = await ctx.reply(
        confirmCard({
          title: "Run away?",
          body: `The active parent-child relationship with **${target.displayName}** will be removed.`,
          confirmId,
          cancelId,
          confirmLabel: "Run away",
        }),
      );
      if (!message) return;

      attachConfirmation({
        message,
        userId: ctx.author.id,
        confirmId,
        cancelId,
        onConfirm: async () => {
          const removed = await ctx.services.family.runaway(ctx.guild.id, ctx.author.id, target.id);
          const noun = removed === 1 ? "family relationship" : "family relationships";
          return card({ theme: "social",
            title: "Ran away",
            body: `Ran away from ${removed} ${noun}.`,
            ephemeral: true,
          });
        },
        onCancel: () => card({ theme: "social", title: "Cancelled", body: "No family relationship was changed." }),
      });
      return;
    }

    const confirmId = "family:runaway:confirm";
    const cancelId = "family:runaway:cancel";
    const message = await ctx.reply(
      confirmCard({
        title: "Run away?",
        body: "Every parent relationship for you will be removed.",
        confirmId,
        cancelId,
        confirmLabel: "Run away",
      }),
    );
    if (!message) return;

    attachConfirmation({
      message,
      userId: ctx.author.id,
      confirmId,
      cancelId,
      onConfirm: async () => {
        const removed = await ctx.services.family.runaway(ctx.guild.id, ctx.author.id);
        const noun = removed === 1 ? "family relationship" : "family relationships";
        return card({ theme: "social",
          title: "Ran away",
          body: `Ran away from ${removed} ${noun}.`,
          ephemeral: true,
        });
      },
      onCancel: () => card({ theme: "social", title: "Cancelled", body: "No family relationship was changed." }),
    });
  },
};

export const familyTreeCommand: Command = {
  name: "familytree",
  aliases: ["tree", "family"],
  category: "social",
  description: "Show a family tree as an image.",
  usage: "[user]",
  examples: ["familytree", "familytree @user"],
  cooldownMs: 5_000,
  slash: new SlashCommandBuilder()
    .setName("familytree")
    .setDescription("Show a family tree")
    .addUserOption((option) => option.setName("user").setDescription("Root member").setRequired(false)),
  async execute(ctx: CommandContext) {
    const target = ctx.args[0] ? await resolveMember(ctx, ctx.args[0]) : null;
    const rootId = target?.id ?? ctx.author.id;
    const tree = await ctx.services.family.buildTree(ctx.guild.id, rootId, 30);
    const names = new Map<string, string>();
    await Promise.all(
      tree.nodes.map(async (id) => {
        const member = await ctx.guild.members.fetch(id).catch(() => null);
        names.set(id, member?.displayName ?? id);
      }),
    );
    let buffer: Buffer;
    try {
      buffer = await generateFamilyTreeCard(tree, names, rootId);
    } catch {
      throw new ServiceUnavailableError("Could not render the family tree.");
    }
    const attachment = new AttachmentBuilder(buffer, { name: "family-tree.png" });
    const note = tree.truncated
      ? "Marriage links connect partners, parent links point from parent to child. Truncated for size."
      : "Marriage links connect partners, parent links point from parent to child.";
    await ctx.reply({
      ...card({
        theme: "social",
        eyebrow: "THE FAMILY ARCHIVE",
        title: "Family tree",
        body: note,
        image: { name: "family-tree.png", description: "Family tree" },
        footer: false,
      }),
      files: [attachment],
    });
  },
};
