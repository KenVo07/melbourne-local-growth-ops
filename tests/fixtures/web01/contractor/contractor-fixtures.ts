import type { WebsiteProfileContent } from "@melbourne-local-growth-ops/site-core";
import { defaultContractorProfileContent } from "../../../../packages/templates/src/profiles/contractor/contractor-profile.js";

/**
 * Valid representative contractor profile fixture.
 */
export const validContractorProfileFixture: WebsiteProfileContent = defaultContractorProfileContent;

/**
 * Valid contractor configuration fixture with empty infrastructure posture.
 */
export const validContractorConfigurationInput = Object.freeze({
  schemaVersion: 1,
  configurationId: "configuration-test-contractor",
  configurationVersion: 1,
  clientId: "test-contractor",
  entitlementId: "entitlement-test-contractor",
  deploymentId: "deployment-test-contractor",
  display: {
    businessName: "Melbourne Metro Electrical Services",
    tagline: "Illustrative electrical-services configuration for Melbourne tests.",
    locationIds: ["location-melbourne"],
  },
  domains: [
    {
      hostname: "test-contractor.example.com.au",
      canonical: true,
    },
  ],
  modules: [
    {
      schemaVersion: 1,
      moduleId: "booking-primary",
      connectorId: "booking-primary",
      type: "BOOKING_CTA",
      label: "Request a service time",
    },
    {
      schemaVersion: 1,
      moduleId: "lead-primary",
      connectorId: "email-primary",
      type: "LEAD_FORM",
      fields: ["NAME", "EMAIL", "PHONE", "MESSAGE"],
    },
    {
      schemaVersion: 1,
      moduleId: "analytics-primary",
      connectorId: "analytics-primary",
      type: "ANALYTICS",
    },
  ],
  connectors: [
    {
      schemaVersion: 1,
      connectorId: "booking-primary",
      accountOwner: "CLIENT",
      portability: "CLIENT_OWNED",
      type: "BOOKING_LINK",
      bookingUrl: "https://test-contractor.example.com.au/book",
    },
    {
      schemaVersion: 1,
      connectorId: "email-primary",
      accountOwner: "CLIENT",
      portability: "TRANSFERABLE",
      type: "EMAIL_DELIVERY",
      provider: "RESEND",
      fromAddress: "website@test-contractor.example.com.au",
      recipientAddresses: ["owner@test-contractor.example.com.au"],
      secretReferenceId: "resend-test-contractor",
    },
    {
      schemaVersion: 1,
      connectorId: "analytics-primary",
      accountOwner: "CLIENT",
      portability: "CLIENT_OWNED",
      type: "GOOGLE_ANALYTICS_4",
      measurementId: "G-TEST123456",
    },
  ],
  configuredInfrastructure: [],
});

/**
 * Contractor profile missing required TRUST_SIGNALS section (for invalid tests).
 */
export const invalidContractorMissingTrustSignals = Object.freeze({
  ...defaultContractorProfileContent,
  sections: defaultContractorProfileContent.sections.filter(
    (section) => section.type !== "TRUST_SIGNALS",
  ),
});

/**
 * Contractor profile with failing brand contrast ratio (for invalid tests).
 */
export const invalidContractorPoorContrastBrand = Object.freeze({
  ...defaultContractorProfileContent,
  brand: {
    eyebrow: "Poor Contrast Contractor",
    accentColor: "#ffffff",
    accentContrastColor: "#ffffff", // 1:1 contrast, fails WCAG AA 4.5:1
    surfaceColor: "#ffffff",
    textColor: "#ffffff",
  },
});
