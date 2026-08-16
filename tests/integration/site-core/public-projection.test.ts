import { describe, expect, it } from "vitest";

import { createClientExperiencePublicProjection } from "../../../apps/managed-web/src/client-experience/public-projection";

const pageGraph = {
  schemaVersion: 1,
  homePageId: "home",
  pages: [],
  navigation: { primary: [], utility: [], footer: [] },
} as never;
const profile = {
  schemaVersion: 1,
  profile: "CONTRACTOR",
  archetype: "SERVICE_LED",
  brand: {},
  sections: [],
} as never;
const projects = { schemaVersion: 1, projects: [] } as never;

describe("createClientExperiencePublicProjection", () => {
  it("selects public identity without leaking structurally wider private data", () => {
    const projection = createClientExperiencePublicProjection({
      configuration: {
        clientId: "client-a",
        display: { businessName: "Client A", tagline: "Public tagline" },
        domains: [
          { hostname: "secondary.example.com", canonical: false },
          { hostname: "client-a.example.com", canonical: true },
        ],
        connectors: [{ secretReferenceId: "must-not-project" }],
        entitlementId: "must-not-project",
      } as never,
      pageGraph,
      profile,
      projects,
      media: [],
    });

    expect(projection.site).toEqual({
      clientId: "client-a",
      businessName: "Client A",
      tagline: "Public tagline",
      canonicalHostname: "client-a.example.com",
    });
    const serialized = JSON.stringify(projection);
    expect(serialized).not.toContain("must-not-project");
    expect(serialized).not.toContain("secretReferenceId");
    expect(Object.isFrozen(projection)).toBe(true);
  });

  it("omits optional public values when absent", () => {
    const projection = createClientExperiencePublicProjection({
      configuration: {
        clientId: "client-a",
        display: { businessName: "Client A" },
        domains: [],
      },
      pageGraph,
      profile,
      projects,
      media: [],
    });
    expect(projection.site).toEqual({
      clientId: "client-a",
      businessName: "Client A",
    });
  });
});
