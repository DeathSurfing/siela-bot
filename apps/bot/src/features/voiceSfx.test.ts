import { describe, expect, it } from "vitest";
import { matchVoiceSfx } from "./voiceSfx.js";

describe("matchVoiceSfx", () => {
  it("matches the trigger as a whole word", () => {
    expect(matchVoiceSfx("gay")?.id).toBe("gay-echo");
    expect(matchVoiceSfx("GAY!")?.id).toBe("gay-echo");
    expect(matchVoiceSfx("that was so gay lol")?.id).toBe("gay-echo");
    expect(matchVoiceSfx("🙂 gay")?.id).toBe("gay-echo");
  });

  it("ignores longer words that contain the trigger", () => {
    expect(matchVoiceSfx("gayatri")).toBeNull();
    expect(matchVoiceSfx("gaylord")).toBeNull();
    expect(matchVoiceSfx("nogay")).toBeNull();
  });

  it("ignores messages without the trigger", () => {
    expect(matchVoiceSfx("")).toBeNull();
    expect(matchVoiceSfx("hello there")).toBeNull();
    expect(matchVoiceSfx("🙂🙂")).toBeNull();
  });
});
