import type { CommandMetadata } from "@siela/shared";
import type { Command } from "./types.js";

export class CommandRegistry {
  private readonly commands = new Map<string, Command>();
  private readonly aliases = new Map<string, string>();

  register(...commands: Command[]): this {
    for (const command of commands) {
      if (this.commands.has(command.name)) {
        throw new Error(`Duplicate command: ${command.name}`);
      }
      this.commands.set(command.name, command);
      for (const alias of command.aliases ?? []) {
        if (this.commands.has(alias) || this.aliases.has(alias)) {
          throw new Error(`Duplicate command alias: ${alias}`);
        }
        this.aliases.set(alias, command.name);
      }
    }
    return this;
  }

  get(name: string): Command | undefined {
    const key = name.toLowerCase();
    const direct = this.commands.get(key);
    if (direct) return direct;
    const canonical = this.aliases.get(key);
    return canonical ? this.commands.get(canonical) : undefined;
  }

  all(): Command[] {
    return [...this.commands.values()];
  }

  metadata(): CommandMetadata[] {
    return this.all().map((command) => ({
      name: command.name,
      aliases: command.aliases ?? [],
      category: command.category,
      description: command.description,
      usage: command.usage,
      examples: command.examples ?? [],
      adminOnly: command.adminOnly ?? false,
      nsfw: command.nsfw ?? false,
      cooldownMs: command.cooldownMs ?? 0,
      slash: Boolean(command.slash),
    }));
  }

  slashCommands() {
    return this.all()
      .map((command) => command.slash)
      .filter((builder): builder is NonNullable<typeof builder> => Boolean(builder));
  }
}
