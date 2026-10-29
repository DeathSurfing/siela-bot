import { describe, expect, it } from "vitest";
import {
  FEATURES,
  FEATURE_IDS,
  featureCatalogByCategory,
  featureForCommand,
  getFeature,
  isFeatureId,
  type FeatureCategory,
} from "./features.js";

describe("feature catalog", () => {
  it("has unique feature ids", () => {
    const ids = FEATURES.map((feature) => feature.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(FEATURE_IDS).size).toBe(FEATURE_IDS.length);
    expect(FEATURE_IDS).toEqual(ids);
  });

  it("assigns every command name to at most one feature", () => {
    const seen = new Map<string, string>();
    for (const feature of FEATURES) {
      for (const command of feature.commands) {
        const owner = seen.get(command);
        expect(owner, `command "${command}" is claimed by ${owner} and ${feature.id}`).toBeUndefined();
        seen.set(command, feature.id);
      }
    }
  });

  it("only depends on features that exist", () => {
    const ids = new Set(FEATURES.map((feature) => feature.id));
    for (const feature of FEATURES) {
      for (const dependency of feature.dependsOn) {
        expect(ids.has(dependency), `${feature.id} depends on missing ${dependency}`).toBe(true);
        expect(dependency).not.toBe(feature.id);
      }
    }
  });

  it("defaults every feature to enabled and gives every feature a category", () => {
    const categories: readonly FeatureCategory[] = [
      "Music",
      "Economy",
      "Relics",
      "Games",
      "Social",
      "Community",
      "Voice",
      "Automation",
    ];
    for (const feature of FEATURES) {
      expect(feature.defaultEnabled).toBe(true);
      expect(categories).toContain(feature.category);
      expect(feature.label.length).toBeGreaterThan(0);
      expect(feature.description.length).toBeGreaterThan(0);
    }
  });

  it("resolves features by id and command", () => {
    expect(getFeature("music-playback")?.label).toBe("Music playback");
    expect(getFeature("missing")).toBeUndefined();
    expect(isFeatureId("relics")).toBe(true);
    expect(isFeatureId("missing")).toBe(false);
    expect(featureForCommand("play")).toBe("music-playback");
    expect(featureForCommand("lyrics")).toBe("music-lyrics");
    expect(featureForCommand("moveall")).toBe("voice-moderation");
    expect(featureForCommand("missing")).toBeUndefined();
  });

  it("groups the catalog by category in catalog order", () => {
    const groups = featureCatalogByCategory();
    const flattened = groups.flatMap((group) => group.features.map((feature) => feature.id));
    expect(flattened).toEqual(FEATURES.map((feature) => feature.id));
    for (const group of groups) {
      expect(group.features.length).toBeGreaterThan(0);
      for (const feature of group.features) expect(feature.category).toBe(group.category);
    }
    expect(groups.map((group) => group.category)).toEqual([
      "Music",
      "Economy",
      "Relics",
      "Games",
      "Social",
      "Community",
      "Voice",
      "Automation",
    ]);
  });
});
