import type { InteractionKind } from "@siela/shared";

const GIF_ENDPOINT: Partial<Record<InteractionKind, string>> = {
  slap: "https://nekos.best/api/v2/slap",
  kiss: "https://nekos.best/api/v2/kiss",
  hug: "https://nekos.best/api/v2/hug",
};

export async function fetchInteractionGif(kind: InteractionKind): Promise<string | null> {
  const endpoint = GIF_ENDPOINT[kind];
  if (!endpoint) return null;
  try {
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(4_000) });
    if (!response.ok) return null;
    const data = (await response.json()) as { results?: Array<{ url?: string }> };
    return data.results?.[0]?.url ?? null;
  } catch {
    return null;
  }
}
