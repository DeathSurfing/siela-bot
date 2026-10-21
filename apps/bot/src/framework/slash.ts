import { ApplicationCommandOptionType, type ChatInputCommandInteraction } from "discord.js";

export function argsFromInteraction(interaction: ChatInputCommandInteraction): string[] {
  const args: string[] = [];
  const group = interaction.options.getSubcommandGroup(false);
  const subcommand = interaction.options.getSubcommand(false);
  if (group) args.push(group);
  if (subcommand) args.push(subcommand);

  const collect = (options: ChatInputCommandInteraction["options"]["data"]): void => {
    for (const option of options) {
      if (
        option.type === ApplicationCommandOptionType.Subcommand ||
        option.type === ApplicationCommandOptionType.SubcommandGroup
      ) {
        collect(option.options ?? []);
        continue;
      }
      const value = option.value;
      if (value === undefined || value === null) continue;
      if (typeof value === "object" && "id" in value) {
        args.push(String((value as { id: string }).id));
      } else {
        args.push(String(value));
      }
    }
  };
  collect(interaction.options.data);
  return args;
}

export function rawArgsFromInteraction(interaction: ChatInputCommandInteraction): string {
  return argsFromInteraction(interaction).join(" ");
}
