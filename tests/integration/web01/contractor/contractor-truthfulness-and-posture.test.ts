import { describe, expect, it } from "vitest";

import { defaultContractorProfileContent } from "../../../../packages/templates/src/profiles/contractor/contractor-profile.js";
import { validContractorConfigurationInput } from "../../../fixtures/web01/contractor/contractor-fixtures.js";

describe("Contractor Content Truthfulness & Infrastructure Posture (AC-003, AC-005)", () => {
  it("frames services and positive claims as proposed copy or verification requirements", () => {
    const servicesSection = defaultContractorProfileContent.sections.find(
      (section) => section.type === "SERVICES",
    );
    const trustSection = defaultContractorProfileContent.sections.find(
      (section) => section.type === "TRUST_SIGNALS",
    );
    const processSection = defaultContractorProfileContent.sections.find(
      (section) => section.type === "PROCESS",
    );
    const faqSection = defaultContractorProfileContent.sections.find(
      (section) => section.type === "FAQ",
    );

    expect(servicesSection).toBeDefined();
    expect(trustSection).toBeDefined();
    expect(processSection).toBeDefined();
    expect(faqSection).toBeDefined();

    if (servicesSection?.type === "SERVICES") {
      for (const item of servicesSection.items) {
        expect(item.description).toMatch(/illustrative proposed copy/i);
        expect(item.description).toMatch(/confirm|verify/i);
      }
    }

    if (trustSection?.type === "TRUST_SIGNALS") {
      expect(trustSection.disclaimer).toBeDefined();
      expect(trustSection.disclaimer).toContain("fictional demonstration profile");
      expect(trustSection.disclaimer).toContain("verification requirements only");
      for (const item of trustSection.items) {
        expect(item).toMatch(/verify|confirm|agree and approve/i);
        expect(item).toMatch(/before publishing/i);
      }
    }

    if (processSection?.type === "PROCESS") {
      for (const item of processSection.items) {
        expect(item.description).toMatch(/illustrative|proposed/i);
        expect(item.description).toMatch(/confirm|verify/i);
      }
    }

    if (faqSection?.type === "FAQ") {
      for (const item of faqSection.items) {
        expect(item.answer).toMatch(/demo|illustrative/i);
        expect(item.answer).toMatch(/confirm/i);
      }
    }
  });

  it("labels every gallery view as illustrative and not customer evidence", () => {
    const gallerySection = defaultContractorProfileContent.sections.find(
      (section) => section.type === "GALLERY",
    );

    expect(gallerySection).toBeDefined();
    if (gallerySection?.type === "GALLERY") {
      expect(gallerySection.heading).toContain("Illustrative");
      expect(gallerySection.eyebrow).toContain("Demonstration");
      for (const item of gallerySection.items) {
        expect(item.alt).toMatch(/^Illustrative/i);
        expect(item.caption).toMatch(/illustrative/i);
        expect(item.caption).toMatch(/not evidence/i);
      }
    }
  });

  it("does not describe the gallery assets as depicting a real or identifiable person (K1)", () => {
    const gallerySection = defaultContractorProfileContent.sections.find(
      (section) => section.type === "GALLERY",
    );

    expect(gallerySection).toBeDefined();
    if (gallerySection?.type === "GALLERY") {
      for (const item of gallerySection.items) {
        expect(item.alt).not.toMatch(/electrician|tradesperson|worker|person|technician/i);
        expect(item.caption).not.toMatch(/electrician|tradesperson|worker|person|technician/i);
      }
    }
  });

  it("includes explicit fictional disclosures for all testimonials", () => {
    const testimonialSection = defaultContractorProfileContent.sections.find(
      (section) => section.type === "TESTIMONIALS",
    );
    expect(testimonialSection).toBeDefined();
    if (testimonialSection?.type === "TESTIMONIALS") {
      for (const item of testimonialSection.items) {
        expect(item.disclosure).toBeDefined();
        expect(item.disclosure).toMatch(/fictional demonstration testimonial/i);
        expect(item.attribution).toMatch(/^Illustrative customer voice/);
        expect(item.quote).not.toMatch(/placeholder|testimonial copy/i);
      }
    }
  });

  it("contains no invented licence numbers, ABNs, or deceptive customer evidence", () => {
    const jsonText = JSON.stringify(defaultContractorProfileContent);
    expect(jsonText).not.toMatch(/REC\s*\d+/i);
    expect(jsonText).not.toMatch(/ABN\s*\d+/i);
    expect(jsonText).not.toMatch(/5-star/i);
    expect(jsonText).not.toMatch(/lorem ipsum/i);
    expect(jsonText).not.toMatch(/active and verified/i);
    expect(jsonText).not.toMatch(/our qualified tradespeople/i);
    expect(jsonText).not.toMatch(/in compliance with Australian Standards/i);
    expect(jsonText).not.toMatch(/we service suburban Melbourne/i);
    expect(jsonText).not.toMatch(/Project Gallery & Completed Works/i);
    expect(jsonText).not.toMatch(/Recent Projects/i);
    expect(jsonText).not.toMatch(/Placeholder review copy/i);
  });

  it("uses a truthful unconfigured phone action without a phone URL", () => {
    const actionsSection = defaultContractorProfileContent.sections.find(
      (section) => section.type === "ACTIONS",
    );
    expect(actionsSection).toBeDefined();
    if (actionsSection?.type === "ACTIONS") {
      const phoneAction = actionsSection.actions.find(
        (action) => action.kind === "PHONE",
      );
      expect(phoneAction).toBeDefined();
      expect(phoneAction?.state).toBe("NOT_CONFIGURED");
      if (phoneAction?.state === "NOT_CONFIGURED") {
        expect(phoneAction).not.toHaveProperty("href");
        expect(phoneAction.label).toMatch(/unavailable in demo/i);
        expect(phoneAction.message).toMatch(/no phone number is configured/i);
        expect(phoneAction.message).toMatch(/client-verified business number/i);
      }
    }
  });

  it("maintains an empty configuredInfrastructure array (AC-005)", () => {
    expect(validContractorConfigurationInput.configuredInfrastructure).toEqual([]);
  });

  it("adds no database, storage, auth, background jobs, or payment infrastructure", () => {
    const config = validContractorConfigurationInput;
    expect(config.configuredInfrastructure.length).toBe(0);
    const connectors = config.connectors;
    const connectorTypes = connectors.map((connector) => connector.type);
    expect(connectorTypes).not.toContain("DATABASE");
    expect(connectorTypes).not.toContain("STORAGE");
    expect(connectorTypes).not.toContain("AUTH");
    expect(connectorTypes).not.toContain("PAYMENT");
  });
});
