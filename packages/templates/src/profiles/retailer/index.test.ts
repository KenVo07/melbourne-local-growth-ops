import { validateWebsiteProfileContent } from "@melbourne-local-growth-ops/site-core";
import { describe, expect, it } from "vitest";

import {
  assertWebsiteProfileTemplateConsistency,
  websiteProfileTemplateContracts,
} from "../../profile-contracts.js";
import { createRetailerReferenceProfileContent } from "./index.js";

describe("createRetailerReferenceProfileContent", () => {
  it("produces content that satisfies the strict RETAILER schema", () => {
    const profile = createRetailerReferenceProfileContent("client-a");

    expect(profile.profile).toBe("RETAILER");
    expect(profile.archetype).toBe("CATALOGUE_LED");
    const sectionTypes = profile.sections.map(({ type }) => type);
    for (const required of [
      "COLLECTIONS",
      "PRODUCTS",
      "POLICIES",
      "HOURS",
      "LOCATION",
      "STORY",
      "ACTIONS",
    ]) {
      expect(sectionTypes).toContain(required);
    }
  });

  it("matches the frozen retailer template/archetype contract", () => {
    const profile = createRetailerReferenceProfileContent("client-a");

    expect(
      assertWebsiteProfileTemplateConsistency(profile, {
        templateId: "retailer",
        templateVersion: "1.0.0",
      }),
    ).toEqual(
      websiteProfileTemplateContracts.find(
        (contract) => contract.profile === "RETAILER",
      ),
    );
  });

  it("keeps two client instances isolated", () => {
    const clientA = createRetailerReferenceProfileContent("client-a");
    const clientB = createRetailerReferenceProfileContent("client-b");

    expect(JSON.stringify(clientA)).not.toContain("client-b");
    expect(JSON.stringify(clientB)).not.toContain("client-a");
  });

  it("rejects the content when a required section is missing", () => {
    const profile = createRetailerReferenceProfileContent("client-a");
    const withoutProducts = {
      ...profile,
      sections: profile.sections.filter(({ type }) => type !== "PRODUCTS"),
    };

    const result = validateWebsiteProfileContent(withoutProducts);

    expect(result.success).toBe(false);
  });
});
