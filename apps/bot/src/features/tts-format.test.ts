import { describe, expect, it } from "vitest";
import {
  buildAttachmentUtterance,
  buildLinkUtterance,
  buildTtsUtterance,
  formatTtsBody,
  resolveDiscordMentions,
  sanitizeSpeakerName,
  sanitizeTtsText,
} from "./tts-format.js";

describe("resolveDiscordMentions", () => {
  it("resolves user mentions to display names", () => {
    const users = new Map([["989974812778696784", "Ani"]]);
    expect(resolveDiscordMentions("<@989974812778696784> rang badlu?", { users })).toBe(" Ani  rang badlu?");
    expect(resolveDiscordMentions("<@!989974812778696784> hi", { users })).toContain("Ani");
  });

  it("falls back to someone for unknown users", () => {
    expect(resolveDiscordMentions("hi <@123>", {})).toContain("someone");
  });

  it("resolves channel and role mentions", () => {
    expect(
      resolveDiscordMentions("see <#456>", { channels: new Map([["456", "chit-chat"]]) }),
    ).toContain("chit chat");
    expect(
      resolveDiscordMentions("hey <@&789>", { roles: new Map([["789", "Mods"]]) }),
    ).toContain("Mods");
    expect(resolveDiscordMentions("hi <@&1>", { roles: new Map([["1", "@everyone"]]) })).toContain(
      "everyone",
    );
  });

  it("resolves custom emoji to its name", () => {
    expect(resolveDiscordMentions("lol <:blob_dance:123>", {})).toContain("blob dance");
  });

  it("maps @everyone and @here", () => {
    expect(resolveDiscordMentions("hi @everyone", {})).toContain("everyone");
    expect(resolveDiscordMentions("hi @here", {})).toContain("everyone here");
  });
});

describe("sanitizeTtsText", () => {
  it("replaces urls with a link and flags link-only messages", () => {
    expect(sanitizeTtsText("https://example.com")).toEqual({ text: "", linkOnly: true });
    expect(sanitizeTtsText("check this https://example.com/foo")).toEqual({
      text: "check this a link",
      linkOnly: false,
    });
    expect(sanitizeTtsText("a https://a.com and http://b.com")).toEqual({
      text: "a a link and a link",
      linkOnly: false,
    });
  });

  it("strips markdown and plain @/# prefixes", () => {
    expect(sanitizeTtsText("**hello** @Ani").text).toBe("hello Ani");
    expect(sanitizeTtsText("#general meeting at 5").text).toBe("general meeting at 5");
    expect(sanitizeTtsText("`code` > quote").text).toBe("code quote");
  });

  it("keeps email-like text intact", () => {
    expect(sanitizeTtsText("mail me at foo@bar.com").text).toBe("mail me at foo@bar.com");
  });
});

describe("formatTtsBody", () => {
  it("handles a full user example", () => {
    const users = new Map([["989974812778696784", "Ani"]]);
    expect(
      formatTtsBody("@Ani rang badlu <@989974812778696784>?", { users }),
    ).toEqual({ text: "Ani rang badlu Ani?", linkOnly: false });
  });
});

describe("speaker prefix", () => {
  it("prefixes new speakers only", () => {
    expect(buildTtsUtterance("hello", "Ani", true)).toBe("Ani said, hello");
    expect(buildTtsUtterance("again", "Ani", false)).toBe("again");
  });

  it("builds link and attachment utterances", () => {
    expect(buildLinkUtterance("Ani", true)).toBe("Ani sent a link");
    expect(buildLinkUtterance("Ani", false)).toBe("sent a link");
    expect(buildAttachmentUtterance("Ani", true, "an image")).toBe("Ani sent an image");
    expect(buildAttachmentUtterance("Ani", false, "an image")).toBe("sent an image");
  });

  it("sanitizes speaker names", () => {
    expect(sanitizeSpeakerName("@Ani")).toBe("Ani");
    expect(sanitizeSpeakerName("cool-user_name")).toBe("cool user name");
  });
});
