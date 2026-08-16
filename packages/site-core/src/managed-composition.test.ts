import { ModuleIdSchema } from "@melbourne-local-growth-ops/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  composeManagedWebsite,
  createWebsiteModuleRegistry,
  createWebsiteTemplateRegistry,
  WebsiteModulePipelineError,
  type ManagedWebsiteDefinition,
  type ValidatedWebsiteConfiguration,
  type WebsiteComposition,
  type WebsiteModuleContract,
  type WebsiteTemplate,
} from "./index.js";

interface ConfigurationOptions {
  readonly clientId: string;
  readonly bookingModuleId: string;
  readonly analyticsModuleId?: string;
}

function configurationFixture({
  clientId,
  bookingModuleId,
  analyticsModuleId,
}: ConfigurationOptions): unknown {
  const modules: unknown[] = [
    {
      schemaVersion: 1,
      moduleId: bookingModuleId,
      connectorId: `booking-${clientId}`,
      type: "BOOKING_CTA",
      label: `Book ${clientId}`,
    },
  ];
  const connectors: unknown[] = [
    {
      schemaVersion: 1,
      connectorId: `booking-${clientId}`,
      accountOwner: "CLIENT",
      portability: "CLIENT_OWNED",
      type: "BOOKING_LINK",
      bookingUrl: `https://${clientId}.example.com.au/book`,
    },
  ];

  if (analyticsModuleId !== undefined) {
    modules.push({
      schemaVersion: 1,
      moduleId: analyticsModuleId,
      connectorId: `analytics-${clientId}`,
      type: "ANALYTICS",
    });
    connectors.push({
      schemaVersion: 1,
      connectorId: `analytics-${clientId}`,
      accountOwner: "CLIENT",
      portability: "CLIENT_OWNED",
      type: "GOOGLE_ANALYTICS_4",
      measurementId: "G-ABCDEF1234",
    });
  }

  return {
    schemaVersion: 1,
    configurationId: `configuration-${clientId}`,
    configurationVersion: 3,
    clientId,
    entitlementId: `entitlement-${clientId}`,
    deploymentId: `deployment-${clientId}`,
    display: {
      businessName: `Business ${clientId}`,
      tagline: `Local service for ${clientId}`,
      locationIds: [`location-${clientId}`],
    },
    domains: [{ hostname: `${clientId}.example.com.au`, canonical: true }],
    modules,
    connectors,
    configuredInfrastructure: [],
  };
}

function moduleContract(
  type: WebsiteModuleContract["type"],
  version = "1.0.0",
  dependencies: WebsiteModuleContract["dependencies"] = [],
): WebsiteModuleContract {
  return {
    type,
    version,
    executionBoundary: "RENDER_ONLY",
    dependencies,
    portability: "TRANSFERABLE",
    analyticsEvents: [],
    fallback: {
      strategy: type === "ANALYTICS" ? "HIDE" : "ERROR",
      description: `${type} is unavailable.`,
    },
  };
}

function template(
  compose: WebsiteTemplate["compose"] = (
    configuration: ValidatedWebsiteConfiguration,
  ): WebsiteComposition => ({
    templateId: "contractor",
    templateVersion: "1.0.0",
    regions: [
      {
        regionId: "main",
        moduleIds: configuration.modules
          .filter(({ type }) => type !== "ANALYTICS")
          .map(({ moduleId }) => moduleId),
      },
      {
        regionId: "analytics",
        moduleIds: configuration.modules
          .filter(({ type }) => type === "ANALYTICS")
          .map(({ moduleId }) => moduleId),
      },
    ],
  }),
): WebsiteTemplate {
  return {
    templateId: "contractor",
    version: "1.0.0",
    compose,
  };
}

function definition(
  configuration: unknown,
  modules: ManagedWebsiteDefinition["modules"] = [
    { type: "BOOKING_CTA", moduleVersion: "1.0.0" },
  ],
): ManagedWebsiteDefinition {
  return {
    configuration,
    template: {
      templateId: "contractor",
      templateVersion: "1.0.0",
    },
    modules,
  };
}

function profileFixture(clientId: string): unknown {
  return {
    schemaVersion: 1,
    profile: "CONTRACTOR",
    archetype: "SERVICE_LED",
    brand: {
      eyebrow: `Local service for ${clientId}`,
      accentColor: "#174a3b",
      accentContrastColor: "#ffffff",
      surfaceColor: "#f7f4ec",
      textColor: "#17201d",
    },
    sections: [
      {
        type: "SERVICES",
        sectionId: "services",
        heading: "Services",
        items: [{ title: "Repairs", description: "Local repair services." }],
      },
      {
        type: "TRUST_SIGNALS",
        sectionId: "trust",
        heading: "Trust",
        items: ["Credentials confirmed before launch"],
        disclaimer: "Fictional demonstration content.",
      },
      {
        type: "GALLERY",
        sectionId: "gallery",
        heading: "Gallery",
        items: [{ assetId: "hero-primary", alt: "Local repair service" }],
      },
      {
        type: "PROCESS",
        sectionId: "process",
        heading: "Process",
        items: [{ title: "Talk", description: "Discuss the work." }],
      },
      {
        type: "TESTIMONIALS",
        sectionId: "testimonials",
        heading: "Feedback",
        items: [
          {
            quote: "Fictional feedback.",
            attribution: "Demo customer",
            disclosure: "Fictional demonstration content.",
          },
        ],
      },
      {
        type: "FAQ",
        sectionId: "faq",
        heading: "Questions",
        items: [{ question: "How do I start?", answer: "Contact the team." }],
      },
      {
        type: "CONTACT",
        sectionId: "contact",
        heading: "Contact",
        body: "Contact the team to discuss the work.",
      },
      {
        type: "ACTIONS",
        sectionId: "primary",
        heading: "Get started",
        actions: [
          {
            actionId: "call",
            kind: "PHONE",
            state: "CONFIGURED",
            label: "Call the team",
            href: "tel:+61355500001",
          },
        ],
      },
    ],
  };
}

function experienceFixture(experienceId: string): unknown {
  return {
    schemaVersion: 1,
    experienceId,
    experienceVersion: "1.0.0",
    designDna: {
      palette: {
        accentColor: "#174a3b",
        accentContrastColor: "#ffffff",
        surfaceColor: "#f7f4ec",
        textColor: "#17201d",
      },
      typography: {
        displayFamily: "SANS",
        bodyFamily: "SANS",
        displayScale: "EXPANSIVE",
        tracking: "TIGHT",
      },
      composition: {
        heroLayout: "MEDIA_FIRST",
        navigation: "COMPACT",
        contentWidth: "WIDE",
        sectionRhythm: "EXPANSIVE",
        surfaceTreatment: "BANDED",
        sectionOrder: [
          "contact",
          "primary",
          "services",
          "trust",
          "gallery",
          "process",
          "testimonials",
          "faq",
        ],
        featuredSectionId: "services",
      },
      media: {
        heroFrame: "EDGE_TO_EDGE",
        heroFit: "COVER",
        galleryFrame: "EDITORIAL",
      },
      interaction: { actionStyle: "OUTLINE", motion: "SUBTLE" },
    },
  };
}

function registries(
  contracts: readonly WebsiteModuleContract[] = [
    moduleContract("BOOKING_CTA"),
  ],
  websiteTemplate: WebsiteTemplate = template(),
) {
  return {
    templates: createWebsiteTemplateRegistry([websiteTemplate]),
    modules: createWebsiteModuleRegistry(contracts),
  };
}

function capturePipelineError(
  operation: () => unknown,
): WebsiteModulePipelineError {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(WebsiteModulePipelineError);
    return error as WebsiteModulePipelineError;
  }

  throw new Error("Expected a WebsiteModulePipelineError");
}

describe("composeManagedWebsite", () => {
  it("resolves validated modules, connectors, order, and provenance", () => {
    const result = composeManagedWebsite(
      definition(
        configurationFixture({
          clientId: "client-a",
          bookingModuleId: "booking-a",
          analyticsModuleId: "analytics-a",
        }),
        [
          { type: "ANALYTICS", moduleVersion: "1.0.0" },
          { type: "BOOKING_CTA", moduleVersion: "1.0.0" },
        ],
      ),
      registries([
        moduleContract("ANALYTICS"),
        moduleContract("BOOKING_CTA"),
      ]),
    );

    expect(result).toMatchObject({
      success: true,
      data: {
        template: {
          templateId: "contractor",
          templateVersion: "1.0.0",
        },
        regions: [
          {
            regionId: "main",
            modules: [
              {
                moduleId: "booking-a",
                type: "BOOKING_CTA",
                moduleVersion: "1.0.0",
                connector: { type: "BOOKING_LINK" },
              },
            ],
          },
          {
            regionId: "analytics",
            modules: [
              {
                moduleId: "analytics-a",
                type: "ANALYTICS",
                moduleVersion: "1.0.0",
                connector: { type: "GOOGLE_ANALYTICS_4" },
              },
            ],
          },
        ],
        provenance: {
          configurationId: "configuration-client-a",
          configurationVersion: 3,
          template: {
            templateId: "contractor",
            templateVersion: "1.0.0",
          },
          modules: [
            {
              moduleId: "booking-a",
              type: "BOOKING_CTA",
              moduleVersion: "1.0.0",
            },
            {
              moduleId: "analytics-a",
              type: "ANALYTICS",
              moduleVersion: "1.0.0",
            },
          ],
        },
      },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(
      JSON.stringify({
        template: result.data.provenance.template,
        modules: result.data.provenance.modules,
      }),
    ).toBe(
      '{"template":{"templateId":"contractor","templateVersion":"1.0.0"},"modules":[{"moduleId":"booking-a","type":"BOOKING_CTA","moduleVersion":"1.0.0"},{"moduleId":"analytics-a","type":"ANALYTICS","moduleVersion":"1.0.0"}]}',
    );
  });

  it("stops invalid configuration before template resolution or composition", () => {
    const compose = vi.fn<WebsiteTemplate["compose"]>();
    const result = composeManagedWebsite(
      {
        configuration: { schemaVersion: 2 },
        template: { templateId: "unknown", templateVersion: "9.0.0" },
        modules: [],
      },
      registries([moduleContract("BOOKING_CTA")], template(compose)),
    );

    expect(result.success).toBe(false);
    expect(compose).not.toHaveBeenCalled();
  });

  it("requires exactly one version selection for every configured module type", () => {
    const configuration = configurationFixture({
      clientId: "client-a",
      bookingModuleId: "booking-a",
    });

    const missing = capturePipelineError(() =>
      composeManagedWebsite(
        definition(configuration, []),
        registries(),
      ),
    );
    const duplicate = capturePipelineError(() =>
      composeManagedWebsite(
        definition(configuration, [
          { type: "BOOKING_CTA", moduleVersion: "1.0.0" },
          { type: "BOOKING_CTA", moduleVersion: "2.0.0" },
        ]),
        registries(),
      ),
    );
    const unexpected = capturePipelineError(() =>
      composeManagedWebsite(
        definition(configuration, [
          { type: "BOOKING_CTA", moduleVersion: "1.0.0" },
          { type: "ANALYTICS", moduleVersion: "1.0.0" },
        ]),
        registries([
          moduleContract("BOOKING_CTA"),
          moduleContract("ANALYTICS"),
        ]),
      ),
    );

    expect(missing.code).toBe("MISSING_MODULE_SELECTION");
    expect(duplicate.code).toBe("DUPLICATE_MODULE_SELECTION");
    expect(unexpected.code).toBe("UNEXPECTED_MODULE_SELECTION");
  });

  it("rejects module contracts incompatible with declared dependencies", () => {
    const error = capturePipelineError(() =>
      composeManagedWebsite(
        definition(
          configurationFixture({
            clientId: "client-a",
            bookingModuleId: "booking-a",
          }),
        ),
        registries([moduleContract("BOOKING_CTA", "1.0.0", ["DATABASE"])]),
      ),
    );

    expect(error).toMatchObject({
      code: "MODULE_DEPENDENCY_MISMATCH",
      type: "BOOKING_CTA",
      moduleVersion: "1.0.0",
      moduleId: "booking-a",
      expectedDependencies: ["DATABASE"],
      actualDependencies: [],
    });
  });

  it("returns shared validation issues for unsatisfied module infrastructure", () => {
    const compose = vi.fn<WebsiteTemplate["compose"]>();
    const configuration = configurationFixture({
      clientId: "client-a",
      bookingModuleId: "booking-a",
    }) as {
      modules: { infrastructureDependencies?: string[] }[];
      configuredInfrastructure: unknown[];
    };
    configuration.modules[0] = {
      ...configuration.modules[0],
      infrastructureDependencies: ["DATABASE"],
    };
    configuration.configuredInfrastructure = [];

    const result = composeManagedWebsite(
      definition(configuration),
      registries(
        [moduleContract("BOOKING_CTA", "1.0.0", ["DATABASE"])],
        template(compose),
      ),
    );

    expect(result).toMatchObject({
      success: false,
      issues: [{ code: "INFRASTRUCTURE_DEPENDENCY_MISMATCH" }],
    });
    expect(compose).not.toHaveBeenCalled();
  });

  it("rejects unknown, duplicate, or unplaced template module IDs", () => {
    const configuration = configurationFixture({
      clientId: "client-a",
      bookingModuleId: "booking-a",
    });

    const unknown = capturePipelineError(() =>
      composeManagedWebsite(
        definition(configuration),
        registries(
          undefined,
          template(() => ({
            templateId: "contractor",
            templateVersion: "1.0.0",
            regions: [
              {
                regionId: "main",
                moduleIds: [ModuleIdSchema.parse("missing-module")],
              },
            ],
          })),
        ),
      ),
    );
    const duplicate = capturePipelineError(() =>
      composeManagedWebsite(
        definition(configuration),
        registries(
          undefined,
          template(() => ({
            templateId: "contractor",
            templateVersion: "1.0.0",
            regions: [
              {
                regionId: "main",
                moduleIds: [
                  ModuleIdSchema.parse("booking-a"),
                  ModuleIdSchema.parse("booking-a"),
                ],
              },
            ],
          })),
        ),
      ),
    );
    const unplaced = capturePipelineError(() =>
      composeManagedWebsite(
        definition(configuration),
        registries(
          undefined,
          template(() => ({
            templateId: "contractor",
            templateVersion: "1.0.0",
            regions: [{ regionId: "main", moduleIds: [] }],
          })),
        ),
      ),
    );

    expect(unknown.code).toBe("UNKNOWN_COMPOSITION_MODULE");
    expect(duplicate.code).toBe("DUPLICATE_COMPOSITION_MODULE");
    expect(unplaced.code).toBe("UNPLACED_CONFIGURATION_MODULE");
  });

  it("rejects duplicate region IDs", () => {
    const error = capturePipelineError(() =>
      composeManagedWebsite(
        definition(
          configurationFixture({
            clientId: "client-a",
            bookingModuleId: "booking-a",
          }),
        ),
        registries(
          undefined,
          template(() => ({
            templateId: "contractor",
            templateVersion: "1.0.0",
            regions: [
              {
                regionId: "main",
                moduleIds: [ModuleIdSchema.parse("booking-a")],
              },
              { regionId: "main", moduleIds: [] },
            ],
          })),
        ),
      ),
    );

    expect(error.code).toBe("DUPLICATE_COMPOSITION_REGION");
  });

  it("keeps concurrent clients isolated through shared registries", async () => {
    const sharedRegistries = registries();

    const [clientA, clientB] = await Promise.all([
      Promise.resolve().then(() =>
        composeManagedWebsite(
          definition(
            configurationFixture({
              clientId: "client-a",
              bookingModuleId: "booking-a",
            }),
          ),
          sharedRegistries,
        ),
      ),
      Promise.resolve().then(() =>
        composeManagedWebsite(
          definition(
            configurationFixture({
              clientId: "client-b",
              bookingModuleId: "booking-b",
            }),
          ),
          sharedRegistries,
        ),
      ),
    ]);

    expect(clientA).toMatchObject({
      success: true,
      data: {
        regions: [
          { modules: [{ moduleId: "booking-a" }] },
          { modules: [] },
        ],
      },
    });
    expect(clientB).toMatchObject({
      success: true,
      data: {
        regions: [
          { modules: [{ moduleId: "booking-b" }] },
          { modules: [] },
        ],
      },
    });
    expect(JSON.stringify(clientA)).not.toContain("booking-b");
    expect(JSON.stringify(clientB)).not.toContain("booking-a");
  });

  it("resolves legacy experience and deterministic OFF search when inputs are omitted", () => {
    const result = composeManagedWebsite(
      {
        ...definition(
          configurationFixture({
            clientId: "client-a",
            bookingModuleId: "booking-a",
          }),
        ),
        profile: profileFixture("client-a"),
      },
      registries(),
    );

    expect(result).toMatchObject({
      success: true,
      data: {
        experience: {
          experienceId: "legacy-contractor",
          source: "LEGACY_PROFILE_DEFAULT",
        },
        foundationSearch: {
          mode: "OFF",
          enabled: false,
          reason: "DEFAULT_OFF",
          records: [],
        },
        provenance: {
          experience: {
            experienceId: "legacy-contractor",
            experienceVersion: "1.0.0",
            source: "LEGACY_PROFILE_DEFAULT",
          },
          foundationSearch: { mode: "OFF", enabled: false },
        },
      },
    });
  });

  it("freezes and records explicit experience and search output", () => {
    const result = composeManagedWebsite(
      {
        ...definition(
          configurationFixture({
            clientId: "client-a",
            bookingModuleId: "booking-a",
          }),
        ),
        profile: profileFixture("client-a"),
        experience: experienceFixture("client-a-field-guide"),
        foundationSearch: { schemaVersion: 1, mode: "ON" },
      },
      registries(),
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.provenance).toMatchObject({
      experience: {
        experienceId: "client-a-field-guide",
        experienceVersion: "1.0.0",
        source: "EXPLICIT",
      },
      foundationSearch: { mode: "ON", enabled: true },
    });
    expect(result.data.foundationSearch.records).toHaveLength(8);
    expect(Object.isFrozen(result.data.experience)).toBe(true);
    expect(Object.isFrozen(result.data.experience?.designDna)).toBe(true);
    expect(Object.isFrozen(result.data.foundationSearch)).toBe(true);
    expect(Object.isFrozen(result.data.foundationSearch.records)).toBe(true);
  });

  it("stops invalid section references before template composition", () => {
    const compose = vi.fn<WebsiteTemplate["compose"]>();
    const invalidExperience = experienceFixture("invalid") as {
      designDna: { composition: { sectionOrder: string[] } };
    };
    invalidExperience.designDna.composition.sectionOrder = [
      "services",
      "missing",
      "gallery",
      "process",
      "testimonials",
      "faq",
      "contact",
      "primary",
    ];

    const result = composeManagedWebsite(
      {
        ...definition(
          configurationFixture({
            clientId: "client-a",
            bookingModuleId: "booking-a",
          }),
        ),
        profile: profileFixture("client-a"),
        experience: invalidExperience,
      },
      registries(undefined, template(compose)),
    );

    expect(result).toMatchObject({
      success: false,
      issues: [{ code: "REFERENCE_NOT_FOUND" }],
    });
    expect(compose).not.toHaveBeenCalled();
  });

  it("does not leak explicit experience or search records between clients", async () => {
    const sharedRegistries = registries();
    const composeClient = (clientId: string, mode: "OFF" | "ON") =>
      composeManagedWebsite(
        {
          ...definition(
            configurationFixture({
              clientId,
              bookingModuleId: `booking-${clientId}`,
            }),
          ),
          profile: profileFixture(clientId),
          experience: experienceFixture(`${clientId}-experience`),
          foundationSearch: { schemaVersion: 1, mode },
        },
        sharedRegistries,
      );

    const [clientA, clientB] = await Promise.all([
      Promise.resolve().then(() => composeClient("client-a", "ON")),
      Promise.resolve().then(() => composeClient("client-b", "OFF")),
    ]);

    expect(clientA).toMatchObject({
      success: true,
      data: {
        experience: { experienceId: "client-a-experience" },
        foundationSearch: { enabled: true },
      },
    });
    expect(clientB).toMatchObject({
      success: true,
      data: {
        experience: { experienceId: "client-b-experience" },
        foundationSearch: { enabled: false, records: [] },
      },
    });
    expect(JSON.stringify(clientA)).not.toContain("client-b");
    expect(JSON.stringify(clientB)).not.toContain("client-a");
  });
});
