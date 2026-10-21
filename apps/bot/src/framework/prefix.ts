export interface ParsedPrefixCommand {
  name: string;
  args: string[];
  rawArgs: string;
  usedMention: boolean;
}

export function parseArgs(input: string): string[] {
  const result: string[] = [];
  const matcher = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (const match of input.matchAll(matcher)) {
    const value = match[1] ?? match[2] ?? match[3];
    if (value !== undefined) result.push(value);
  }
  return result;
}

export function stripPrefix(content: string, prefix: string, botId: string): {
  rest: string;
  usedMention: boolean;
} | null {
  const mention = new RegExp(`^<@!?${botId}>\\s*`);
  if (mention.test(content)) {
    return { rest: content.replace(mention, "").trim(), usedMention: true };
  }
  if (prefix && content.startsWith(prefix)) {
    return { rest: content.slice(prefix.length).trim(), usedMention: false };
  }
  return null;
}

export function parsePrefixCommand(
  content: string,
  prefix: string,
  botId: string,
): ParsedPrefixCommand | null {
  const stripped = stripPrefix(content, prefix, botId);
  if (!stripped || !stripped.rest) return null;
  const tokens = parseArgs(stripped.rest);
  const name = tokens.shift()?.toLowerCase();
  if (!name) return null;
  return {
    name,
    args: tokens,
    rawArgs: stripped.rest.slice(name.length).trim(),
    usedMention: stripped.usedMention,
  };
}
