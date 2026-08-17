import { describe, expect, it } from "vitest";

import { createClientRouteInventory } from "../../../apps/managed-web/src/generation/client-route-inventory";

const graph = {
  homePageId: "home",
  pages: [
    {
      pageId: "project",
      path: "/projects/project",
      kind: "PROJECT_DETAIL",
      experienceRouteId: "project-detail",
      search: { include: true },
    },
    {
      pageId: "home",
      path: "/",
      kind: "HOME",
      experienceRouteId: "home",
      search: { include: true },
    },
  ],
} as never;
const manifest = {
  experienceId: "reference",
  experienceVersion: "1.0.0",
  routeIds: ["home", "project-detail"],
} as never;

describe("createClientRouteInventory", () => {
  it("creates a sorted immutable handoff route inventory", () => {
    const inventory = createClientRouteInventory(graph, manifest);
    expect(inventory.routes.map(({ path }) => path)).toEqual([
      "/",
      "/projects/project",
    ]);
    expect(Object.isFrozen(inventory)).toBe(true);
  });

  it("rejects an undeclared authored route", () => {
    expect(() =>
      createClientRouteInventory(
        graph,
        { ...(manifest as object), routeIds: ["home"] } as never,
      ),
    ).toThrow(/undeclared experience route/);
  });
});
