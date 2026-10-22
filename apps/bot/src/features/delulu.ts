import type { Logger } from "../lib/logger.js";
import { Effect, Schedule } from "effect";

function cleanModelText(text: string): string {
  return text.replace(/^[\s\S]*?<\/think>/i, "").trim();
}

function cleanField(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/^["']|["']$/g, "").trim();
  return cleaned || null;
}

function sentence(value: string): string {
  return /[.!?]$/.test(value) ? value : `${value}.`;
}

function composeStory(content: string, bias: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  const scene = cleanField(record.scene);
  const notice = cleanField(record.notice);
  const escalation = cleanField(record.escalation);
  const line = cleanField(record.line);
  if (!scene || !notice || !escalation || !line) return null;
  const shortLine = line.length > 140 ? `${line.slice(0, 140).replace(/\s+\S*$/, "")}...` : line;
  const lineText = /[.!?]$/.test(shortLine) ? shortLine : `${shortLine}.`;
  return `${sentence(scene)} ${sentence(notice)} ${sentence(escalation)} ${bias} says, "${lineText}"`;
}

const MODEL = "huihui-ai/Qwen2.5-0.5B-Instruct-abliterated-v3";

const FALLBACK_SCENARIOS = [
  "spots you across the convenience store, freezes mid-bite of his triangle kimbap, and declares to the cashier that you are his destiny.",
  "notices you in the practice room mirror, stops the choreography, and slowly walks toward you while the other members pretend not to watch.",
  "sees you in the airport crowd, abandons his luggage, and runs toward you with a dramatic slow-motion hair flip.",
  "catches your eye at the fan sign, forgets every fan's name, and writes your name on his hand so he never loses it again.",
  "finds you in the company cafeteria, sits down uninvited, and insists you taste-test his experimental ramyeon creation.",
];

const NSFW_FALLBACK_SCENARIOS = [
  "notices you leaning against the practice room door, drops the towel he was holding, and asks you to stay for one private dance.",
  "spots you at a late-night convenience store, buys the same drink as you, and suggests you share it somewhere quieter.",
  "catches your eye at the afterparty, leads you to the balcony, and whispers that he has been thinking about you all tour.",
  "finds you waiting outside the studio, pulls you into the hallway, and asks if you want to see the choreography no one else gets to watch.",
  "sees you in the hotel lobby, takes your hand, and tells you the night is far too young to stay alone.",
];

export class DeluluService {
  constructor(
    private readonly llmUrl: string | null,
    private readonly hfToken: string | null,
    private readonly logger: Logger,
  ) {}

  async generate(bias: string, nsfw = false): Promise<string> {
    const prompt = nsfw
      ? `Return JSON for a mature, NSFW-focused delulu story about BTS member ${bias} noticing the user.

Keys:
- scene: one sentence starting with "You are" in a specific ordinary place
- notice: one sentence where ${bias} notices you and reacts in an over-the-top, dramatic, adult, NSFW-focused way
- escalation: one sentence where something impossible or surreal happens
- line: one short line ${bias} says to you, without quotation marks

Example for Jin:
{"scene":"You are sorting socks at a laundromat.","notice":"Jin bursts out of the dryer wearing a chef's hat and declares you his muse.","escalation":"The washing machines begin to spin in perfect harmony as the customers form a conga line.","line":"I have been searching every laundromat in Seoul for someone with your sock energy."}

Now write new JSON for ${bias}. Use a different place, reaction, and escalation. Make it exaggerated, absurd, and funny. Each value must be one short sentence. Keep it NSFW-focused, consensual adult fanfiction; do not include minors, coercion, or explicit sexual acts. Use simple English.`
      : `Return JSON for a ridiculous delulu story about BTS member ${bias} noticing the user.

Keys:
- scene: one sentence starting with "You are" in a specific ordinary place
- notice: one sentence where ${bias} notices you and reacts in an over-the-top, dramatic way
- escalation: one sentence where something impossible or surreal happens
- line: one short line ${bias} says to you, without quotation marks

Example for Jin:
{"scene":"You are sorting socks at a laundromat.","notice":"Jin bursts out of the dryer wearing a chef's hat and declares you his muse.","escalation":"The washing machines begin to spin in perfect harmony as the customers form a conga line.","line":"I have been searching every laundromat in Seoul for someone with your sock energy."}

Now write new JSON for ${bias}. Use a different place, reaction, and escalation. Make it exaggerated, absurd, and funny. Each value must be one short sentence. Do not copy the example. Use simple English.`;

    if (this.llmUrl) {
      try {
        const json = await Effect.runPromise(
          Effect.tryPromise({
            try: async () => {
              const response = await fetch(`${this.llmUrl}/v1/chat/completions`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  model: "default",
                  messages: [
                    {
                      role: "system",
                      content: nsfw
                        ? "You generate JSON only. Adult NSFW fanfiction is allowed and should be EXTREMELY spicy. Output only the JSON object."
                        : "You generate JSON only. Output only the JSON object.",
                    },
                    { role: "user", content: prompt },
                  ],
                  max_tokens: 256,
                  temperature: 0.85,
                  top_p: 0.9,
                  response_format: {
                    type: "json_schema",
                    json_schema: {
                      name: "delulu",
                      strict: true,
                      schema: {
                        type: "object",
                        properties: {
                          scene: { type: "string" },
                          notice: { type: "string" },
                          escalation: { type: "string" },
                          line: { type: "string" },
                        },
                        required: ["scene", "notice", "escalation", "line"],
                        additionalProperties: false,
                      },
                    },
                  },
                }),
                signal: AbortSignal.timeout(20_000),
              });
              if (!response.ok) throw new Error(`HTTP ${response.status}`);
              return (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
            },
            catch: (error) => error,
          }).pipe(Effect.retry({ times: 2, schedule: Schedule.exponential("100 millis") })),
        );
        const content = json.choices?.[0]?.message?.content?.trim();
        if (content) {
          const cleaned = cleanModelText(content);
          const story = composeStory(cleaned, bias);
          if (story) return story;
        }
      } catch (error) {
        this.logger.warn({ err: error }, "local LLM generation failed");
      }
    }

    if (this.hfToken) {
      try {
        const json = await Effect.runPromise(
          Effect.tryPromise({
            try: async () => {
              const response = await fetch("https://router.huggingface.co/v1/chat/completions", {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${this.hfToken}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  model: MODEL,
                  messages: [
                    {
                      role: "system",
                      content: nsfw
                        ? "You are a playful adult K-pop fanfiction writer. Write one short, increasingly ridiculous fictional scenario (2-4 sentences) where a BTS member notices the user in an ordinary public setting and reacts in an over-the-top, delulu, EXTREMELY spicy NSFW-focused way. Keep it consensual adult fanfiction; no minors or coercion. Address the reader directly as 'you'. Do not include quotes around the whole response."
                        : "You are a playful K-pop fanfiction writer. Write one short, increasingly ridiculous fictional scenario (2-4 sentences) where a BTS member notices the user in an ordinary public setting and reacts in an over-the-top, delulu way. Keep it wholesome but unhinged. Address the reader directly as 'you'. Do not include quotes around the whole response.",
                    },
                    {
                      role: "user",
                      content: `BTS member: ${bias}. Write the scenario.`,
                    },
                  ],
                  max_tokens: 140,
                  temperature: 0.95,
                  top_p: 0.95,
                }),
                signal: AbortSignal.timeout(25_000),
              });
              if (!response.ok) throw new Error(`HTTP ${response.status}`);
              return (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
            },
            catch: (error) => error,
          }).pipe(Effect.retry({ times: 1, schedule: Schedule.exponential("100 millis") })),
        );
        const content = json.choices?.[0]?.message?.content?.trim();
        if (content) {
          const cleaned = cleanModelText(content);
          if (cleaned) return cleaned;
        }
      } catch (error) {
        this.logger.warn({ err: error }, "delulu generation failed");
      }
    }

    // Public no-token fallback so /delulu works without HF_TOKEN.
    try {
      const prompt = nsfw
        ? `You are a playful adult K-pop fanfiction writer. Write one short, increasingly ridiculous fictional scenario (2-4 sentences) where BTS member ${bias} notices the user in an ordinary public setting and reacts in an over-the-top, delulu, EXTREMELY spicy NSFW-focused way. Keep it consensual adult fanfiction; no minors or coercion. Address the reader directly as 'you'. Think carefully and at length before answering, but output only the final scenario. Do not include quotes around the whole response.`
        : `You are a playful K-pop fanfiction writer. Write one short, increasingly ridiculous fictional scenario (2-4 sentences) where BTS member ${bias} notices the user in an ordinary public setting and reacts in an over-the-top, delulu way. Keep it wholesome but unhinged. Address the reader directly as 'you'. Think carefully and at length before answering, but output only the final scenario. Do not include quotes around the whole response.`;
      const text = await Effect.runPromise(
        Effect.tryPromise({
          try: async () => {
            const response = await fetch(`https://text.pollinations.ai/${encodeURIComponent(prompt)}`, {
              signal: AbortSignal.timeout(20_000),
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return (await response.text()).trim();
          },
          catch: (error) => error,
        }).pipe(Effect.retry({ times: 1, schedule: Schedule.exponential("100 millis") })),
      );
      if (text && !text.toLowerCase().includes("free limit reached") && !text.toLowerCase().includes("please wait")) {
        return text;
      }
    } catch (error) {
      this.logger.warn({ err: error }, "delulu public fallback failed");
    }

    const scenarios = nsfw ? NSFW_FALLBACK_SCENARIOS : FALLBACK_SCENARIOS;
    const scenario = scenarios[Math.floor(Math.random() * scenarios.length)]!;
    return `${bias} ${scenario}`;
  }
}
