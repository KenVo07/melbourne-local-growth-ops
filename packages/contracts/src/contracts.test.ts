import { describe, expect, it } from "vitest";

import {
  validateContractBundle,
  validateWebsiteRuntimeConfig,
} from "./index.js";

const standardWebsite = {
  schemaVersion: 1,
  configurationId: "website_acme",
  configurationVersion: 1,
  clientId: "client_acme",
  entitlementId: "entitlement_website",
  deploymentId: "deployment_acme",
  display: {
    businessName: "Acme Plumbing",
    locationIds: ["location_melbourne"],
  },
  domains: [{ hostname: "acme.example", canonical: true }],
  modules: [],
  connectors: [],
  configuredInfrastructure: [],
};

const websiteWithRepresentativeTypes = {
  ...standardWebsite,
  modules: [
    {
      schemaVersion: 1,
      moduleId: "module_lead_form",
      type: "LEAD_FORM",
      connectorId: "connector_email",
      fields: ["NAME", "EMAIL", "MESSAGE"],
    },
    {
      schemaVersion: 1,
      moduleId: "module_booking",
      type: "BOOKING_CTA",
      connectorId: "connector_booking",
      label: "Book now",
    },
    {
      schemaVersion: 1,
      moduleId: "module_analytics",
      type: "ANALYTICS",
      connectorId: "connector_analytics",
    },
  ],
  connectors: [
    {
      schemaVersion: 1,
      connectorId: "connector_email",
      type: "EMAIL_DELIVERY",
      provider: "RESEND",
      fromAddress: "leads@acme.example",
      recipientAddresses: ["owner@acme.example"],
      secretReferenceId: "secret_email",
      accountOwner: "AGENCY",
      portability: "TRANSFERABLE",
    },
    {
      schemaVersion: 1,
      connectorId: "connector_booking",
      type: "BOOKING_LINK",
      bookingUrl: "https://booking.example/acme",
      accountOwner: "CLIENT",
      portability: "CLIENT_OWNED",
    },
    {
      schemaVersion: 1,
      connectorId: "connector_analytics",
      type: "GOOGLE_ANALYTICS_4",
      measurementId: "G-ABC123DEF4",
      accountOwner: "CLIENT",
      portability: "CLIENT_OWNED",
    },
  ],
};

function makeBundle(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    clients: [
      {
        schemaVersion: 1,
        clientId: "client_acme",
        displayName: "Acme Plumbing",
      },
    ],
    businesses: [
      {
        schemaVersion: 1,
        businessId: "business_acme",
        clientId: "client_acme",
        legalName: "Acme Plumbing Pty Ltd",
      },
    ],
    locations: [
      {
        schemaVersion: 1,
        locationId: "location_melbourne",
        businessId: "business_acme",
        name: "Melbourne",
        timezone: "Australia/Melbourne",
        address: {
          line1: "1 Example Street",
          locality: "Melbourne",
          region: "VIC",
          postalCode: "3000",
          countryCode: "AU",
        },
      },
    ],
    entitlements: [
      {
        schemaVersion: 1,
        entitlementId: "entitlement_website",
        clientId: "client_acme",
        capability: "WEBSITE_LEAD_SYSTEMS",
        status: "ACTIVE",
      },
    ],
    commercialContractReferences: [],
    websiteConfigurations: [standardWebsite],
    serviceConfigurations: [],
    deployments: [
      {
        schemaVersion: 1,
        deploymentId: "deployment_acme",
        clientId: "client_acme",
        websiteConfigurationId: "website_acme",
        deliveryMode: "MANAGED_ISOLATED",
        operationalOwner: "AGENCY",
        hostingAccountOwner: "AGENCY",
        sourceRepositoryOwner: "AGENCY",
        domainOwner: "CLIENT",
        privateAgencyRepositoryDependency: true,
        secretReferences: [],
      },
    ],
    ...overrides,
  };
}

describe("website runtime configuration", () => {
  it("accepts a standard isolated website without optional infrastructure", () => {
    expect(validateWebsiteRuntimeConfig(standardWebsite)).toEqual({
      success: true,
      data: standardWebsite,
    });
  });

  it("accepts all representative strict module and connector types", () => {
    expect(validateWebsiteRuntimeConfig(websiteWithRepresentativeTypes).success)
      .toBe(true);
  });

  it("rejects unknown fields and unknown module types", () => {
    const unknownField = validateWebsiteRuntimeConfig({
      ...standardWebsite,
      unexpected: true,
    });
    expect(unknownField).toMatchObject({
      success: false,
      issues: [{ code: "UNKNOWN_FIELD", path: ["unexpected"] }],
    });

    const unknownType = validateWebsiteRuntimeConfig({
      ...standardWebsite,
      modules: [
        {
          schemaVersion: 1,
          moduleId: "module_unknown",
          type: "CUSTOM",
          connectorId: "connector_email",
        },
      ],
    });
    expect(unknownType.success).toBe(false);

    const commercialState = validateWebsiteRuntimeConfig({
      ...standardWebsite,
      commercialContractReferenceId: "contract_acme",
    });
    expect(commercialState).toMatchObject({
      success: false,
      issues: [
        {
          code: "UNKNOWN_FIELD",
          path: ["commercialContractReferenceId"],
        },
      ],
    });
  });

  it("requires configured infrastructure to equal module and connector dependencies", () => {
    const missing = validateWebsiteRuntimeConfig({
      ...standardWebsite,
      modules: [
        {
          schemaVersion: 1,
          moduleId: "module_lead_form",
          type: "LEAD_FORM",
          connectorId: "connector_email",
          fields: ["EMAIL"],
          infrastructureDependencies: ["DATABASE"],
        },
      ],
      connectors: [
        {
          schemaVersion: 1,
          connectorId: "connector_email",
          type: "EMAIL_DELIVERY",
          provider: "RESEND",
          fromAddress: "leads@acme.example",
          recipientAddresses: ["owner@acme.example"],
          secretReferenceId: "secret_email",
          accountOwner: "AGENCY",
          portability: "TRANSFERABLE",
          infrastructureDependencies: ["OBJECT_STORAGE"],
        },
      ],
    });
    expect(missing).toMatchObject({
      success: false,
      issues: [{ code: "INFRASTRUCTURE_DEPENDENCY_MISMATCH" }],
    });

    const exact = validateWebsiteRuntimeConfig({
      ...standardWebsite,
      modules: [
        {
          schemaVersion: 1,
          moduleId: "module_lead_form",
          type: "LEAD_FORM",
          connectorId: "connector_email",
          fields: ["EMAIL"],
          infrastructureDependencies: ["DATABASE"],
        },
      ],
      connectors: [
        {
          schemaVersion: 1,
          connectorId: "connector_email",
          type: "EMAIL_DELIVERY",
          provider: "RESEND",
          fromAddress: "leads@acme.example",
          recipientAddresses: ["owner@acme.example"],
          secretReferenceId: "secret_email",
          accountOwner: "AGENCY",
          portability: "TRANSFERABLE",
          infrastructureDependencies: ["OBJECT_STORAGE"],
        },
      ],
      configuredInfrastructure: [
        { kind: "DATABASE", provider: "SUPABASE", accountOwner: "AGENCY" },
        {
          kind: "OBJECT_STORAGE",
          provider: "SUPABASE",
          accountOwner: "AGENCY",
        },
      ],
    });
    expect(exact.success).toBe(true);

    const surplus = validateWebsiteRuntimeConfig({
      ...standardWebsite,
      configuredInfrastructure: [
        { kind: "DATABASE", provider: "SUPABASE", accountOwner: "AGENCY" },
      ],
    });
    expect(surplus).toMatchObject({
      success: false,
      issues: [{ code: "INFRASTRUCTURE_DEPENDENCY_MISMATCH" }],
    });
  });

  it("rejects a module wired to the wrong connector type", () => {
    const result = validateWebsiteRuntimeConfig({
      ...standardWebsite,
      modules: [
        {
          schemaVersion: 1,
          moduleId: "module_booking",
          type: "BOOKING_CTA",
          connectorId: "connector_analytics",
          label: "Book",
        },
      ],
      connectors: [
        {
          schemaVersion: 1,
          connectorId: "connector_analytics",
          type: "GOOGLE_ANALYTICS_4",
          measurementId: "G-ABC123DEF4",
          accountOwner: "CLIENT",
          portability: "CLIENT_OWNED",
        },
      ],
    });
    expect(result).toMatchObject({
      success: false,
      issues: [{ code: "CONNECTOR_TYPE_MISMATCH" }],
    });
  });
});

describe("aggregate contracts", () => {
  it("accepts no handoff, planned, in-progress, and completed states", () => {
    expect(validateContractBundle(makeBundle()).success).toBe(true);

    for (const status of ["PLANNED", "IN_PROGRESS"] as const) {
      const deployment = {
        ...makeBundle().deployments[0],
        handoff: { status, targetOwner: "CLIENT" },
      };
      expect(
        validateContractBundle(makeBundle({ deployments: [deployment] }))
          .success,
      ).toBe(true);
    }

    const completedWebsite = {
      ...standardWebsite,
      connectors: [],
      configuredInfrastructure: [],
    };
    const completedDeployment = {
      ...makeBundle().deployments[0],
      deliveryMode: "CLIENT_HANDOFF",
      operationalOwner: "CLIENT",
      hostingAccountOwner: "CLIENT",
      sourceRepositoryOwner: "CLIENT",
      privateAgencyRepositoryDependency: false,
      handoff: {
        status: "COMPLETED",
        targetOwner: "CLIENT",
        completedAt: "2026-07-28T00:00:00.000Z",
      },
    };
    expect(
      validateContractBundle(
        makeBundle({
          websiteConfigurations: [completedWebsite],
          deployments: [completedDeployment],
        }),
      ).success,
    ).toBe(true);
  });

  it("rejects invalid handoff delivery and ownership combinations", () => {
    const noHandoff = {
      ...makeBundle().deployments[0],
      deliveryMode: "CLIENT_HANDOFF",
    };
    expect(
      validateContractBundle(makeBundle({ deployments: [noHandoff] })),
    ).toMatchObject({
      success: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "DELIVERY_HANDOFF_MISMATCH" }),
      ]),
    });

    const premature = {
      ...makeBundle().deployments[0],
      deliveryMode: "CLIENT_HANDOFF",
      operationalOwner: "CLIENT",
      hostingAccountOwner: "CLIENT",
      sourceRepositoryOwner: "CLIENT",
      privateAgencyRepositoryDependency: false,
      handoff: { status: "IN_PROGRESS", targetOwner: "CLIENT" },
    };
    expect(
      validateContractBundle(makeBundle({ deployments: [premature] })),
    ).toMatchObject({
      success: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "DELIVERY_HANDOFF_MISMATCH" }),
      ]),
    });

    const completedButManaged = {
      ...makeBundle().deployments[0],
      handoff: {
        status: "COMPLETED",
        targetOwner: "CLIENT",
        completedAt: "2026-07-28T00:00:00.000Z",
      },
    };
    expect(
      validateContractBundle(
        makeBundle({ deployments: [completedButManaged] }),
      ),
    ).toMatchObject({
      success: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "DELIVERY_HANDOFF_MISMATCH" }),
      ]),
    });
  });

  it("rejects completed handoffs with agency secrets or non-portable connectors", () => {
    const website = {
      ...standardWebsite,
      connectors: [
        {
          schemaVersion: 1,
          connectorId: "connector_email",
          type: "EMAIL_DELIVERY",
          provider: "RESEND",
          fromAddress: "leads@acme.example",
          recipientAddresses: ["owner@acme.example"],
          secretReferenceId: "secret_email",
          accountOwner: "AGENCY",
          portability: "AGENCY_MANAGED",
        },
      ],
    };
    const deployment = {
      ...makeBundle().deployments[0],
      deliveryMode: "CLIENT_HANDOFF",
      operationalOwner: "CLIENT",
      hostingAccountOwner: "CLIENT",
      sourceRepositoryOwner: "CLIENT",
      privateAgencyRepositoryDependency: false,
      secretReferences: [
        { secretReferenceId: "secret_email", owner: "AGENCY" },
      ],
      handoff: {
        status: "COMPLETED",
        targetOwner: "CLIENT",
        completedAt: "2026-07-28T00:00:00.000Z",
      },
    };
    const result = validateContractBundle(
      makeBundle({
        websiteConfigurations: [website],
        deployments: [deployment],
      }),
    );
    expect(result).toMatchObject({
      success: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "HANDOFF_PORTABILITY_VIOLATION" }),
        expect.objectContaining({ code: "AGENCY_SECRET_DEPENDENCY" }),
      ]),
    });
  });

  it("requires connector secret-reference metadata in the deployment record", () => {
    const website = {
      ...standardWebsite,
      connectors: [
        {
          schemaVersion: 1,
          connectorId: "connector_email",
          type: "EMAIL_DELIVERY",
          provider: "RESEND",
          fromAddress: "leads@acme.example",
          recipientAddresses: ["owner@acme.example"],
          secretReferenceId: "secret_email",
          accountOwner: "AGENCY",
          portability: "TRANSFERABLE",
        },
      ],
    };
    const result = validateContractBundle(
      makeBundle({ websiteConfigurations: [website] }),
    );
    expect(result).toMatchObject({
      success: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "REFERENCE_NOT_FOUND",
          path: [
            "websiteConfigurations",
            0,
            "connectors",
            0,
            "secretReferenceId",
          ],
        }),
      ]),
    });
  });

  it("supports Google Presence and Reputation without a website", () => {
    const entitlements = [
      {
        schemaVersion: 1,
        entitlementId: "entitlement_google",
        clientId: "client_acme",
        capability: "GOOGLE_PRESENCE",
        status: "ACTIVE",
      },
      {
        schemaVersion: 1,
        entitlementId: "entitlement_reputation",
        clientId: "client_acme",
        capability: "REPUTATION_OPERATIONS",
        status: "ACTIVE",
      },
    ];
    const serviceConfigurations = [
      {
        schemaVersion: 1,
        serviceConfigurationId: "service_google",
        type: "GOOGLE_PRESENCE",
        clientId: "client_acme",
        entitlementId: "entitlement_google",
        locationIds: ["location_melbourne"],
      },
      {
        schemaVersion: 1,
        serviceConfigurationId: "service_reputation",
        type: "REPUTATION_OPERATIONS",
        clientId: "client_acme",
        entitlementId: "entitlement_reputation",
        locationIds: ["location_melbourne"],
      },
    ];
    expect(
      validateContractBundle(
        makeBundle({
          entitlements,
          websiteConfigurations: [],
          deployments: [],
          serviceConfigurations,
        }),
      ).success,
    ).toBe(true);

    const speculative = serviceConfigurations.map((service) => ({
      ...service,
      locationIds: [...service.locationIds],
    }));
    Object.assign(speculative[0]!, { workflow: "future-automation" });
    const invalid = validateContractBundle(
      makeBundle({
        entitlements,
        websiteConfigurations: [],
        deployments: [],
        serviceConfigurations: speculative,
      }),
    );
    expect(invalid).toMatchObject({
      success: false,
      issues: [
        {
          code: "UNKNOWN_FIELD",
          path: ["serviceConfigurations", 0, "workflow"],
        },
      ],
    });
  });

  it("treats entitlement lifecycle as association data, not deployment orchestration", () => {
    const entitlements = [
      {
        ...makeBundle().entitlements[0],
        status: "CANCELLED",
      },
    ];
    expect(
      validateContractBundle(makeBundle({ entitlements })).success,
    ).toBe(true);
  });

  it("rejects a service configuration backed by the wrong capability", () => {
    const serviceConfigurations = [
      {
        schemaVersion: 1,
        serviceConfigurationId: "service_google",
        type: "GOOGLE_PRESENCE",
        clientId: "client_acme",
        entitlementId: "entitlement_reputation",
        locationIds: ["location_melbourne"],
      },
    ];
    const entitlements = [
      {
        schemaVersion: 1,
        entitlementId: "entitlement_reputation",
        clientId: "client_acme",
        capability: "REPUTATION_OPERATIONS",
        status: "ACTIVE",
      },
    ];
    expect(
      validateContractBundle(
        makeBundle({
          entitlements,
          websiteConfigurations: [],
          deployments: [],
          serviceConfigurations,
        }),
      ),
    ).toMatchObject({
      success: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "SERVICE_CAPABILITY_MISMATCH" }),
      ]),
    });
  });

  it("rejects cross-client references", () => {
    const entitlements = [
      {
        schemaVersion: 1,
        entitlementId: "entitlement_website",
        clientId: "client_other",
        capability: "WEBSITE_LEAD_SYSTEMS",
        status: "ACTIVE",
      },
    ];
    expect(
      validateContractBundle(makeBundle({ entitlements })),
    ).toMatchObject({
      success: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "REFERENCE_NOT_FOUND" }),
        expect.objectContaining({ code: "CAPABILITY_ENTITLEMENT_MISSING" }),
      ]),
    });
  });

  it("translates schema-version and format errors into stable issues", () => {
    const result = validateWebsiteRuntimeConfig({
      ...standardWebsite,
      schemaVersion: 2,
      domains: [{ hostname: "not a host", canonical: true }],
    });
    expect(result).toMatchObject({
      success: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "UNSUPPORTED_SCHEMA_VERSION",
          path: ["schemaVersion"],
        }),
        expect.objectContaining({
          code: "INVALID_FORMAT",
          path: ["domains", 0, "hostname"],
        }),
      ]),
    });
  });
});
