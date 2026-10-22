import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import type { Logger } from "../lib/logger.js";

const AUDIO_EXTENSIONS = new Set([".wav", ".mp3", ".flac", ".ogg"]);

const BUILTIN_VOICES: Record<string, string> = {
  jungkook: "marius",
  jimin: "jean",
  v: "charles",
  rm: "michael",
  jhope: "george",
  suga: "paul",
  jin: "javert",
};

function normalizeBias(bias: string): string {
  return bias.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export class TtsService {
  private readonly baseUrl: string | null;

  constructor(
    url: string | null,
    private readonly voicesDir: string,
    private readonly logger: Logger,
  ) {
    this.baseUrl = url ? url.replace(/\/+$/, "") : null;
  }

  private async findVoice(bias: string): Promise<{ path: string; filename: string } | null> {
    const target = normalizeBias(bias);
    let entries: string[];
    try {
      entries = await readdir(this.voicesDir);
    } catch {
      return null;
    }
    for (const filename of entries) {
      if (!AUDIO_EXTENSIONS.has(extname(filename).toLowerCase())) continue;
      const base = normalizeBias(filename.slice(0, -extname(filename).length));
      if (base === target) return { path: join(this.voicesDir, filename), filename };
    }
    return null;
  }

  private builtinVoice(bias: string): string {
    return BUILTIN_VOICES[normalizeBias(bias)] ?? "marius";
  }

  async synthesize(text: string, bias: string): Promise<Buffer | null> {
    if (!this.baseUrl) return null;
    try {
      const form = new FormData();
      form.append("text", text);
      const voice = await this.findVoice(bias);
      if (voice) {
        const data = await readFile(voice.path);
        form.append("voice_wav", new Blob([data], { type: "audio/wav" }), voice.filename);
      } else {
        form.append("voice_url", this.builtinVoice(bias));
      }

      const response = await fetch(`${this.baseUrl}/tts`, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok) {
        this.logger.warn({ status: response.status, bias }, "TTS request failed");
        return null;
      }
      const audio = Buffer.from(await response.arrayBuffer());
      return audio.length > 0 ? audio : null;
    } catch (error) {
      this.logger.warn({ err: error, bias }, "TTS generation failed");
      return null;
    }
  }
}
