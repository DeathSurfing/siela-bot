import { escapeMarkdown } from "@siela/shared";
import { card } from "./ui.js";
import type { ReplyPayload } from "../framework/types.js";

export function buildDeluluPayload(input: {
  bias: string;
  scenario: string;
  nsfw: boolean;
  cost: number;
  use: number;
}): ReplyPayload {
  const marker = `${input.bias} says,`;
  const dialogueAt = input.scenario.lastIndexOf(marker);
  const narrative = dialogueAt > 0 ? input.scenario.slice(0, dialogueAt).trim() : input.scenario.trim();
  const dialogue = dialogueAt > 0 ? input.scenario.slice(dialogueAt + marker.length).trim() : null;
  const body = [
    "-# THE SCENE",
    escapeMarkdown(narrative),
    ...(dialogue ? ["", `> **${escapeMarkdown(input.bias)}**`, `> ${escapeMarkdown(dialogue)}`] : []),
  ].join("\n");
  return card({
    theme: "social",
    eyebrow: `DELULU CLUB  /  ${input.nsfw ? "AFTER HOURS" : "YOUR MAIN-CHARACTER MOMENT"}`,
    hero: { title: `${input.bias} notices you.`, kicker: "DELULU CLUB" },
    title: "And suddenly, you’re the plot.",
    subtitle: `${input.bias} edition  ·  ${input.nsfw ? "Mature fictional scenario" : "A fictional little daydream"}`,
    body,
    footer: `A fictional story, just for fun.  ·  ${input.cost} SC  ·  Moment ${input.use}${input.nsfw ? "" : "/4 today"}`,
  });
}
