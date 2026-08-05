import {
  validateWebsiteConfiguration,
  validateWebsiteProfileContent,
} from "@melbourne-local-growth-ops/site-core";
import { describe, expect, it } from "vitest";

import { defaultContractorProfileContent } from "../../../../packages/templates/src/profiles/contractor/contractor-profile.js";
import {
  invalidContractorMissingTrustSignals,
  invalidContractorPoorContrastBrand,
  validContractorConfigurationInput,
} from "../../../fixtures/web01/contractor/contractor-fixtures.js";

describe("Contractor Profile Validation & Completeness (AC-002)", () => {
  it("validates the default contractor profile content successfully", () => {
    const result = validateWebsiteProfileContent(defaultContractorProfileContent);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.profile).toBe("CONTRACTOR");
      expect(result.data.archetype).toBe("SERVICE_LED");
    }
  });

  it("contains all 8 required section types for contractor profile", () => {
    const sectionTypes = defaultContractorProfileContent.sections.map(
      (section) => section.type,
    );
    const requiredSections = [
      "SERVICES",
      "TRUST_SIGNALS",
      "GALLERY",
      "PROCESS",
      "TESTIMONIALS",
      "FAQ",
      "CONTACT",
      "ACTIONS",
    ] as const;

    for (const requiredType of requiredSections) {
      expect(sectionTypes).toContain(requiredType);
    }
  });

  it("rejects contractor profile content missing a required section", () => {
    const result = validateWebsiteProfileContent(
      invalidContractorMissingTrustSignals,
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.issues.map((issue) => issue.message);
      expect(messages.some((msg) => msg.includes("TRUST_SIGNALS"))).toBe(true);
    }
  });

  it("enforces WCAG AA 4.5:1 brand color contrast ratio", () => {
    const result = validateWebsiteProfileContent(
      invalidContractorPoorContrastBrand,
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.issues.map((issue) => issue.message);
      expect(
        messages.some((msg) => msg.includes("contrast must meet WCAG AA")),
      ).toBe(true);
    }
  });

  it("validates representative contractor website configuration", () => {
    const result = validateWebsiteConfiguration(validContractorConfigurationInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.clientId).toBe("test-contractor");
      expect(result.data.configuredInfrastructure).toEqual([]);
    }
  });
});
