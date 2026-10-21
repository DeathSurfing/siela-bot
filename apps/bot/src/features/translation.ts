import { createHash } from "node:crypto";
import type { Client, Message } from "discord.js";
import { DEFAULTS, protectMentions, truncate } from "@siela/shared";
import { ServiceUnavailableError, UserError } from "../lib/errors.js";

export interface TranslationResult {
  original: string;
  translated: string;
  detectedSource: string | null;
  provider: string;
  cached: boolean;
}

interface LibreTranslateResponse {
  translatedText?: string;
  detectedLanguage?: { language?: string; confidence?: number };
}

export class TranslationService {
  private readonly cache = new Map<string, TranslationResult>();
  private readonly lastRequest = new Map<string, number>();

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string | undefined,
    private readonly logger: { warn: (obj: unknown, msg?: string) => void },
  ) {}

  checkRateLimit(userId: string): number {
    const now = Date.now();
    const last = this.lastRequest.get(userId) ?? 0;
    const remaining = DEFAULTS.translationCooldownMs - (now - last);
    if (remaining > 0) return remaining;
    this.lastRequest.set(userId, now);
    return 0;
  }

  async translate(text: string): Promise<TranslationResult> {
    const original = truncate(text.trim(), DEFAULTS.translationMaxChars);
    if (!original) throw new UserError("Nothing to translate", "empty_text");
    const protectedText = protectMentions(original);
    const key = createHash("sha256")
      .update(`${this.baseUrl}\u0000en\u0000${protectedText.text}`)
      .digest("hex");
    const cached = this.cache.get(key);
    if (cached) return { ...cached, original, cached: true };

    const controller = AbortSignal.timeout(10_000);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/translate`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({
          q: protectedText.text,
          source: "auto",
          target: "en",
          format: "text",
          ...(this.apiKey ? { api_key: this.apiKey } : {}),
        }),
        signal: controller,
      });
    } catch (error) {
      this.logger.warn({ err: error }, "LibreTranslate request failed");
      throw new ServiceUnavailableError("Translation service is unavailable");
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      this.logger.warn({ status: response.status, body: body.slice(0, 200) }, "LibreTranslate error");
      throw new ServiceUnavailableError("Translation service returned an error");
    }

    const data = (await response.json()) as LibreTranslateResponse;
    const translatedText = data.translatedText;
    if (!translatedText) throw new ServiceUnavailableError("Translation service returned no text");

    const result: TranslationResult = {
      original,
      translated: protectedText.restore(translatedText),
      detectedSource: data.detectedLanguage?.language ?? null,
      provider: "libretranslate",
      cached: false,
    };
    this.cache.set(key, result);
    if (this.cache.size > 500) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
    return result;
  }

  async translateMessage(client: Client, channelId: string, messageId: string): Promise<TranslationResult> {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      throw new UserError("That channel is not text-based", "invalid_channel");
    }
    const message = await channel.messages.fetch(messageId).catch(() => null);
    if (!message) throw new UserError("Message not found", "message_not_found");
    const text = this.extractText(message);
    if (!text) throw new UserError("That message has no translatable text", "no_text");
    const result = await this.translate(text);
    return { ...result, original: text };
  }

  extractText(message: Message): string {
    if (message.content?.trim()) return message.content;
    for (const embed of message.embeds) {
      if (embed.description?.trim()) return embed.description;
      if (embed.title?.trim()) return embed.title;
    }
    return "";
  }

  async health(): Promise<boolean> {
    const base = this.baseUrl.replace(/\/$/, "");
    try {
      const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(3_000) });
      if (response.ok) return true;
    } catch {
      // fall through to /languages
    }
    try {
      const response = await fetch(`${base}/languages`, { signal: AbortSignal.timeout(3_000) });
      return response.ok;
    } catch {
      return false;
    }
  }
}
