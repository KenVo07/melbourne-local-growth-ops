import {
  assertWebsiteProfileTemplateConsistency,
  WebsiteProfileContractError,
} from "@melbourne-local-growth-ops/templates";
import { validateWebsiteProfileContent } from "@melbourne-local-growth-ops/site-core";
import { describe, expect, it } from "vitest";

import { retailerProfileContent } from "../../../fixtures/web01/retailer/fixtures";

describe("RETAILER profile content strict validation and completeness", () => {
  it("accepts a complete, valid retailer profile", () => {
    const result = validateWebsiteProfileContent(
      retailerProfileContent("client-a"),
    );

    expect(result.success).toBe(true);
  });

  it("requires every mandatory retailer section", () => {
    for (const required of [
      "COLLECTIONS",
      "PRODUCTS",
      "POLICIES",
      "HOURS",
      "LOCATION",
      "STORY",
      "ACTIONS",
    ]) {
      const profile = retailerProfileContent("client-a");
      profile.sections = profile.sections.filter(
        (section) => section.type !== required,
      );

      const result = validateWebsiteProfileContent(profile);

      expect(result.success, `missing ${required} must fail`).toBe(false);
    }
  });

  it("rejects an unknown field anywhere in the strict schema", () => {
    const profile = retailerProfileContent("client-a") as Record<
      string,
      unknown
    >;
    profile.discountCode = "SAVE10";

    const result = validateWebsiteProfileContent(profile);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues).toContainEqual({
      code: "UNKNOWN_FIELD",
      path: ["discountCode"],
      message: "Unknown field: discountCode",
    });
  });

  it("rejects duplicate section IDs", () => {
    const profile = retailerProfileContent("client-a");
    const [firstSection] = profile.sections;
    if (firstSection === undefined) throw new Error("Fixture requires sections.");
    profile.sections = [...profile.sections, firstSection];

    const result = validateWebsiteProfileContent(profile);

    expect(result.success).toBe(false);
  });

  it("rejects the wrong archetype for the RETAILER profile", () => {
    const profile = retailerProfileContent("client-a") as Record<
      string,
      unknown
    >;
    profile.archetype = "SERVICE_LED";

    const result = validateWebsiteProfileContent(profile);

    expect(result.success).toBe(false);
  });

  it("rejects a brand pairing that fails WCAG AA contrast", () => {
    const profile = retailerProfileContent("client-a");
    profile.brand = {
      ...profile.brand,
      accentColor: "#dddddd",
      accentContrastColor: "#eeeeee",
    };

    const result = validateWebsiteProfileContent(profile);

    expect(result.success).toBe(false);
  });

  it("is exclusively bound to the frozen retailer template contract", () => {
    const profile = validateWebsiteProfileContent(
      retailerProfileContent("client-a"),
    );
    if (!profile.success) throw new Error("Fixture must be valid.");

    expect(
      assertWebsiteProfileTemplateConsistency(profile.data, {
        templateId: "retailer",
        templateVersion: "1.0.0",
      }),
    ).toEqual({
      profile: "RETAILER",
      archetype: "CATALOGUE_LED",
      template: { templateId: "retailer", templateVersion: "1.0.0" },
    });

    expect(() =>
      assertWebsiteProfileTemplateConsistency(profile.data, {
        templateId: "restaurant",
        templateVersion: "1.0.0",
      }),
    ).toThrowError(WebsiteProfileContractError);
  });
});
