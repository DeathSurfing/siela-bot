import { describe, expect, it } from "vitest";
import { scheduledEventCreateSchema, scheduledEventUpdateSchema } from "./schemas.js";

const validEvent = {
  name: " Morning music ",
  channelId: "123456789012345678",
  sourceUrl: "https://youtu.be/abcdefghijk",
  startAt: "2026-12-01T08:00:00.000Z",
  repeat: "daily",
};

describe("scheduled event schemas", () => {
  it("defaults enabled only on event creation", () => {
    expect(scheduledEventCreateSchema.parse(validEvent)).toMatchObject({ name: "Morning music", enabled: true });
    expect(scheduledEventUpdateSchema.parse({ name: " Updated " })).toEqual({ name: "Updated" });
  });

  it("keeps the update schema strict and accepts explicit enabled changes", () => {
    expect(scheduledEventUpdateSchema.parse({ enabled: false })).toEqual({ enabled: false });
    expect(scheduledEventUpdateSchema.safeParse({ name: "Event", extra: true }).success).toBe(false);
  });
});
