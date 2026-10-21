import { describe, expect, it } from "vitest";
import { generateWelcomeCard } from "./welcomeCard.js";

describe("generateWelcomeCard", () => {
  it("renders a PNG even when the avatar fetch fails", async () => {
    const buffer = await generateWelcomeCard({
      displayName: "Test User",
      username: "testuser",
      avatarUrl: "http://127.0.0.1:9/avatar.png",
      serverName: "Siela",
      memberCount: 42,
      message: "Welcome to the server!",
    });
    expect(buffer.length).toBeGreaterThan(100);
    expect(buffer.subarray(1, 4).toString("ascii")).toBe("PNG");
  });
});
