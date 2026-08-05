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

  it("interleaves the conversion module region into the ACTIONS section via sectionId 'primary' (D-C1)", () => {
    const actionsSection = defaultContractorProfileContent.sections.find(
      (section) => section.type === "ACTIONS",
    );
    expect(actionsSection).toBeDefined();
    expect(actionsSection?.sectionId).toBe("primary");
  });

  it("places the conversion block (CONTACT, ACTIONS) ahead of supporting sections so a primary action is reachable from the first screen (D-C1, D-C2)", () => {
    const sectionTypes = defaultContractorProfileContent.sections.map(
      (section) => section.type,
    );
    const contactIndex = sectionTypes.indexOf("CONTACT");
    const actionsIndex = sectionTypes.indexOf("ACTIONS");
    const servicesIndex = sectionTypes.indexOf("SERVICES");

    expect(contactIndex).toBeGreaterThanOrEqual(0);
    expect(actionsIndex).toBeGreaterThanOrEqual(0);
    expect(actionsIndex).toBeLessThan(servicesIndex);
    expect(contactIndex).toBeLessThan(servicesIndex);
  });
});
