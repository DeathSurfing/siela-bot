import { describe, it, expect, vi } from "vitest";
import { resolveFamilyProfiles } from "./family-profiles.js";
import { generateFamilyTreeCard } from "./familyCard.js";
import { createCanvas, loadImage } from "@napi-rs/canvas";

describe("family tree profiles", () => {
  it("uses guild names and avatars, and resolves accounts that left the guild", async () => {
    const guild = { members: { cache: new Map(), fetch: vi.fn().mockImplementation(async (id) => {
      if (id !== "member") throw Error("Unknown Member");
      return { displayName: "Server nickname", user: {}, displayAvatarURL: () => "https://cdn.discordapp.com/member.png" };
    }) } };
    const client = { users: { cache: new Map(), fetch: vi.fn().mockResolvedValue({ globalName: "Former member", username: "account", displayAvatarURL: () => "https://cdn.discordapp.com/former.png" }) } };
    const result = await resolveFamilyProfiles(guild as never, client as never, ["member", "former"]);
    expect(result.names.get("member")).toBe("Server nickname");
    expect(result.names.get("former")).toBe("Former member");
    expect(result.avatars.size).toBe(2);
  });
  it("does not expose IDs when an account is unavailable", async () => {
    const manager = { cache: new Map(), fetch: vi.fn().mockRejectedValue(Error("Unknown User")) };
    const result = await resolveFamilyProfiles({ members: manager } as never, { users: manager } as never, ["123456789012345678"]);
    expect(result.names.get("123456789012345678")).toBe("Unavailable user");
  });
  it("renders downloaded avatars and tolerates failed images", async () => {
    const avatar = createCanvas(32, 32); const ctx = avatar.getContext("2d"); ctx.fillStyle = "#00ff00"; ctx.fillRect(0, 0, 32, 32);
    const bytes = avatar.toBuffer("image/png");
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url) => { if (url === "bad") throw Error("offline"); return new Response(bytes); }));
    try {
      const png = await generateFamilyTreeCard({ nodes: ["a", "b"], edges: [{ from: "a", to: "b", type: "marriage" }], truncated: false }, new Map([["a", "Alice"], ["b", "Bob"]]), "a", new Map([["a", "good"], ["b", "bad"]]));
      const image = await loadImage(png); const rendered = createCanvas(image.width, image.height); const output = rendered.getContext("2d"); output.drawImage(image, 0, 0);
      expect([...output.getImageData(84, 90, 1, 1).data]).toEqual([0, 255, 0, 255]);
      // Heart spans both sides of the connector's vertical midpoint.
      const pixels = output.getImageData(268, 80, 10, 20).data;
      expect([...pixels].some((value, index) => index % 4 === 0 && value === 236)).toBe(true);
    } finally { vi.unstubAllGlobals(); }
  });
});
