import { validateWebsiteProfileContent } from "@melbourne-local-growth-ops/site-core";
import { describe, expect, it } from "vitest";

import {
  restaurantDemoAssets,
  restaurantDemoBusinessName,
  restaurantDemoClientId,
  restaurantDemoProfileContent,
} from "./restaurant-demo-profile.js";

describe("restaurantDemoProfileContent", () => {
  it("passes strict RESTAURANT profile validation", () => {
    const result = validateWebsiteProfileContent(
      restaurantDemoProfileContent(),
    );
    expect(result.success, result.success ? "" : JSON.stringify(result.issues)).toBe(true);
  });

  it("declares every required restaurant section exactly once", () => {
    const content = restaurantDemoProfileContent();
    const types = content.sections.map((section) => section.type);
    for (const required of [
      "MENU",
      "HOURS",
      "LOCATION",
      "GALLERY",
      "STORY",
      "EVENTS",
      "ACTIONS",
    ]) {
      expect(types.filter((type) => type === required)).toHaveLength(1);
    }
    expect(new Set(content.sections.map((section) => section.sectionId)).size)
      .toBe(content.sections.length);
  });

  it("gives every menu item a truthful price and dietary tags where relevant", () => {
    const content = restaurantDemoProfileContent();
    const menu = content.sections.find((section) => section.type === "MENU");
    if (menu?.type !== "MENU") throw new Error("Fixture requires a MENU section.");
    expect(menu.categories.length).toBeGreaterThan(0);
    for (const category of menu.categories) {
      expect(category.items.length).toBeGreaterThan(0);
      for (const item of category.items) {
        expect(item.price).toMatch(/^\$\d+$/);
        expect(Array.isArray(item.dietary)).toBe(true);
      }
    }
    const dietaryTags = new Set(
      menu.categories.flatMap((category) =>
        category.items.flatMap((item) => item.dietary),
      ),
    );
    expect(dietaryTags.size).toBeGreaterThan(1);
  });

  it("declares opening hours and at least one honest exception", () => {
    const content = restaurantDemoProfileContent();
    const hours = content.sections.find((section) => section.type === "HOURS");
    if (hours?.type !== "HOURS") throw new Error("Fixture requires an HOURS section.");
    expect(hours.periods.length).toBeGreaterThan(0);
    expect(hours.exceptions.length).toBeGreaterThan(0);
  });

  it("declares a location with a generic external directions link, not an owned booking backend", () => {
    const content = restaurantDemoProfileContent();
    const location = content.sections.find((section) => section.type === "LOCATION");
    if (location?.type !== "LOCATION") throw new Error("Fixture requires a LOCATION section.");
    expect(location.location.directionsUrl).toMatch(/^https:\/\/www\.google\.com\/maps\//);
  });

  it("keeps reservation and ordering actions truthfully NOT_CONFIGURED with no backend implied", () => {
    const content = restaurantDemoProfileContent();
    const actions = content.sections.find((section) => section.type === "ACTIONS");
    if (actions?.type !== "ACTIONS") throw new Error("Fixture requires an ACTIONS section.");
    const byKind = new Map(actions.actions.map((action) => [action.kind, action]));

    const reservation = byKind.get("RESERVATION");
    expect(reservation?.state).toBe("NOT_CONFIGURED");
    if (reservation?.state === "NOT_CONFIGURED") {
      expect(reservation.message.length).toBeGreaterThan(0);
    }

    const ordering = byKind.get("ORDERING");
    expect(ordering?.state).toBe("NOT_CONFIGURED");
    if (ordering?.state === "NOT_CONFIGURED") {
      expect(ordering.message.length).toBeGreaterThan(0);
    }

    const phone = byKind.get("PHONE");
    expect(phone?.state).toBe("CONFIGURED");
    if (phone?.state === "CONFIGURED") {
      // ACMA reserves (03) 5550 xxxx for fictional use in creative works:
      // https://www.acma.gov.au/phone-numbers-use-tv-shows-films-and-creative-works
      expect(phone.href.startsWith("tel:+6135550")).toBe(true);
    }
  });

  it("keeps fictional demonstration disclosures on the story and dining-choice sections", () => {
    const content = restaurantDemoProfileContent();
    const story = content.sections.find((section) => section.type === "STORY");
    const dining = content.sections.find((section) => section.sectionId === "dining-choices");
    expect(story?.type === "STORY" ? story.body : "").toContain("fictional");
    expect(
      dining?.type === "TRUST_SIGNALS" ? dining.disclaimer ?? "" : "",
    ).toContain("fictional");
  });

  it("resolves every gallery assetId against the declared portable asset list, without repeating the hero image", () => {
    const content = restaurantDemoProfileContent();
    const gallery = content.sections.find((section) => section.type === "GALLERY");
    if (gallery?.type !== "GALLERY") throw new Error("Fixture requires a GALLERY section.");
    const knownAssetIds = new Set(restaurantDemoAssets.map((asset) => asset.assetId));
    for (const item of gallery.items) {
      expect(knownAssetIds.has(item.assetId)).toBe(true);
      expect(item.alt.length).toBeGreaterThan(0);
    }
    expect(gallery.items.length).toBeGreaterThan(0);
    // The header hero slot already shows "hero-primary"; the gallery section
    // lists only the dedicated gallery-only photos so the same image is not
    // rendered twice once the shared hero-slot filter lands.
    expect(gallery.items.some((item) => item.assetId === "hero-primary")).toBe(false);
  });

  it("declares each portable asset with a safe id, PNG media type, and gallery-relative path", () => {
    for (const asset of restaurantDemoAssets) {
      expect(asset.sourcePath.startsWith("assets/")).toBe(true);
      expect(asset.mediaType).toBe("image/png");
      expect(asset.width).toBeGreaterThan(0);
      expect(asset.height).toBeGreaterThan(0);
    }
    const uniquePaths = new Set(restaurantDemoAssets.map((asset) => asset.sourcePath));
    expect(uniquePaths.size).toBe(restaurantDemoAssets.length);
  });

  it("declares a stable fictional business identity", () => {
    const content = restaurantDemoProfileContent();
    expect(content.profile).toBe("RESTAURANT");
    expect(restaurantDemoClientId).toBe("lantern-and-vine");
    expect(restaurantDemoBusinessName).toBe("Lantern & Vine");
  });

  it("orders the decision set — actions, menu, hours, location — immediately after the hero, ahead of supporting content (D-R1)", () => {
    const content = restaurantDemoProfileContent();
    expect(content.sections.map((section) => section.sectionId)).toEqual([
      "primary",
      "menu",
      "hours",
      "location",
      "gallery",
      "story",
      "dining-choices",
      "events",
      "faq",
    ]);
  });

});
