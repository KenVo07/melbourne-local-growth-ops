import {
  validateWebsiteProfileContent,
  type WebsiteProfileContent,
} from "@melbourne-local-growth-ops/site-core";
import { describe, expect, it } from "vitest";

import {
  assertWebsiteProfileTemplateConsistency,
  websiteProfileTemplateContracts,
  WebsiteProfileContractError,
} from "./index.js";

function profileFixture(): WebsiteProfileContent {
  const result = validateWebsiteProfileContent({
    schemaVersion: 1,
    profile: "RESTAURANT",
    archetype: "HOSPITALITY_EDITORIAL",
    brand: {
      eyebrow: "Neighbourhood dining",
      accentColor: "#8f3528",
      accentContrastColor: "#ffffff",
      surfaceColor: "#fffaf1",
      textColor: "#201a17",
    },
    sections: [
      { type: "MENU", sectionId: "menu", heading: "Menu", categories: [{ name: "Dinner", items: [{ name: "Pasta", price: "$28", dietary: [] }] }] },
      { type: "HOURS", sectionId: "hours", heading: "Hours", periods: [{ days: "Tuesday–Saturday", hours: "5pm–late" }], exceptions: [] },
      { type: "LOCATION", sectionId: "location", heading: "Visit", location: { name: "Demo Restaurant", addressLines: ["1 Example Street"], locality: "Melbourne", region: "VIC", postalCode: "3000" } },
      { type: "GALLERY", sectionId: "gallery", heading: "Gallery", items: [{ assetId: "dining-room", alt: "Warm fictional dining room" }] },
      { type: "STORY", sectionId: "story", heading: "Story", body: "A clearly fictional restaurant story." },
      { type: "EVENTS", sectionId: "events", heading: "What's on", items: [{ title: "Demo dinner", description: "A fictional seasonal dinner." }] },
      { type: "ACTIONS", sectionId: "primary", heading: "Plan a visit", actions: [{ actionId: "reserve", kind: "RESERVATION", state: "NOT_CONFIGURED", label: "Reserve", message: "Online reservations are not configured. Please call the venue." }] },
    ],
  });
  if (!result.success) throw new Error("Profile fixture must be valid.");
  return result.data;
}

describe("website profile template contracts", () => {
  it("pre-registers exact stable seams for all three profiles", () => {
    expect(websiteProfileTemplateContracts).toEqual([
      { profile: "CONTRACTOR", archetype: "SERVICE_LED", template: { templateId: "contractor", templateVersion: "1.0.0" } },
      { profile: "RESTAURANT", archetype: "HOSPITALITY_EDITORIAL", template: { templateId: "restaurant", templateVersion: "1.0.0" } },
      { profile: "RETAILER", archetype: "CATALOGUE_LED", template: { templateId: "retailer", templateVersion: "1.0.0" } },
    ]);
  });

  it("accepts only the frozen matching template seam", () => {
    const profile = profileFixture();
    expect(
      assertWebsiteProfileTemplateConsistency(profile, {
        templateId: "restaurant",
        templateVersion: "1.0.0",
      }),
    ).toEqual(websiteProfileTemplateContracts[1]);

    expect(() =>
      assertWebsiteProfileTemplateConsistency(profile, {
        templateId: "contractor",
        templateVersion: "1.0.0",
      }),
    ).toThrowError(WebsiteProfileContractError);
  });
});
