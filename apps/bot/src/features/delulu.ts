import type { Logger } from "../lib/logger.js";

const MODEL = "huihui-ai/Qwen2.5-0.5B-Instruct-abliterated-v3";

const FALLBACK_SCENARIOS = [
  "spots you across the convenience store, freezes mid-bite of his triangle kimbap, and declares to the cashier that you are his destiny.",
  "notices you in the practice room mirror, stops the choreography, and slowly walks toward you while the other members pretend not to watch.",
  "sees you in the airport crowd, abandons his luggage, and runs toward you with a dramatic slow-motion hair flip.",
  "catches your eye at the fan sign, forgets every fan's name, and writes your name on his hand so he never loses it again.",
  "finds you in the company cafeteria, sits down uninvited, and insists you taste-test his experimental ramyeon creation.",
];

export class DeluluService {
  constructor(
    private readonly hfToken: string | null,
    private readonly logger: Logger,
  ) {}

  async generate(bias: string): Promise<string> {
    if (this.hfToken) {
      try {
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
                content:
                  "You are a playful K-pop fanfiction writer. Write one short, increasingly ridiculous fictional scenario (2-4 sentences) where a BTS member notices the user in an ordinary public setting and reacts in an over-the-top, delulu way. Keep it wholesome but unhinged. Do not include quotes around the whole response.",
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

        if (response.ok) {
          const json = (await response.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
          };
          const content = json.choices?.[0]?.message?.content?.trim();
          if (content) return content;
        } else {
          this.logger.warn({ status: response.status }, "delulu HF request failed");
        }
      } catch (error) {
        this.logger.warn({ err: error }, "delulu generation failed");
      }
    }

    // Public no-token fallback so /delulu works without HF_TOKEN.
    try {
      const prompt = `You are a playful K-pop fanfiction writer. Write one short, increasingly ridiculous fictional scenario (2-4 sentences) where BTS member ${bias} notices the user in an ordinary public setting and reacts in an over-the-top, delulu way. Keep it wholesome but unhinged. Do not include quotes around the whole response.`;
      const response = await fetch(`https://text.pollinations.ai/${encodeURIComponent(prompt)}`, {
        signal: AbortSignal.timeout(20_000),
      });
      if (response.ok) {
        const text = (await response.text()).trim();
        if (text && !text.toLowerCase().includes("free limit reached") && !text.toLowerCase().includes("please wait")) {
          return text;
        }
      }
    } catch (error) {
      this.logger.warn({ err: error }, "delulu public fallback failed");
    }

    const scenario = FALLBACK_SCENARIOS[Math.floor(Math.random() * FALLBACK_SCENARIOS.length)]!;
    return `${bias} ${scenario}`;
  }
}
