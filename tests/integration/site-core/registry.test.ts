import { describe, expect, it } from "vitest";

import {
  createClientExperienceRegistry,
  ClientExperienceRegistryError,
} from "../../../apps/managed-web/src/client-experience/registry";
import type { ClientExperienceDefinition } from "../../../apps/managed-web/src/client-experience/contract";

const Route = () => null;
const Signature = () => null;

const graph = {
  schemaVersion: 1,
  homePageId: "home",
  pages: [
    { pageId: "home", experienceRouteId: "home" },
    { pageId: "projects", experienceRouteId: "projects-index" },
    { pageId: "project-one", experienceRouteId: "project-detail" },
  ],
} as never;

const manifest = {
  schemaVersion: 1,
  kind: "AUTHORED_CLIENT_EXPERIENCE",
  experienceId: "northline",
  experienceVersion: "1.0.0",
  entrypoint: "index.tsx",
  designDnaPath: "design-dna.json",
  routeIds: ["home", "projects-index", "project-detail"],
  signatureIds: ["project-reveal"],
  publicDependencies: [],
  runtime: {
    clientJavaScript: "COMPONENT_SCOPED",
    motion: "NATIVE",
    reducedMotion: "REQUIRED",
  },
} as const;

function definition(): ClientExperienceDefinition {
  return {
    schemaVersion: 1,
    experienceId: "northline",
    experienceVersion: "1.0.0",
    routes: {
      home: Route,
      "projects-index": Route,
      "project-detail": Route,
    },
    signatures: { "project-reveal": Signature },
  };
}

describe("client experience registry", () => {
  it("resolves exact route and signature coverage", () => {
    const registry = createClientExperienceRegistry(definition(), manifest as never, graph);
    expect(registry.resolveRoute("home")).toBe(Route);
    expect(registry.resolveSignature("project-reveal")).toBe(Signature);
  });

  it("rejects source/manifest identity drift", () => {
    const fixture = definition();
    const changed = { ...fixture, experienceVersion: "2.0.0" };
    expect(() => createClientExperienceRegistry(changed, manifest as never, graph)).toThrowError(
      ClientExperienceRegistryError,
    );
  });

  it("rejects missing and extra route components", () => {
    const fixture = definition();
    const changed = {
      ...fixture,
      routes: { home: Route, unused: Route },
    };
    expect(() => createClientExperienceRegistry(changed, manifest as never, graph)).toThrow(
      /Missing: project-detail, projects-index; extra: unused/,
    );
  });

  it("rejects signature source drift", () => {
    const fixture = definition();
    const changed = { ...fixture, signatures: {} };
    expect(() => createClientExperienceRegistry(changed, manifest as never, graph)).toThrow(
      /signature source must exactly match/,
    );
  });

  it("fails loudly on unknown runtime IDs", () => {
    const registry = createClientExperienceRegistry(definition(), manifest as never, graph);
    expect(() => registry.resolveRoute("missing")).toThrow(/not registered/);
    expect(() => registry.resolveSignature("missing")).toThrow(/not registered/);
  });
});
